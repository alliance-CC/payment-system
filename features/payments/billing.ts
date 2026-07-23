// 継続課金のコアロジック (§1.1 / §5-② / §6-4〜7)。
//   registerSubscription : 申込 (同意ログ → CRM upsert → 会員+カード登録+初回課金 → 契約作成 → 通知)
//   runDailyCharges      : 日次 Cron (対象抽出 → 会員ID都度決済 → べき等 → リトライ/延滞/停止 → CRM反映)
//   cancelSubscription   : 解約 (VeriTrans 会員削除 → 契約 canceled)
//   replaceCard          : カード更新 (新トークンで差し替え → 延滞なら即再課金対象に)
import "server-only";
import { loadVeritransConfig, type VeritransConfig } from "./veritrans/config";
import { registerAndCharge, chargeByAccount, updateCardByToken, deleteAccount } from "./veritrans/paynowid";
import { getPlan } from "./plans";
import { newAccountId, accountIdFromCaseId, isValidAccountId } from "./account";
import { supabaseCrmAdapter, type ConsentRecord } from "./crm-adapter";
import { appendSignupRow } from "./signup-sheet";
import {
  insertContract, getContractByAccountId, getContractById, updateContractRow, listDueContracts,
  hasSuccessfulCharge, hasInDoubtAttempt, countConsentsForAccount,
  beginChargeAttempt, finishChargeAttempt, markChargePending, getInDoubtCharge,
  insertConsent, type ContractRow,
} from "./store";
import {
  getBillingPolicy, DEFAULT_TENANT_ID,
  todayJst, monthOf, yyyymmOf, addDays, nextChargeDateAfter, recurringOrderId,
  firstChargeDate, endOfMonth,
} from "./billing-config";
import { sendEmailViaSmtp } from "@/features/messages/send";

// ---- 申込 (§1.1 手順2〜6) ------------------------------------------------

export type SubscribeInput = {
  tenantId?: string | null;         // OEM: ?tenant= で解決したテナント。無指定は既定テナント
  planId: string;
  name: string;
  phone: string;
  email?: string | null;
  paymentMethod: "card";            // 口座振替は仕様確定後に別系統で追加 (§2.1)
  token: string;
  tokenKey?: string | null;
  caseId?: string | null;           // 申込リンク ?case=案件ID (§5 照合精度向上)
  consent: { termsVersion: string; ip?: string | null; userAgent?: string | null };
};

export type SubscribeResult =
  | { ok: true; accountId: string; orderId: string; nextChargeDate: string }
  | { ok: false; error: string; vResultCode?: string | null; vtDetail?: string | null };

