// 継続課金のコアロジック (§1.1 / §5-② / §6-4〜7)。
//   registerSubscription : 申込 (同意ログ → CRM upsert → 会員+カード登録+初回課金 → 契約作成 → 通知)
//   runDailyCharges      : 日次 Cron (対象抽出 → 会員ID都度決済 → べき等 → リトライ/延滞/停止 → CRM反映)
//   cancelSubscription   : 解約 (VeriTrans 会員削除 → 契約 canceled)
//   replaceCard          : カード更新 (新トークンで差し替え → 延滞なら即再課金対象に)
import "server-only";
import { loadVeritransConfig, type VeritransConfig } from "./veritrans/config";
import {
  registerAndCharge, chargeByAccount, updateCardByToken, deleteAccount,
  authorizeMpi, getMpiResult,
} from "./veritrans/paynowid";
import { loadPlan } from "./plans";
import { newAccountId, accountIdFromCaseId, isValidAccountId } from "./account";
import { supabaseCrmAdapter, type ConsentRecord } from "./crm-adapter";
import { appendSignupRow } from "./signup-sheet";
import { appendEntryRow, appendCancelRow, assignLicenseKey } from "./entry-sheet";
import { formatPhoneJp } from "./phone";
import {
  insertContract, getContractByAccountId, getContractById, updateContractRow, listDueContracts,
  hasSuccessfulCharge, hasInDoubtAttempt, countConsentsForAccount,
  beginChargeAttempt, finishChargeAttempt, markChargePending, getInDoubtCharge,
  insertConsent, updateServiceStartDate, getServiceStartMap, updateLicenseKey, getLicenseKeyMap,
  getChargeByOrderId, claimChargeFinalization, listInDoubt3dsCharges, hasUnfinishedInitialCharge,
  type ContractRow,
} from "./store";
import {
  loadBillingPolicy, DEFAULT_TENANT_ID,
  todayJst, monthOf, yyyymmOf, addDays, nextChargeDateAfter, recurringOrderId,
  firstChargeDate, endOfMonth,
} from "./billing-config";
import { sendMail } from "@/features/messages/mail";

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
  serviceStartDate?: string | null; // 利用開始日 (YYYY-MM-DD)。2ヶ月無料の起点。既定=申込月の翌月1日
  consent: { termsVersion: string; ip?: string | null; userAgent?: string | null };
};

export type SubscribeResult =
  | { ok: true; accountId: string; orderId: string; nextChargeDate: string }
  | { ok: false; error: string; vResultCode?: string | null; vtDetail?: string | null };

// CRM への顧客 upsert (§5)。CRM 側は「照合・表示用の緩い紐付け」であり、契約状態の一次
// ソースは payment_contracts (氏名/電話/メールも contact_* に保持) 。したがって CRM が
// 未整備・不通でも申込と決済は成立させる ─ ここで throw させると顧客が申し込めなくなる。
// 失敗時は customer_id / free_key が null になるだけで、後から紐付け直せる。
async function upsertCustomerBestEffort(
  crm: ReturnType<typeof supabaseCrmAdapter>,
  input: SubscribeInput,
): Promise<string | null> {
  try {
    return await crm.upsertCustomer({
      phone: input.phone,
      name: input.name,
      email: input.email ?? undefined,
      caseId: input.caseId ?? undefined,
    });
  } catch (e: any) {
    console.error("[payments] CRM upsert failed (continuing without CRM link):", String(e?.message ?? e));
    return null;
  }
}

// timestamptz(UTC) → JST の日付 (YYYY-MM-DD)。シート/CSV の日付表記に使う。
function jstDateOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// 氏名は `姓 名` (申込フォームで姓/名を別入力し空白連結) で保持している。
// スプレッドシート/CSV は姓・名が別項目のため最初の空白で分割する。
// 空白が無い(1語のみ)場合は姓に寄せる。
export function splitName(full: string | null | undefined): { last: string; first: string } {
  const s = (full ?? "").trim().replace(/[　]/g, " ");
  const i = s.indexOf(" ");
  if (i < 0) return { last: s, first: "" };
  return { last: s.slice(0, i).trim(), first: s.slice(i + 1).trim() };
}

/** ウイルスバスター(=セキュリティ)を含むプランか。プレミアムのみライセンスキーを付与する(②)。
 *  プラン名の変更にも耐えるよう id と名称の両方で判定する。 */
export function planIncludesVirusBuster(planId: string, planName?: string | null): boolean {
  return planId === "premium" || (planName ?? "").includes("プレミアム");
}

// ① 申込をエントリータブへ記録し、② プレミアムならライセンスキーを付与する。
// いずれもシート連携であり、失敗しても申込は成立させる (非ブロッキング)。
//
// 書くのは「申込が成立したもの (管理ボードの 利用前/利用中)」だけ:
// 3DS 認証で離脱した等で決済登録が終わっていない契約は「申込未完了」であり、課金もされない。
// これをシートに入れると、成立した申込と見分けが付かないまま利用開始の手配が進んでしまう。
// 呼び出し側は成功パスからしか呼ばないが、経路が増えても崩れないよう書き込み口で判定する。
async function recordEntryAndLicense(v: {
  contractId: string;
  accountId: string;
  planId: string;
  planName: string;
  contractDate: string;      // 申込日
  serviceStartDate: string;
  chargeStartDate: string;
  name: string | null;
  phone: string | null;
}): Promise<void> {
  if (!(await isApplicationCompleted(v.contractId))) {
    console.error("[payments] entry sheet skipped (申込未完了):", v.accountId);
    return;
  }
  const { last, first } = splitName(v.name);
  await appendEntryRow({
    customerId: v.accountId,
    contractDate: v.contractDate,
    serviceStartDate: v.serviceStartDate,
    chargeStartDate: v.chargeStartDate,
    lastNameKanji: last,
    firstNameKanji: first,
    mobilePhone: formatPhoneJp(v.phone),   // 連携シートもハイフン付きで統一
    serviceName: v.planName,
  }).catch((e) => console.error("[payments] entry sheet failed:", String(e?.message ?? e)));

  if (!planIncludesVirusBuster(v.planId, v.planName)) return;   // プラスは付与しない
  try {
    // 付与済みなら在庫を減らさない (確定経路が複数あるため二度呼ばれうる)
    const already = (await getLicenseKeyMap([v.contractId]).catch(() => new Map())).get(v.contractId);
    if (already) return;
    const key = await assignLicenseKey(v.accountId);
    if (key) await updateLicenseKey(v.contractId, key);
    else console.error("[payments] license key not assigned (stock empty or sheet unavailable):", v.accountId);
  } catch (e: any) {
    console.error("[payments] license key assign failed:", String(e?.message ?? e));
  }
}

/** 申込が成立しているか (= 管理ボードで「申込未完了」でない)。
 *  初回登録取引が未確定のまま残っている契約・解約済みの契約は連携シートに入れない。
 *  判定に失敗した場合は書かない側に倒す — 取りこぼしは後続の確定経路
 *  (手動確定・古い未確定行の片付け) が拾い直せるが、誤って書いた行は消せないため。 */
async function isApplicationCompleted(contractId: string): Promise<boolean> {
  try {
    const contract = await getContractById(contractId);
    if (!contract || contract.status === "canceled") return false;
    return !(await hasUnfinishedInitialCharge(contractId));
  } catch (e: any) {
    console.error("[payments] entry eligibility check failed:", String(e?.message ?? e));
    return false;
  }
}

/** 契約行から ①② の記録を行う (3DS 確定・在疑義の手動確定・片付け後の補完で共用)。
 *  申込未完了なら recordEntryAndLicense 側で見送られる。 */
async function recordEntryFromContract(contract: ContractRow, serviceStart?: string | null): Promise<void> {
  const ss = serviceStart !== undefined
    ? serviceStart
    : (await getServiceStartMap([contract.id]).catch(() => new Map())).get(contract.id) ?? null;
  await recordEntryAndLicense({
    contractId: contract.id,
    accountId: contract.account_id,
    planId: contract.plan_id,
    planName: contract.plan_name ?? contract.plan_id,
    contractDate: jstDateOf(contract.started_at) || todayJst(),   // ご契約日 = 申込日
    serviceStartDate: ss ?? todayJst(),
    chargeStartDate: contract.next_charge_date ?? "",
    name: contract.contact_name,
    phone: contract.contact_phone,
  });
}

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
  const plan = await loadPlan(input.planId);
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
  const customerId = await upsertCustomerBestEffort(crm, input);

  // 申込時の VeriTrans 処理 (§1.1-5 / §規約 会費 L67):
  //   無料期間 (freeMonths ヶ月・申込月含む) がある場合、申込時は「会員登録+カード登録」
  //   のみ行い課金しない (capture=false)。実課金は無料期間終了後の初回課金日に日次 Cron
  //   (会員ID都度決済) が行う。無料期間 0 のときは従来どおり申込時に初回課金する。
  const policy = await loadBillingPolicy();
  const freeMonths = policy.freeMonths;
  const useFreePeriod = freeMonths > 0;
  const today = todayJst();
  // 利用開始日 (申込時に選択・§①)。既定=申込月の翌月1日。2ヶ月無料の起点。
  const serviceStart = normalizeDate(input.serviceStartDate) ?? firstChargeDate(today, 1);

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
    freeKey: customerId ?? undefined,                   // CRM 相互参照 (§5。未連携なら送らない)
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
  const anchorDay = useFreePeriod ? policy.chargeDay : parseInt(today.slice(8, 10), 10);
  // 無料期間あり: 初回課金日 = 利用開始月 + freeMonths の「課金日(chargeDay)」
  //   (利用開始月=1ヶ月目・翌月=2ヶ月目まで無料 → 翌々月=3ヶ月目の課金日から課金)
  const nextChargeDate = useFreePeriod
    ? firstChargeDate(serviceStart, freeMonths, policy.chargeDay)
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

  // 利用開始日を保存 (列 p001 未適用でも申込は失敗させない)。
  await updateServiceStartDate(contract.id, serviceStart);

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

  // CRM へ契約状態を反映 (§6-6)。CRM 未連携 (customerId=null) の場合はスキップする
  if (customerId) {
    await crm.updateContract(customerId, {
      accountId, planId: plan.id, paymentMethod: "card", status: "active",
      nextChargeDate, orderId,
      lastResult: { vResultCode: result.vResultCode, at: new Date().toISOString() },
    }).catch(() => { /* CRM メモ更新失敗で申込は失敗させない */ });
  }

  // 登録通知メール (§1.1-5: 自社宛。顧客情報・契約プラン・会員ID)
  // ここは決済成功・契約作成の後。通知の失敗で申込を失敗扱いにすると
  // 「カードは登録済みなのに顧客には失敗と表示」→再申込で二重登録になるため必ず握る
  await notifyRegistration(tenantId, {
    accountId, planName: plan.name, amount: plan.amount,
    name: input.name, phone: input.phone, email: input.email ?? null,
    firstChargeDate: useFreePeriod ? nextChargeDate : null,
  }).catch((e) => console.error("[payments] registration notify failed:", String(e?.message ?? e)));

  // 申込データをスプレッドシートへ追記 (CRM を使わない当面の受け皿)。
  // 未設定/失敗でも申込は成功させる (非ブロッキング)
  await appendSignupRow({
    registeredAt: consent.acceptedAt,
    accountId, planName: plan.name,
    name: input.name, phone: input.phone,
  }).catch(() => { /* シート追記失敗で申込は失敗させない */ });

  // ①③ 連携スプレッドシート「エントリー」へ記録 + ② プレミアムならライセンスキー付与
  await recordEntryAndLicense({
    contractId: contract.id,
    accountId,
    planId: plan.id,
    planName: plan.name,
    contractDate: today,                 // ご契約日 = 申込日
    serviceStartDate: serviceStart,
    chargeStartDate: nextChargeDate,
    name: input.name,
    phone: input.phone,
  });

  // 利用者への登録完了メール (§②)。件名/本文は管理画面 (/admin/settings) で編集。
  // 弊社アドレス (SMTP_FROM) から利用者のメールへ。カード等の決済個人情報は含めない。
  if (input.email) {
    await sendWelcomeEmail(tenantId, {
      to: input.email,
      name: input.name,
      accountId,
      planName: plan.name,
      amount: plan.amount,
      serviceStartDate: serviceStart,
      chargeStartDate: nextChargeDate,
    }).catch((e) => console.error("[payments] welcome mail failed:", String(e?.message ?? e)));
  }

  return { ok: true, accountId, orderId, nextChargeDate };
}