// VeriTrans 応答から人間可読なエラー詳細 (どのパラメータが不正か等) を安全に抽出する。
// 応答にカード番号・セキュリティコードは含まれないが、念のため PAN/コード様の桁は伏せる
function extractVtDetail(raw: any): string | null {
  if (!raw) return null;
  const r = raw.result ?? raw;
  const parts: string[] = [];
  for (const k of ["merchantErrorMessage", "vResultCode", "message", "errorMessages", "errors", "properties"]) {
    const v = (r as any)?.[k] ?? (raw as any)?.[k];
    if (v != null) parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  let s = parts.join(" / ") || JSON.stringify(r ?? {}).slice(0, 500);
  s = s.replace(/\b\d{12,19}\b/g, "****");           // PAN 様の桁は伏せる
  return s.slice(0, 500);
}

export async function registerSubscription(input: SubscribeInput): Promise<SubscribeResult> {
  const tenantId = input.tenantId || DEFAULT_TENANT_ID;
  const plan = getPlan(input.planId);
  if (!plan) return { ok: false, error: "unknown-plan" };

  const cfg = await loadVeritransConfig(tenantId);   // OEM: テナント別の VT アカウント (§1.2)
  if (!cfg.merchantCcid || !cfg.merchantKey) return { ok: false, error: "veritrans-not-configured" };

  // 会員ID採番 (§5): 案件IDがあれば決定的に、無ければランダム採番
  const accountId = input.caseId ? accountIdFromCaseId(input.caseId) : newAccountId();
  if (!isValidAccountId(accountId)) return { ok: false, error: "invalid-account-id" };
  // 同一 accountId の既存契約 (再申込) は二重契約にしない
  const existing = await getContractByAccountId(accountId);
  if (existing && existing.status !== "canceled") {
    return { ok: false, error: "already-subscribed" };
  }
  // accountId はグローバル一意。解約済みでも他テナントの契約は再利用させない
  if (existing && existing.tenant_id !== tenantId) {
    return { ok: false, error: "already-subscribed" };
  }

  // 同意ログ (§1.1-2) — 決済前に保存し「履歴を残す」要件を満たす
  const consent: ConsentRecord = {
    acceptedAt: new Date().toISOString(),
    termsVersion: input.consent.termsVersion,
    planId: plan.id,
    paymentMethod: "card",
    ip: input.consent.ip ?? undefined,
    userAgent: input.consent.userAgent ?? undefined,
  };
  await insertConsent({
    tenant_id: tenantId,
    account_id: accountId,
    terms_version: consent.termsVersion,
    plan_id: plan.id,
    payment_method: "card",
    ip: consent.ip ?? null,
    user_agent: consent.userAgent ?? null,
  });

  // CRM 照合 → upsert (§1.1-6 / §5 オープン申込)
  const crm = supabaseCrmAdapter(tenantId);
  const customerId = await crm.upsertCustomer({
    phone: input.phone,
    name: input.name,
    email: input.email ?? undefined,
    caseId: input.caseId ?? undefined,
  });

  // 申込時の VeriTrans 処理 (§1.1-5 / §規約 会費 L67):
  //   無料期間 (freeMonths ヶ月・申込月含む) がある場合、申込時は「会員登録+カード登録」
  //   のみ行い課金しない (capture=false)。実課金は無料期間終了後の初回課金日に日次 Cron
  //   (会員ID都度決済) が行う。無料期間 0 のときは従来どおり申込時に初回課金する。
  const policy = getBillingPolicy();
  const freeMonths = policy.freeMonths;
  const useFreePeriod = freeMonths > 0;
  const today = todayJst();

  // orderId は acct_YYYYMM を基本に、申込試行番号 (=同意記録の件数) で一意化する (§5-②)。
  // 無料期間ありの登録取引は、無料期間後の初回課金 orderId (acct_初回課金YYYYMM) と衝突しない
  // よう _reg を付す。VeriTrans は失敗 orderId も再利用不可のため試行番号 _sN で一意化する。
  const initAttempt = Math.max(1, await countConsentsForAccount(accountId));
  const suffix = initAttempt === 1 ? "" : `_s${initAttempt - 1}`;
  const orderId = `${accountId}_${yyyymmOf(today)}${useFreePeriod ? "_reg" : ""}${suffix}`;

  // capture=false: 与信のみで会員+カード登録 (売上確定しない=課金しない)。
  // SPEC_CHECK: 与信のみの Authorize/card がカード登録を永続化するか、会員登録専用API
  // (Add/account) が必要かは検証環境で確認する (docs/09)。
  const result = await registerAndCharge({
    accountId,
    orderId,
    amount: plan.amount,
    token: input.token,
    tokenKey: input.tokenKey ?? undefined,
    freeKey: customerId,                                // CRM 相互参照 (§5)
    capture: !useFreePeriod,
  }, cfg);

  // 結果不明 (通信断・タイムアウト・HTTP/応答不正) は pending と同じく「VT 側で会員登録+
  // 課金が成立している可能性」があるため、確定失敗にしない (再申込で二重課金を防ぐ)。
  const indeterminate = result.pending || result.indeterminate;
  if (!result.ok && !indeterminate) {
    // 確定的なカード拒否等: 契約を作らない (顧客はカード再入力で再申込でき、
    // orderId は同意件数 _sN で変わるため VT の失敗 orderId 再利用不可制約を回避できる)。
    const vtDetail = extractVtDetail(result.raw);
    console.error("[payments] charge-failed:", result.vResultCode, vtDetail);
    return { ok: false, error: "charge-failed", vResultCode: result.vResultCode, vtDetail };
  }

  // 成功 or 結果不明のどちらも契約を作る (§5)。
  //   成功    → active + 次回課金日 + 課金 ok=true
  //   結果不明 → suspended (自動課金停止) + 在疑義課金 ok=null → /admin/payments で
  //              VT 取引照会のうえ確定 (成功なら active 化 / 失敗なら解約)。
  // 契約を残すことで、同一 accountId (案件ID由来) の再申込は先頭の already-subscribed
  // ガードで弾かれ二重課金を防げる。account_id UNIQUE のため既存行があれば再有効化する
  // (課金成功後に insert が失敗する孤児課金を防ぐ)。
  // 課金日:
  //   無料期間あり → 暦月課金 (anchor=1)・初回課金日 = 申込月+freeMonths の1日 (§規約 会費対象期間)
  //   無料期間なし → 従来どおり 翌月同日
  const anchorDay = useFreePeriod ? 1 : parseInt(today.slice(8, 10), 10);
  const nextChargeDate = useFreePeriod
    ? firstChargeDate(today, freeMonths)
    : nextChargeDateAfter(monthOf(today), anchorDay);
  const contractStatus = indeterminate ? "suspended" : "active";
  const contractNextDate = indeterminate ? null : nextChargeDate;

  let contract: ContractRow;
  if (existing) {
    await updateContractRow(existing.id, {
      status: contractStatus,
      plan_id: plan.id,
      plan_name: plan.name,
      amount: plan.amount,
      next_charge_date: contractNextDate,
      consecutive_failures: 0,
      customer_id: customerId,
      canceled_at: null,
    });
    contract = { ...existing, status: contractStatus, plan_id: plan.id, amount: plan.amount };
  } else {
    contract = await insertContract({
      tenant_id: tenantId,
      account_id: accountId,
      customer_id: customerId,
      plan_id: plan.id,
      plan_name: plan.name,
      amount: plan.amount,
      payment_method: "card",
      anchor_day: anchorDay,
      next_charge_date: contractNextDate,
      status: contractStatus,
      contact_name: input.name,
      contact_phone: input.phone,
      contact_email: input.email ?? null,
      free_key: customerId,
    });
  }

  // 初回課金の記録 (orderId 一意)。無料期間ありは申込時に課金していないため記録しない
  // — 初回の実課金は無料期間終了後 (初回課金日) に日次 Cron が行い、そこで charge 行が作られる。
  if (!useFreePeriod) {
    const attempt = await beginChargeAttempt({
      tenant_id: tenantId,
      contract_id: contract.id,
      order_id: orderId,
      charge_month: monthOf(today),
      kind: "initial",
      attempt: 1,
      amount: plan.amount,
    });
    if (attempt !== "duplicate") {
      if (indeterminate) {
        await markChargePending(attempt.id, {
          mstatus: result.mstatus ?? "unknown",
          v_result_code: result.vResultCode
            ?? (result.transportError ? `TRANSPORT:${result.transportError}`.slice(0, 64) : null),
        });
      } else {
        try {
          await finishChargeAttempt(attempt.id, {
            ok: true, mstatus: result.mstatus, v_result_code: result.vResultCode,
          });
        } catch (e: any) {
          // 解約→同月再申込のレアケースでは、再有効化した契約に同月の ok=true 行が既にあり
          // 月次成功の部分 UNIQUE (contract_id,charge_month WHERE ok=true) に衝突する。
          // VT 課金は成立済み・契約は active なので登録は成功扱いにし、記録衝突はログのみ。
          console.error("[payments] initial charge record conflict (cancel→resubscribe same month?):", String(e?.message ?? e));
        }
      }
    }
  }

  // 結果不明のときは自社宛の登録通知を送らず、成功時のみ通知する
  // (結果不明は /admin/payments の在疑義行が確認の起点になる)。
  if (indeterminate) {
    return { ok: false, error: "charge-pending", vResultCode: result.vResultCode };
  }

  // CRM へ契約状態を反映 (§6-6)
  await crm.updateContract(customerId, {
    accountId, planId: plan.id, paymentMethod: "card", status: "active",
    nextChargeDate, orderId,
    lastResult: { vResultCode: result.vResultCode, at: new Date().toISOString() },
  }).catch(() => { /* CRM メモ更新失敗で申込は失敗させない */ });

  // 登録通知メール (§1.1-5: 自社宛。顧客情報・契約プラン・会員ID)
  await notifyRegistration(tenantId, {
    accountId, planName: plan.name, amount: plan.amount,
    name: input.name, phone: input.phone, email: input.email ?? null,
    firstChargeDate: useFreePeriod ? nextChargeDate : null,
  });

  // 申込データをスプレッドシートへ追記 (CRM を使わない当面の受け皿)。
  // 未設定/失敗でも申込は成功させる (非ブロッキング)
  await appendSignupRow({
    registeredAt: consent.acceptedAt,
    accountId, planName: plan.name,
    name: input.name, phone: input.phone,
  }).catch(() => { /* シート追記失敗で申込は失敗させない */ });

  return { ok: true, accountId, orderId, nextChargeDate };
}

async function notifyRegistration(
  tenantId: string,
  info: { accountId: string; planName: string; amount: number; name: string; phone: string; email: string | null; firstChargeDate?: string | null },
): Promise<void> {
  const policy = getBillingPolicy();
  if (!policy.notifyEmail) return;   // TODO(§10): 宛先確定後に必須化
  const body = [
    "継続課金の新規申込を受け付けました。",
    "",
    `会員ID: ${info.accountId}`,
    `契約プラン: ${info.planName} (${info.amount}円/月)`,
    info.firstChargeDate
      ? `課金開始 (無料期間終了後の初回課金日): ${info.firstChargeDate}`
      : "初回課金: 申込時に実施済み",
    `氏名: ${info.name}`,
    `電話番号: ${info.phone}`,
    `メール: ${info.email ?? "(未取得)"}`,
  ].join("\n");
  const res = await sendEmailViaSmtp(
    { to: policy.notifyEmail, subject: "【継続課金】新規申込通知", body },
    tenantId,
  );
  if (!res.ok) {
    // TODO(§5): 送信失敗時のリトライ/記録。当面はサーバーログのみ
    console.error("[payments] registration notify failed:", (res as any).error);
  }
}

// ---- 日次課金 (§5-② / §6-5,6) ---------------------------------------------

export type DailyChargeSummary = {
  processed: number;
  charged: number;
  failed: number;
  skipped: number;
  suspended: number;
  cardExpired: number;
  /** mstatus="pending" (保留)。在疑義として記録し手動確定待ち */
  pending: number;
  /** 時間切れで今回処理しきれなかった概算残数 (>0 なら Cron 再実行/翌日に持ち越し) */
  remaining: number;
  errors: string[];
};

// Vercel Function の maxDuration=300s に収めるための実行時間バジェット (§5-② 注意)。
// 超えそうになったら安全に打ち切り、残りは同日の再実行または翌日の Cron が拾う
// (処理済み契約は next_charge_date / status が変わり対象から外れるため再開は安全)。
const CRON_TIME_BUDGET_MS = 240_000;

export async function runDailyCharges(): Promise<DailyChargeSummary> {
  const policy = getBillingPolicy();
  const today = todayJst();
  const startedAt = Date.now();
  const summary: DailyChargeSummary = {
    processed: 0, charged: 0, failed: 0, skipped: 0, suspended: 0, cardExpired: 0, pending: 0, remaining: 0, errors: [],
  };

  // OEM: テナントごとに VT アカウントが異なる (§1.2)。テナント単位で設定を解決してキャッシュ
  const cfgCache = new Map<string, VeritransConfig>();
  async function cfgFor(tenantId: string): Promise<VeritransConfig> {
    let c = cfgCache.get(tenantId);
    if (!c) {
      c = await loadVeritransConfig(tenantId);
      cfgCache.set(tenantId, c);
    }
    return c;
  }

  // バッチ分割: cronBatchLimit 件ずつ取得→処理を繰り返す。処理済み契約は
  // 対象条件 (status/next_charge_date) から外れるため再取得で重複しないが、
  // 在疑義スキップ等で対象に残り続ける契約があるので seen で無限ループを防ぐ。
  const seen = new Set<string>();
  for (;;) {
    const due = (await listDueContracts(today, policy.cronBatchLimit)).filter((c) => !seen.has(c.id));
    if (due.length === 0) break;

    for (let i = 0; i < due.length; i++) {
      const contract = due[i];
      seen.add(contract.id);
      if (Date.now() - startedAt > CRON_TIME_BUDGET_MS) {
        summary.remaining = due.length - i;   // 現バッチの残り (後続バッチ分は含まない概算)
        summary.errors.push("time-budget-exceeded: 残りは再実行/翌日に持ち越し");
        return summary;
      }
      summary.processed++;
      try {
        const cfg = await cfgFor(contract.tenant_id);
        if (!cfg.merchantCcid || !cfg.merchantKey) {
          summary.errors.push(`${contract.account_id}: veritrans-not-configured (tenant ${contract.tenant_id})`);
          continue;
        }
        const outcome = await chargeContractOnce(contract, today, cfg);
        summary[outcome]++;
      } catch (e: any) {
        summary.errors.push(`${contract.account_id}: ${String(e?.message ?? e).slice(0, 200)}`);
      }
    }
  }
  return summary;
}

/** 1契約分の課金 (べき等)。戻り値は summary のキー */
async function chargeContractOnce(
  contract: ContractRow,
  today: string,
  cfg: VeritransConfig,
): Promise<"charged" | "failed" | "skipped" | "suspended" | "cardExpired" | "pending"> {
  const policy = getBillingPolicy();
  // 課金対象月は「予定されていた課金日」の年月 (リトライで日付が翌月にずれても対象月は維持…
  // はせず、予定日ベースで判定する。予定日が過去に溜まっていても1回の実行で1ヶ月分のみ課金)
  const dueDate = contract.next_charge_date ?? today;
  const chargeMonth = monthOf(dueDate);

  // 結果未確定 (ok=null) の試行が残っている場合は再課金しない (VT 成功後の記録前
  // クラッシュだと二重課金になるため)。手動照合 (VT 取引照会) 後に行を確定させること。
  if (await hasInDoubtAttempt(contract.id, chargeMonth)) {
    throw new Error(`in-doubt attempt exists for ${chargeMonth} — VT取引照会での手動確定が必要`);
  }

  // 二重課金ガード1: 対象月の成功記録があれば次回日だけ進めて終了
  if (await hasSuccessfulCharge(contract.id, chargeMonth)) {
    await updateContractRow(contract.id, {
      next_charge_date: nextChargeDateAfter(chargeMonth, contract.anchor_day),
    });
    return "skipped";
  }

  // orderId: 初回 acct_YYYYMM / リトライ acct_YYYYMM_r{N} (§5-②。VeriTrans は
  // 失敗した orderId も再利用不可のため試行ごとに一意・決定的に採番)。
  //
  // 試行番号は「この契約行の consecutive_failures スナップショット」から導出する。
  // 以前は countAttempts (payment_charges の非アトミックな COUNT) を使っていたが、
  // 並行 Cron 実行 (at-least-once/手動再実行/タイムアウト再試行) で
  //   A が base 行を insert commit → B の COUNT がそれを数えて +1 → B が別 orderId (_r1) を採番
  // となり order_id UNIQUE をすり抜けて同一月に二重課金する競合があった。
  // cf ベースなら両インスタンスが同じ contract スナップショットから同じ orderId を導出し、
  // order_id UNIQUE 制約で必ず一方が duplicate → skip になる (レース解消)。
  // cf は成功で 0 リセット・失敗で +1 されるため月内試行番号として機能する。
  const retryN = contract.consecutive_failures;
  const yyyymm = yyyymmOf(dueDate);
  const orderId = recurringOrderId(contract.account_id, yyyymm, retryN);

  // 二重課金ガード2: orderId 一意制約 (並行実行・再実行への原子的ゲート)
  const begun = await beginChargeAttempt({
    tenant_id: contract.tenant_id,
    contract_id: contract.id,
    order_id: orderId,
    charge_month: chargeMonth,
    kind: retryN === 0 ? "recurring" : "retry",
    attempt: retryN + 1,
    amount: contract.amount,
  });
  if (begun === "duplicate") return "skipped";

  const result = await chargeByAccount({
    accountId: contract.account_id,
    orderId,
    amount: contract.amount,          // 金額変更は contracts.amount を変えるだけ (§5-② の利点)
    freeKey: contract.customer_id ?? undefined,
  }, cfg);

  if (result.pending || result.indeterminate) {
    // pending (保留) と結果不明 (通信断/タイムアウト/HTTPエラー) はどちらも
    // 「VT 側で成立している可能性がある」→ 失敗確定にして別 orderId でリトライすると
    // 二重課金になる。ok=null のまま経過を記録し、在疑義として当月の再課金を止め、
    // VT 取引照会での手動確定 (resolveInDoubtCharge) に回す。
    await markChargePending(begun.id, {
      mstatus: result.mstatus ?? (result.transportError ? "unknown" : null),
      v_result_code: result.vResultCode
        ?? (result.transportError ? `TRANSPORT:${result.transportError}`.slice(0, 64) : null),
    });
    return "pending";
  }

  await finishChargeAttempt(begun.id, {
    ok: result.ok,
    mstatus: result.mstatus,
    v_result_code: result.vResultCode,
    error: result.transportError ?? null,
  });

  const crm = contract.customer_id ? supabaseCrmAdapter(contract.tenant_id) : null;
  const now = new Date().toISOString();

  if (result.ok) {
    const next = nextChargeDateAfter(chargeMonth, contract.anchor_day);
    await updateContractRow(contract.id, {
      status: "active",
      next_charge_date: next,
      consecutive_failures: 0,
      last_result_code: result.vResultCode,
      last_charged_at: now,
    });
    await crm?.updateContract(contract.customer_id!, {
      accountId: contract.account_id, planId: contract.plan_id, paymentMethod: contract.payment_method,
      status: "active", nextChargeDate: next, orderId,
      lastResult: { vResultCode: result.vResultCode, at: now },
    }).catch(() => {});
    return "charged";
  }

  // --- 失敗系 (§5-②) ---
  const code = result.vResultCode ?? "";
  const isExpired = policy.cardExpiredCodePrefixes.some((p) => p && code.startsWith(p));

  if (isExpired) {
    // 期限切れはリトライしない → カード更新フローへ (§5-②/§6-7)
    await updateContractRow(contract.id, {
      status: "card_expired",
      last_result_code: result.vResultCode,
      consecutive_failures: contract.consecutive_failures + 1,
    });
    await notifyCardExpired(contract);
    await crm?.updateContract(contract.customer_id!, {
      accountId: contract.account_id, planId: contract.plan_id, paymentMethod: contract.payment_method,
      status: "failed", orderId,
      lastResult: { vResultCode: result.vResultCode, at: now },
    }).catch(() => {});
    return "cardExpired";
  }

  const failures = contract.consecutive_failures + 1;
  if (failures > policy.retryMax) {
    // リトライ上限超過 → 停止 (§5-②「超過で延滞→停止にし顧客連絡」)
    await updateContractRow(contract.id, {
      status: "suspended",
      consecutive_failures: failures,
      last_result_code: result.vResultCode,
    });
    await crm?.updateContract(contract.customer_id!, {
      accountId: contract.account_id, planId: contract.plan_id, paymentMethod: contract.payment_method,
      status: "suspended", orderId,
      lastResult: { vResultCode: result.vResultCode, at: now },
    }).catch(() => {});
    return "suspended";
  }

  // 延滞: 設定間隔で次回リトライ (§5-② 例: 翌日/3日後/7日後)
  const interval = policy.retryIntervalsDays[Math.min(failures - 1, policy.retryIntervalsDays.length - 1)];
  await updateContractRow(contract.id, {
    status: "delinquent",
    consecutive_failures: failures,
    last_result_code: result.vResultCode,
    next_charge_date: addDays(today, interval),
  });
  await crm?.updateContract(contract.customer_id!, {
    accountId: contract.account_id, planId: contract.plan_id, paymentMethod: contract.payment_method,
    status: "delinquent", orderId,
    lastResult: { vResultCode: result.vResultCode, at: now },
  }).catch(() => {});
  return "failed";
}

async function notifyCardExpired(contract: ContractRow): Promise<void> {
  const policy = getBillingPolicy();
  // 自社宛の運用通知 (顧客宛の再登録依頼は §10 メール取得要否の確定後に自動化)
  if (!policy.notifyEmail) return;
  const body = [
    "カード期限切れ (もしくは期限切れ相当の失敗) を検知しました。カード更新フローへの案内が必要です。",
    "",
    `会員ID: ${contract.account_id}`,
    `氏名: ${contract.contact_name ?? "-"} / 電話: ${contract.contact_phone ?? "-"}`,
    `カード更新URL: /subscribe/update-card?account=${contract.account_id}`,
  ].join("\n");
  await sendEmailViaSmtp(
    { to: policy.notifyEmail, subject: "【継続課金】カード期限切れ検知", body },
    contract.tenant_id,
  ).catch(() => {});
}

// ---- 在疑義課金の手動確定 (§5-② 運用) ---------------------------------------
// ok=null の試行が残ると当月の再課金が止まる (二重課金防止)。VeriTrans の
// 取引照会 (MAP/API) で実際の結果を確認したうえで、管理画面からここを呼んで確定する。
//   成功として確定 → 課金成功と同じ後処理 (次回課金日を進める・契約を active に)
//   失敗として確定 → 記録のみ確定。契約は据え置き、翌日の Cron からリトライ再開

export async function resolveInDoubtCharge(
  chargeId: string,
  resolvedOk: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const charge = await getInDoubtCharge(chargeId);
  if (!charge) return { ok: false, error: "charge-not-in-doubt" };
  const contract = await getContractById(charge.contract_id);
  if (!contract) return { ok: false, error: "contract-not-found" };

  await finishChargeAttempt(charge.id, {
    ok: resolvedOk,
    mstatus: resolvedOk ? "success" : "failure",
    v_result_code: "MANUAL",          // 手動確定の痕跡 (VT取引照会に基づく運用操作)
  });

  if (resolvedOk) {
    const now = new Date().toISOString();
    const next = nextChargeDateAfter(charge.charge_month, contract.anchor_day);
    await updateContractRow(contract.id, {
      status: contract.status === "canceled" ? contract.status : "active",
      next_charge_date: contract.status === "canceled" ? null : next,
      consecutive_failures: 0,
      last_result_code: "MANUAL",
      last_charged_at: now,
    });
    if (contract.customer_id) {
      await supabaseCrmAdapter(contract.tenant_id).updateContract(contract.customer_id, {
        accountId: contract.account_id, planId: contract.plan_id, paymentMethod: contract.payment_method,
        status: "active", nextChargeDate: next, orderId: charge.order_id,
        lastResult: { vResultCode: "MANUAL", at: now },
      }).catch(() => {});
    }
  }
  return { ok: true };
}

// ---- カード更新 (§6-7) -----------------------------------------------------

export async function replaceCard(input: {
  accountId: string;
  token: string;
  tokenKey?: string | null;
}): Promise<{ ok: boolean; error?: string; vResultCode?: string | null }> {
  const contract = await getContractByAccountId(input.accountId);
  if (!contract || contract.status === "canceled") return { ok: false, error: "contract-not-found" };

  const cfg = await loadVeritransConfig(contract.tenant_id);
  const result = await updateCardByToken({
    accountId: input.accountId,
    token: input.token,
    tokenKey: input.tokenKey ?? undefined,
  }, cfg);
  if (!result.ok) return { ok: false, error: "card-update-failed", vResultCode: result.vResultCode };

  // 期限切れ/延滞中だった場合は翌日の Cron で再課金されるよう当日に戻す
  const patch: Parameters<typeof updateContractRow>[1] = { consecutive_failures: 0 };
  if (contract.status === "card_expired" || contract.status === "delinquent" || contract.status === "suspended") {
    patch.status = "delinquent";                 // 未収がある前提で再課金対象に
    patch.next_charge_date = todayJst();
  }
  await updateContractRow(contract.id, patch);
  return { ok: true };
}

// ---- 解約 (§6-7) ------------------------------------------------------------

export async function cancelSubscription(accountId: string): Promise<{ ok: boolean; error?: string; effectiveUntil?: string }> {
  const contract = await getContractByAccountId(accountId);
  if (!contract) return { ok: false, error: "contract-not-found" };
  if (contract.status === "canceled") return { ok: true };

  // 退会手続き当月末日24時までサービス利用可 (§規約 有効期間3)。日割り返金なし=当月分は請求済み。
  // 例: 5/15 解約 → 5月末まで利用可 / 6月から利用不可。
  const effectiveUntil = endOfMonth(todayJst());

  // VeriTrans 側の会員データ削除 (§6-7)。未設定/失敗でも自社側は解約状態にする
  // (完全削除の再実行は管理画面から可能なよう last_result_code に痕跡を残す)
  const cfg = await loadVeritransConfig(contract.tenant_id);
  const vt = await deleteAccount(accountId, cfg).catch(() => null);

  await updateContractRow(contract.id, {
    status: "canceled",
    canceled_at: new Date().toISOString(),
    next_charge_date: null,
    last_result_code: vt?.vResultCode ?? contract.last_result_code,
  });

  if (contract.customer_id) {
    await supabaseCrmAdapter(contract.tenant_id).updateContract(contract.customer_id, {
      accountId, planId: contract.plan_id, paymentMethod: contract.payment_method,
      status: "canceled",
      lastResult: { vResultCode: vt?.vResultCode ?? null, at: new Date().toISOString() },
    }).catch(() => {});
  }
  return { ok: true, effectiveUntil };
}