// YYYY-MM-DD の妥当性チェック (不正なら null)。
function normalizeDate(s?: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

// 利用者への登録完了メール。テンプレート(件名/本文)は設定で編集可・プレースホルダ置換。
async function sendWelcomeEmail(
  tenantId: string,
  v: { to: string; name: string; accountId: string; planName: string; amount: number; serviceStartDate: string; chargeStartDate: string },
): Promise<void> {
  const { loadPaymentSettings, DEFAULT_WELCOME_SUBJECT, DEFAULT_WELCOME_BODY } = await import("./payment-settings");
  const s = await loadPaymentSettings();
  const subjTpl = s.welcomeEmail?.subject || DEFAULT_WELCOME_SUBJECT;
  const bodyTpl = s.welcomeEmail?.body || DEFAULT_WELCOME_BODY;
  const map: Record<string, string> = {
    name: v.name,
    accountId: v.accountId,
    planName: v.planName,
    amount: v.amount.toLocaleString(),
    serviceStartDate: v.serviceStartDate,
    chargeStartDate: v.chargeStartDate,
  };
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? `{${k}}`);
  const res = await sendMail({ to: v.to, subject: fill(subjTpl), body: fill(bodyTpl) }, tenantId);
  if (!res.ok) console.error("[payments] welcome mail send failed:", (res as any).error);
}

async function notifyRegistration(
  tenantId: string,
  info: { accountId: string; planName: string; amount: number; name: string; phone: string; email: string | null; firstChargeDate?: string | null },
): Promise<void> {
  const policy = await loadBillingPolicy();
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
  const res = await sendMail(
    { to: policy.notifyEmail, subject: "【継続課金】新規申込通知", body },
    tenantId,
  );
  if (!res.ok) {
    // TODO(§5): 送信失敗時のリトライ/記録。当面はサーバーログのみ
    console.error("[payments] registration notify failed:", (res as any).error);
  }
}

// ---- 3Dセキュア2.0 申込フロー (§6-4 / 3DS開発ガイド ex_3DS2) ------------------
//
// 非3DS (registerSubscription) と違い同期完結しない:
//   start3dsSubscription: 同意→CRM→契約(suspended)+課金行(ok=null)→ /Authorize/mpi
//     → authStartUrl をブラウザへ返し ACS 認証画面へ遷移させる
//   finalizeMpiOrder: 結果通知(PUSH)・ブラウザ復帰のどちらから呼ばれても、
//     MpiGetResult (署名付きサーバー間照会) で結果を取り直して確定する。
//     PUSH 電文には改ざんチェック値が無く、ブラウザ復帰は偽装可能なため、
//     受信値そのもので契約を有効化してはならない。
//   冪等化: claimChargeFinalization (ok IS NULL 条件付き UPDATE) を排他点とし、
//     勝った経路だけが契約有効化・通知メール等の成功後処理を実行する。
//
// VT_USE_3DS=false (既定) の間はこの経路は使われない。

/** 3DS 認証タイムアウト (分)。ECサイトのセッションより数分短く (ガイド推奨)。
 *  verifyTimeout 超過後の認証完了は VT 側でエラー扱いになり与信されない。 */
const MPI_VERIFY_TIMEOUT_MIN = 15;

/** 認証開始マーカー (charge.v_result_code に確定まで一時記録)。
 *  補足資料§5: verifyTimeout 経過後の取引は「これ以上確認しても成立しない」ため
 *  照会対象から外せとある = VT 側からは最終失敗が届かない。離脱で放置された取引を
 *  アプリ側で失敗確定して再申込を解放するために開始時刻を持つ。 */
const MPI_WAIT_MARKER = "3DS-WAIT:";
/** マーカー経過でみなし失敗にするまでの時間 (verifyTimeout + 余裕)。
 *  これを過ぎた認証完了は verifyTimeout により与信されないので失敗確定しても安全。 */
const MPI_ABANDON_MS = (MPI_VERIFY_TIMEOUT_MIN + 5) * 60_000;

/** v_result_code のマーカーから「開始からの経過が放置とみなせるか」を判定 */
function isMpiWaitExpired(vResultCode: string | null): boolean {
  if (!vResultCode?.startsWith(MPI_WAIT_MARKER)) return false;
  const t = Number(vResultCode.slice(MPI_WAIT_MARKER.length));
  return Number.isFinite(t) && Date.now() - t > MPI_ABANDON_MS;
}

export type Start3dsResult =
  | { ok: true; accountId: string; orderId: string;
      /** ACS 認証画面の URL (302/location.href で遷移) */
      redirect?: string;
      /** 認証開始URL が無い環境向けの自動遷移 HTML (加工禁止・そのまま描画) */
      contents?: string }
  | { ok: false; error: string; vResultCode?: string | null; vtDetail?: string | null };

export async function start3dsSubscription(
  input: SubscribeInput & { cardholderName?: string | null; requestOrigin?: string | null },
): Promise<Start3dsResult> {
  const tenantId = input.tenantId || DEFAULT_TENANT_ID;
  const plan = await loadPlan(input.planId);
  if (!plan) return { ok: false, error: "unknown-plan" };

  const cfg = await loadVeritransConfig(tenantId);
  if (!cfg.merchantCcid || !cfg.merchantKey) return { ok: false, error: "veritrans-not-configured" };

  // 3DS はブラウザ遷移で戻す絶対 URL が必須 (redirectionUri/pushUrl は https)。
  // NEXT_PUBLIC_* はビルド時に埋め込まれるため、環境変数の設定後に再ビルドされていない
  // デプロイやプレビュー環境では空になりうる。実リクエストの origin を確実な代替とする
  // (env は明示指定の上書き手段として優先)。
  const envUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const appUrl = envUrl.startsWith("https://")
    ? envUrl
    : (input.requestOrigin ?? "").replace(/\/+$/, "");
  if (!appUrl.startsWith("https://")) return { ok: false, error: "app-url-not-configured" };

  const accountId = input.caseId ? accountIdFromCaseId(input.caseId) : newAccountId();
  if (!isValidAccountId(accountId)) return { ok: false, error: "invalid-account-id" };

  const existing = await getContractByAccountId(accountId);
  if (existing && existing.tenant_id !== tenantId) {
    return { ok: false, error: "already-subscribed" };
  }
  if (existing && existing.status !== "canceled") {
    // suspended は「3DS 認証待ちで離脱した契約」の可能性がある。前回の取引を VT に照会し、
    //   成功済み → その場で有効化 (ブラウザ復帰が失われたケースの救済) → already-subscribed
    //   確定失敗 → 前回試行を閉じて再申込を許可
    //   結果不明 → 認証がまだ進行中かもしれない (完了されると二重課金になるため再申込は拒否。
    //              verifyTimeout=15分 経過後は VT 側で確定失敗になり再申込可能になる)
    if (existing.status === "suspended") {
      const pendings = await getPending3dsOrders(existing.id);
      if (!pendings.length) return { ok: false, error: "already-subscribed" };
      let allFailed = true;
      for (const p of pendings) {
        const fin = await finalizeMpiOrder(p);
        if (fin.state === "activated" || fin.state === "already-active") {
          return { ok: false, error: "already-subscribed" };
        }
        if (fin.state !== "failed" && fin.state !== "already-failed") allFailed = false;
      }
      if (!allFailed) return { ok: false, error: "3ds-in-progress" };
      // 全試行が確定失敗 → 契約は finalizeMpiOrder が canceled 化済み。新規申込として続行
    } else {
      return { ok: false, error: "already-subscribed" };
    }
  }

  // 同意ログ (§1.1-2) — 決済前に保存 (registerSubscription と同一)
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

  const crm = supabaseCrmAdapter(tenantId);
  const customerId = await upsertCustomerBestEffort(crm, input);

  const policy = await loadBillingPolicy();
  const freeMonths = policy.freeMonths;
  const useFreePeriod = freeMonths > 0;
  const today = todayJst();
  const serviceStart = normalizeDate(input.serviceStartDate) ?? firstChargeDate(today, 1);
  const anchorDay = useFreePeriod ? policy.chargeDay : parseInt(today.slice(8, 10), 10);
  const nextChargeDate = useFreePeriod
    ? firstChargeDate(serviceStart, freeMonths, policy.chargeDay)
    : nextChargeDateAfter(monthOf(today), anchorDay);

  // 契約を「suspended (自動課金対象外)」で先に作る:
  //   - finalize が orderId → 課金行 → 契約 とたどって申込情報を復元するための置き場
  //   - suspended は listDueContracts の対象外なので認証完了まで課金されない
  //   - next_charge_date は有効化後の値を先に入れておく (suspended 中は参照されない)
  const initAttempt = Math.max(1, await countConsentsForAccount(accountId));
  const suffix = initAttempt === 1 ? "" : `_s${initAttempt - 1}`;
  const orderId = `${accountId}_${yyyymmOf(today)}_3ds${suffix}`;

  let contract: ContractRow;
  if (existing) {
    await updateContractRow(existing.id, {
      status: "suspended",
      plan_id: plan.id,
      plan_name: plan.name,
      amount: plan.amount,
      next_charge_date: nextChargeDate,
      consecutive_failures: 0,
      customer_id: customerId,
      canceled_at: null,
    });
    contract = { ...existing, status: "suspended", plan_id: plan.id, amount: plan.amount };
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
      next_charge_date: nextChargeDate,
      status: "suspended",
      contact_name: input.name,
      contact_phone: input.phone,
      contact_email: input.email ?? null,
      free_key: customerId,
    });
  }
  await updateServiceStartDate(contract.id, serviceStart);

  // 課金行 (ok=null) を VT 呼び出し前に確保 — orderId UNIQUE が冪等の要 (§5-② と同型)。
  // 無料期間ありは 0 円与信 (カード有効性確認+会員登録のみ。ガイド 4.2.1: 少額与信は
  // ブランドルール禁止・0円で実施) なので amount=0 を記録する。
  const chargeAmount = useFreePeriod ? 0 : plan.amount;
  const attempt = await beginChargeAttempt({
    tenant_id: tenantId,
    contract_id: contract.id,
    order_id: orderId,
    charge_month: monthOf(today),
    kind: "initial",
    attempt: initAttempt,
    amount: chargeAmount,
  });
  if (attempt === "duplicate") {
    // 同一 orderId が処理中 (二重POST等)。進行中扱いにして重複開始を防ぐ
    return { ok: false, error: "3ds-in-progress" };
  }

  const res = await authorizeMpi({
    orderId,
    amount: chargeAmount,
    token: input.token,
    tokenKey: input.tokenKey ?? undefined,
    accountId,                                  // 会員登録+カード登録を同時実行 (SPEC_CHECK: 2-3)
    pushUrl: `${appUrl}/api/payments/veritrans/mpi-result`,
    redirectionUri: `${appUrl}/api/payments/veritrans/mpi-return`,
    cardholderName: input.cardholderName ?? undefined,
    cardholderEmail: input.email ?? undefined,  // ブランドルール必須 (メール or 電話)
    customerIp: input.consent.ip ?? undefined,  // 同 (注3)
    withCapture: !useFreePeriod,                // 0円与信に true は不可 (ガイド 4.3.1)
    verifyTimeoutMin: MPI_VERIFY_TIMEOUT_MIN,
    httpUserAgent: input.consent.userAgent ?? undefined,
  }, cfg);

  const indeterminate = res.pending || res.indeterminate;
  if (!res.ok && !indeterminate) {
    // 認可の確定失敗 (パラメータ不備・カード不正等)。課金行を閉じ、契約を canceled に
    // 戻して再申込 (orderId は _sN で変わる) を可能にする
    const vtDetail = extractVtDetail(res.raw);
    console.error("[payments/3ds] mpi start failed:", res.vResultCode, vtDetail);
    await finishChargeAttempt(attempt.id, {
      ok: false, mstatus: res.mstatus, v_result_code: res.vResultCode,
    });
    await updateContractRow(contract.id, { status: "canceled", next_charge_date: null, canceled_at: new Date().toISOString() });
    return { ok: false, error: "charge-failed", vResultCode: res.vResultCode, vtDetail };
  }
  if (indeterminate) {
    // 認可の応答が得られない (通信断等)。VT 側で開始済みの可能性があるため課金行は
    // ok=null のまま在疑義に残す (/admin の手動確定 or 再申込時の照会で解消)
    await markChargePending(attempt.id, {
      mstatus: res.mstatus ?? "unknown",
      v_result_code: res.vResultCode
        ?? (res.transportError ? `TRANSPORT:${res.transportError}`.slice(0, 64) : null),
    });
    return { ok: false, error: "charge-pending", vResultCode: res.vResultCode };
  }

  // 認可成功 — ブラウザを ACS へ遷移させる材料を返す。契約はまだ suspended のまま。
  // 有効化は finalizeMpiOrder (PUSH/ブラウザ復帰 → MpiGetResult 照会) が行う。
  if (!res.authStartUrl && !res.resResponseContents) {
    // 3DS2.0 リクエストになっていない (deviceChannel 欠落等) — 実装/設定不備
    console.error("[payments/3ds] no authStartUrl/resResponseContents in response");
    await markChargePending(attempt.id, { mstatus: res.mstatus, v_result_code: res.vResultCode });
    return { ok: false, error: "3ds-start-invalid", vResultCode: res.vResultCode };
  }
  // 開始時刻マーカー (確定時に上書きされる)。チャレンジ画面で離脱・放置された取引を
  // 期限後にみなし失敗へ落とすための起点 (isMpiWaitExpired)
  await markChargePending(attempt.id, {
    mstatus: "3ds-authorize-started",
    v_result_code: `${MPI_WAIT_MARKER}${Date.now()}`,
  }).catch(() => { /* マーカー失敗でも申込は続行 (期限解放が効かなくなるだけ) */ });
  return {
    ok: true, accountId, orderId,
    redirect: res.authStartUrl,
    contents: res.authStartUrl ? undefined : res.resResponseContents,
  };
}

/** 契約に紐づく未確定 (ok=null) の 3DS 初回取引の orderId 一覧 (再申込時の前回照会用)。
 *  3DS の orderId は `_3ds` を含む規約 (start3dsSubscription)。 */
async function getPending3dsOrders(contractId: string): Promise<string[]> {
  const { createSupabaseService } = await import("@/shared/db/service");
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("order_id")
    .eq("contract_id", contractId)
    .is("ok", null)
    .like("order_id", "%\\_3ds%");
  if (error) return [];
  return (data ?? []).map((r: any) => String(r.order_id));
}

export type FinalizeMpiState =
  | "activated"        // この呼び出しが契約を有効化した (成功後処理も実行済み)
  | "already-active"   // 他経路が確定済み (成功)
  | "failed"           // 認証/決済の失敗として確定した (契約は canceled)
  | "already-failed"   // 他経路が失敗確定済み
  | "pending"          // まだ確定できない (認証進行中・照会不達・カード保留)
  | "unknown-order";   // orderId に対応する課金行が無い (ログのみ・リトライ不要)

export type FinalizeMpiResult = {
  state: FinalizeMpiState;
  accountId?: string;
  nextChargeDate?: string | null;
  vResultCode?: string | null;
};

// 3DS 結果の確定 (PUSH / ブラウザ復帰 / 再申込時の救済照会から呼ばれる)。
// どの経路から何度呼ばれても安全 (claim による冪等化 + 常に VT へ照会して判定)。
export async function finalizeMpiOrder(orderId: string): Promise<FinalizeMpiResult> {
  const charge = await getChargeByOrderId(orderId);
  if (!charge) {
    console.error("[payments/3ds] finalize: unknown orderId:", orderId.slice(0, 120));
    return { state: "unknown-order" };
  }
  const contract = await getContractById(charge.contract_id);
  if (!contract) return { state: "unknown-order" };

  if (charge.ok !== null) {
    // 既に確定済み — 現状を返すだけ (冪等)
    return charge.ok
      ? { state: "already-active", accountId: contract.account_id, nextChargeDate: contract.next_charge_date }
      : { state: "already-failed", accountId: contract.account_id, vResultCode: charge.v_result_code };
  }

  // 放置された取引をみなし失敗で閉じる (再申込の解放)。verifyTimeout+余裕 経過後は
  // 遅れて認証が完了しても VT 側で与信されないため、失敗確定しても取りはぐれない
  const expireAbandoned = async (): Promise<FinalizeMpiResult> => {
    const claimed = await claimChargeFinalization(charge.id, {
      ok: false, mstatus: "3ds-expired", v_result_code: "3DS-EXPIRED",
    }).catch(() => false);
    // 契約を解約に戻すのは「認証待ちのまま (suspended)」の申込だけ。既に成立している契約に
    // 古い未確定行が残っていた場合、それを閉じたことで生きている契約を解約してはならない
    if (claimed && contract.status === "suspended") {
      await updateContractRow(contract.id, {
        status: "canceled", next_charge_date: null, last_result_code: "3DS-EXPIRED",
        canceled_at: new Date().toISOString(),
      });
    }
    return { state: claimed ? "failed" : "already-failed", accountId: contract.account_id, vResultCode: "3DS-EXPIRED" };
  };

  const cfg = await loadVeritransConfig(contract.tenant_id);
  const q = await getMpiResult(orderId, cfg);
  if (q.indeterminate || !q.ok) {
    // 照会自体が失敗/不達 — 原則確定しない (PUSH のリトライ or 次の経路に任せる)。
    // 例外: 0円与信 (無料期間の登録取引・金銭移動なし) は期限超過でみなし失敗にして
    // 再申込を解放する。金額ありは在疑義のまま /admin の手動確定に委ねる (取りはぐれ防止)
    if (charge.amount === 0 && isMpiWaitExpired(charge.v_result_code)) return expireAbandoned();
    return { state: "pending", accountId: contract.account_id };
  }

  const mpiOk = q.mpiMstatus === "success";
  const mpiFailed = q.mpiMstatus === "failure";
  const cardOk = q.cardMstatus === "success";
  const cardFailed = q.cardMstatus === "failure";
  const cardPending = q.cardMstatus === "pending";
  const resultCode = q.mpiVresultCode ?? q.vResultCode ?? null;

  if (!q.mpiMstatus) {
    // 本人認証の結果がまだ無い = 認証進行中 (チャレンジ入力中など)。
    // 失敗と誤確定してはならない (完了直前の取り消し→与信成立で不整合になる)。
    // 期限超過なら放置とみなして閉じる (verifyTimeout 後の与信は成立しないため安全)
    if (isMpiWaitExpired(charge.v_result_code)) return expireAbandoned();
    return { state: "pending", accountId: contract.account_id };
  }
  if (mpiOk && cardPending) {
    // カード側が保留 — 在疑義のまま (既存の手動確定フローで解消)
    return { state: "pending", accountId: contract.account_id, vResultCode: resultCode };
  }
  if (mpiOk && !q.cardMstatus) {
    // 認証は成功したがカード結果が無い:
    //   - RReq 直後で与信処理中の可能性 → 確定せず待つ (成立しうるので期限でも閉じない)
    //   - mpi-none 設定 (与信は加盟店実装) は当アプリでは未対応 (.env 参照)
    return { state: "pending", accountId: contract.account_id, vResultCode: resultCode };
  }

  if (mpiOk && cardOk) {
    let claimed = false;
    try {
      claimed = await claimChargeFinalization(charge.id, {
        ok: true, mstatus: "success", v_result_code: resultCode,
      });
    } catch (e: any) {
      // 月次成功の部分 UNIQUE (contract_id, charge_month WHERE ok=true) 衝突 =
      // 同月に別 orderId の成功が既にある (放置→再申込→両方完了の二重課金痕跡)。
      // ok=null のまま在疑義に残し、/admin の手動確定 (返金判断) に回す
      console.error("[payments/3ds] duplicate success for month (possible double capture):",
        orderId, String(e?.message ?? e));
      return { state: "pending", accountId: contract.account_id, vResultCode: resultCode };
    }
    if (!claimed) {
      return { state: "already-active", accountId: contract.account_id, nextChargeDate: contract.next_charge_date };
    }

    // 契約有効化 (next_charge_date は start3ds が計算済み)
    await updateContractRow(contract.id, {
      status: "active",
      consecutive_failures: 0,
      last_result_code: resultCode,
      ...(charge.amount > 0 ? { last_charged_at: new Date().toISOString() } : {}),
    });

    // 成功後処理 (registerSubscription の成功パスと同等)。失敗しても有効化は成立済み
    const planName = contract.plan_name ?? contract.plan_id;
    const serviceStart = (await getServiceStartMap([contract.id])).get(contract.id) ?? null;
    const freePeriod = charge.amount === 0;
    if (contract.customer_id) {
      await supabaseCrmAdapter(contract.tenant_id).updateContract(contract.customer_id, {
        accountId: contract.account_id, planId: contract.plan_id, paymentMethod: "card", status: "active",
        nextChargeDate: contract.next_charge_date ?? undefined, orderId,
        lastResult: { vResultCode: resultCode, at: new Date().toISOString() },
      }).catch(() => { /* CRM メモ更新失敗で確定は失敗させない */ });
    }
    await notifyRegistration(contract.tenant_id, {
      accountId: contract.account_id, planName, amount: contract.amount,
      name: contract.contact_name ?? "", phone: contract.contact_phone ?? "",
      email: contract.contact_email,
      firstChargeDate: freePeriod ? contract.next_charge_date : null,
    }).catch(() => {});
    await appendSignupRow({
      registeredAt: new Date().toISOString(),
      accountId: contract.account_id, planName,
      name: contract.contact_name ?? "", phone: contract.contact_phone ?? "",
    }).catch(() => {});
    // ① エントリータブへ記録 + ② プレミアムならライセンスキー付与
    // (3DS は認証完了=案件確定のこのタイミング。suspended 中は書かない)
    await recordEntryFromContract(contract, serviceStart);
    if (contract.contact_email) {
      await sendWelcomeEmail(contract.tenant_id, {
        to: contract.contact_email,
        name: contract.contact_name ?? "",
        accountId: contract.account_id,
        planName,
        amount: contract.amount,
        serviceStartDate: serviceStart ?? todayJst(),
        chargeStartDate: contract.next_charge_date ?? "",
      }).catch((e) => console.error("[payments/3ds] welcome mail failed:", String(e?.message ?? e)));
    }
    return { state: "activated", accountId: contract.account_id, nextChargeDate: contract.next_charge_date };
  }

  // ここに来るのは mpiFailed または (mpiOk && cardFailed) のはず。想定外の値は
  // 誤確定を避けて保留に落とす (success/failure/pending 以外は仕様外)
  if (!(mpiFailed || (mpiOk && cardFailed))) {
    console.error("[payments/3ds] unexpected result statuses:",
      orderId, q.mpiMstatus, q.cardMstatus);
    return { state: "pending", accountId: contract.account_id, vResultCode: resultCode };
  }

  // 認証失敗 or カード与信失敗 (結果判定マトリックス 4-3: GExx 系) — 確定失敗
  const claimed = await claimChargeFinalization(charge.id, {
    ok: false, mstatus: q.mpiMstatus ?? q.mstatus, v_result_code: resultCode,
  }).catch(() => false);
  if (claimed && contract.status === "suspended") {
    // 契約は作られたが決済に至らなかった — canceled に戻して再申込を可能にする。
    // 認証待ち (suspended) の契約に限る: 別試行で既に成立している契約は解約しない
    await updateContractRow(contract.id, {
      status: "canceled", next_charge_date: null, last_result_code: resultCode,
      canceled_at: new Date().toISOString(),
    });
  }
  return {
    state: claimed ? "failed" : "already-failed",
    accountId: contract.account_id, vResultCode: resultCode,
  };
}

// ---- 在疑義スイーパー (放置された 3DS 申込の自動片付け) ----------------------
//
// finalizeMpiOrder は「みなし失敗で閉じる」判断 (isMpiWaitExpired → expireAbandoned) を
// 持っているが、それを呼ぶ経路が PUSH / ブラウザ復帰 / 結果ページ再表示 / 再申込 の
// 4つしかない。ACS 認証画面で離脱した客はどれも通らないため、課金行が ok=null のまま
// 永久に残り (管理ボードで「確認中」)、契約も suspended のままで課金対象にならない。
// = 片付ける道具はあるのに実行する人がいない状態。ここがその実行役。
//
// 安全側の線引き:
//   - 対象は申込時の本人認証取引のみ (listInDoubt3dsCharges が kind/orderId で限定)
//   - さらに 0円与信 (無料期間の登録取引) に限る。金額ありは finalizeMpiOrder 側でも
//     期限失効を抑止しているが、ここでも入口で弾いて二重の歯止めにする
//   - 確定はすべて finalizeMpiOrder 経由 = 必ず MpiGetResult (署名付き照会) の結果に従う。
//     このスイーパー自身は成否を推測しない

export type MpiSweepSummary = {
  scanned: number;
  /** みなし失敗として閉じた (契約 canceled → 再申込を解放) */
  closed: number;
  /** 照会したら成功していた (PUSH/復帰が失われた取引の救済。契約を有効化済み) */
  activated: number;
  /** まだ確定できない (認証進行中・照会不達)。次回のスイープで再試行 */
  stillPending: number;
  /** 金額ありのため自動処理しなかった (手動確定 resolveInDoubtCharge に回す) */
  skippedPaid: number;
  errors: string[];
};

/** 1回のスイープで見る最大件数 */
const MPI_SWEEP_LIMIT = 200;
/** 実行時間バジェット (maxDuration=60s の内側で安全に打ち切る)。残りは次回のスイープが拾う */
const MPI_SWEEP_BUDGET_MS = 45_000;

export async function sweepAbandoned3ds(): Promise<MpiSweepSummary> {
  const startedAt = Date.now();
  const summary: MpiSweepSummary = {
    scanned: 0, closed: 0, activated: 0, stillPending: 0, skippedPaid: 0, errors: [],
  };
  const rows = await listInDoubt3dsCharges(MPI_SWEEP_LIMIT);

  for (const row of rows) {
    if (Date.now() - startedAt > MPI_SWEEP_BUDGET_MS) {
      summary.errors.push("time-budget-exceeded: 残りは次回のスイープで処理");
      break;
    }
    summary.scanned++;

    // 金銭移動を伴う取引には触れない (運用者の判断に委ねる)
    if (row.amount > 0) {
      summary.skippedPaid++;
      continue;
    }
    // 開始直後は認証中の可能性があるので触らない。マーカーが無い行 (認可要求が
    // 届かなかった等) は経過を測れないため、照会して VT 側の事実を確認する
    if (row.v_result_code?.startsWith(MPI_WAIT_MARKER) && !isMpiWaitExpired(row.v_result_code)) {
      summary.stillPending++;
      continue;
    }

    try {
      const fin = await finalizeMpiOrder(row.order_id);
      if (fin.state === "activated" || fin.state === "already-active") summary.activated++;
      else if (fin.state === "failed" || fin.state === "already-failed") {
        summary.closed++;
        // 稀に「別の試行で申込は成立済みなのに、古い未確定行だけが残っていた」ことがある。
        // その行を閉じた今は申込未完了ではなくなる → 見送っていたエントリー行を補う
        await backfillEntryAfterClose(row.order_id).catch((e: any) =>
          summary.errors.push(`${row.order_id}: entry backfill ${String(e?.message ?? e).slice(0, 120)}`));
      }
      else if (fin.state === "pending") summary.stillPending++;
      else summary.errors.push(`${row.order_id}: ${fin.state}`);
    } catch (e: any) {
      summary.errors.push(`${row.order_id}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  return summary;
}

/** 未確定行を閉じた直後の補完。契約が生きている (=別試行で申込は成立していた) 場合だけ
 *  ①② を記録する。既に書かれていれば appendEntryRow の重複ガードが弾く。 */
async function backfillEntryAfterClose(orderId: string): Promise<void> {
  const charge = await getChargeByOrderId(orderId);
  if (!charge) return;
  const contract = await getContractById(charge.contract_id);
  // canceled = 申込は不成立 / suspended = まだ決済登録が終わっていない → どちらも書かない
  if (!contract || contract.status === "canceled" || contract.status === "suspended") return;
  await recordEntryFromContract(contract);
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
  const policy = await loadBillingPolicy();
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
  const policy = await loadBillingPolicy();
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
    // 通知失敗でこの契約の処理を落とさない (状態更新は上で済んでいる)
    await notifyCardExpired(contract).catch((e) =>
      console.error("[payments] card-expired notify failed:", String(e?.message ?? e)));
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
  const policy = await loadBillingPolicy();
  // 自社宛の運用通知 (顧客宛の再登録依頼は §10 メール取得要否の確定後に自動化)
  if (!policy.notifyEmail) return;
  const body = [
    "カード期限切れ (もしくは期限切れ相当の失敗) を検知しました。カード更新フローへの案内が必要です。",
    "",
    `会員ID: ${contract.account_id}`,
    `氏名: ${contract.contact_name ?? "-"} / 電話: ${contract.contact_phone ?? "-"}`,
    `カード更新URL: /subscribe/update-card?account=${contract.account_id}`,
  ].join("\n");
  await sendMail(
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
    // 申込 (初回登録) の在疑義をここで成功確定した = この時点で申込が成立し「利用前」になる。
    // 未完了のあいだ見送っていた ①エントリー行 / ②ライセンスキーを改めて記録する
    // (既に書かれていれば重複ガードで書かない)。
    if (charge.kind === "initial") {
      const fresh = await getContractById(contract.id).catch(() => null);
      if (fresh) {
        await recordEntryFromContract(fresh).catch((e: any) =>
          console.error("[payments] entry sheet after manual resolve failed:", String(e?.message ?? e)));
      }
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

  // 解約ポリシー (管理画面 /admin/settings):
  //   end_of_month(既定) … 退会手続き当月末日24時まで利用可・翌月から停止 (§規約 有効期間3)
  //   immediate          … 即時停止 (当日まで)
  // いずれも次回課金は停止する (日割り返金なし=当月分は請求済み)。
  const policy = await loadBillingPolicy();
  const effectiveUntil = policy.cancelPolicy === "immediate" ? todayJst() : endOfMonth(todayJst());

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

  // ③ 連携スプレッドシート「解約」タブへ記録 (非ブロッキング)。
  //    解約日は解約手続き日 (有効期限 effectiveUntil ではなく手続きを行った日)。
  const serviceStart = (await getServiceStartMap([contract.id]).catch(() => new Map()))
    .get(contract.id) ?? null;
  await appendCancelRow({
    customerId: contract.account_id,
    contractDate: jstDateOf(contract.started_at),
    serviceStartDate: serviceStart ?? "",
    canceledDate: todayJst(),
    serviceName: contract.plan_name ?? contract.plan_id,
  }).catch((e) => console.error("[payments] cancel sheet failed:", String(e?.message ?? e)));

  return { ok: true, effectiveUntil };
}
