// 決済モジュールの永続化層 (payment_contracts / payment_charges / payment_consents)。
// 公開申込・Cron は認証セッションを持たないため service_role で書き込む。
// テナント境界は必ず tenant_id 条件で強制すること (RLS バイパスのため)。
import "server-only";
import { createSupabaseService } from "@/shared/db/service";

export type ContractRow = {
  id: string;
  tenant_id: string;
  account_id: string;
  customer_id: string | null;
  deal_id: string | null;
  plan_id: string;
  plan_name: string | null;
  amount: number;
  payment_method: "card" | "bank";
  status: "active" | "delinquent" | "suspended" | "canceled" | "card_expired";
  started_at: string;
  anchor_day: number;
  next_charge_date: string | null;
  consecutive_failures: number;
  last_result_code: string | null;
  last_charged_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  free_key: string | null;
  /** 利用開始日 (2ヶ月無料の起点)。列 p001 未適用の環境では未取得(undefined)。基本SELECTには含めない。 */
  service_start_date?: string | null;
  /** ウイルスバスターのライセンスキー。列 p002 未適用の環境では未取得(undefined)。基本SELECTには含めない。 */
  license_key?: string | null;
};

const CONTRACT_COLS =
  "id, tenant_id, account_id, customer_id, deal_id, plan_id, plan_name, amount, payment_method, status, " +
  "started_at, anchor_day, next_charge_date, consecutive_failures, last_result_code, last_charged_at, " +
  "contact_name, contact_phone, contact_email, free_key";

/** 利用開始日をベストエフォートで保存 (列 p001 未適用でも申込を失敗させない)。 */
export async function updateServiceStartDate(id: string, date: string | null): Promise<void> {
  try {
    const service = createSupabaseService();
    await service.from("payment_contracts").update({ service_start_date: date }).eq("id", id);
  } catch { /* 列が無ければ黙って無視 (管理表示は申込日から推定) */ }
}

/** ライセンスキーをベストエフォートで保存 (列 p002 未適用でも申込を失敗させない)。 */
export async function updateLicenseKey(id: string, key: string | null): Promise<void> {
  try {
    const service = createSupabaseService();
    await service.from("payment_contracts").update({ license_key: key }).eq("id", id);
  } catch { /* 列が無ければ黙って無視 (シート側には付与済みの記録が残る) */ }
}

/** contract_id → ライセンスキー のマップをベストエフォートで取得 (列 p002 未適用なら空)。 */
export async function getLicenseKeyMap(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  try {
    const service = createSupabaseService();
    const { data, error } = await service
      .from("payment_contracts").select("id, license_key").in("id", ids);
    if (error) return map;
    for (const r of data ?? []) map.set((r as any).id, (r as any).license_key ?? null);
  } catch { /* 列が無ければ空マップ */ }
  return map;
}

/** contract_id → 利用開始日 のマップをベストエフォートで取得 (列 p001 未適用なら空)。 */
export async function getServiceStartMap(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  try {
    const service = createSupabaseService();
    const { data, error } = await service
      .from("payment_contracts").select("id, service_start_date").in("id", ids);
    if (error) return map;
    for (const r of data ?? []) map.set((r as any).id, (r as any).service_start_date ?? null);
  } catch { /* 列が無ければ空マップ */ }
  return map;
}

/** contract_id → エントリー済み日時 のマップをベストエフォートで取得 (列 p004 未適用なら空)。 */
export async function getEnteredMap(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!ids.length) return map;
  try {
    const service = createSupabaseService();
    const { data, error } = await service
      .from("payment_contracts").select("id, entered_at").in("id", ids);
    if (error) return map;
    for (const r of data ?? []) map.set((r as any).id, (r as any).entered_at ?? null);
  } catch { /* 列が無ければ空マップ (全件「未エントリー」表示になる) */ }
  return map;
}

/**
 * 会員IDの一覧に「エントリー済み」を立てる / 外す (管理画面のチェック保存)。
 *
 * 他のベストエフォート系と違い、ここは失敗を握りつぶさない —
 * 担当者が「保存した」と思ったまま記録されていないと、エントリー漏れに直結するため。
 * 列 p004 が未適用ならその旨を error で返す。
 */
export async function setEnteredByAccountIds(
  accountIds: string[],
  entered: boolean,
): Promise<{ ok: boolean; count: number; error?: string }> {
  const ids = accountIds.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!ids.length) return { ok: true, count: 0 };
  try {
    const service = createSupabaseService();
    let qb = service
      .from("payment_contracts")
      .update({ entered_at: entered ? new Date().toISOString() : null })
      .in("account_id", ids);
    // 既にエントリー済みの案件は日時を上書きしない (いつ対応したかの記録を残すため)。
    // 結果の件数も「実際に変わった件数」になる。
    if (entered) qb = qb.is("entered_at", null);
    const { data, error } = await qb.select("id");
    if (error) return { ok: false, count: 0, error: error.message };
    return { ok: true, count: (data ?? []).length };
  } catch (e: any) {
    return { ok: false, count: 0, error: String(e?.message ?? e) };
  }
}

/**
 * 案件をDBから完全削除する (テスト案件のクリーンアップ用)。
 * payment_charges → payment_consents → payment_contracts の順で物理削除する。
 * ⚠️ 取り消し不可。呼び出し側で本番ガード・確認を必ず行うこと。
 */
export async function hardDeleteContractByAccountId(
  accountId: string,
): Promise<{ ok: boolean; error?: string }> {
  const service = createSupabaseService();
  const { data: c, error: e0 } = await service
    .from("payment_contracts").select("id").eq("account_id", accountId).maybeSingle();
  if (e0) return { ok: false, error: e0.message };
  if (!c) return { ok: false, error: "not-found" };
  const contractId = (c as any).id as string;

  const delCharges = await service.from("payment_charges").delete().eq("contract_id", contractId);
  if (delCharges.error) return { ok: false, error: delCharges.error.message };
  const delConsents = await service.from("payment_consents").delete().eq("account_id", accountId);
  if (delConsents.error) return { ok: false, error: delConsents.error.message };
  const delContract = await service.from("payment_contracts").delete().eq("id", contractId);
  if (delContract.error) return { ok: false, error: delContract.error.message };
  return { ok: true };
}

export async function insertContract(row: {
  tenant_id: string;
  account_id: string;
  customer_id?: string | null;
  plan_id: string;
  plan_name?: string | null;
  amount: number;
  payment_method: "card" | "bank";
  anchor_day: number;
  next_charge_date: string | null;   // 結果不明で作成する契約は null (自動課金対象外)
  status?: "active" | "delinquent" | "suspended" | "canceled" | "card_expired";
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  free_key?: string | null;
}): Promise<ContractRow> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_contracts")
    .insert(row)
    .select(CONTRACT_COLS)
    .single();
  if (error) throw new Error(`payment_contracts insert failed: ${error.message}`);
  return data as ContractRow;
}

export async function getContractByAccountId(accountId: string): Promise<ContractRow | null> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_contracts")
    .select(CONTRACT_COLS)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`payment_contracts select failed: ${error.message}`);
  return (data as ContractRow) ?? null;
}

export async function updateContractRow(
  id: string,
  patch: Partial<
    Pick<
      ContractRow,
      | "status" | "next_charge_date" | "consecutive_failures" | "last_result_code"
      | "last_charged_at" | "customer_id" | "deal_id" | "amount" | "plan_id" | "plan_name"
    >
  > & { canceled_at?: string | null },
): Promise<void> {
  const service = createSupabaseService();
  const { error } = await service.from("payment_contracts").update(patch).eq("id", id);
  if (error) throw new Error(`payment_contracts update failed: ${error.message}`);
}

/** 課金対象 (次回課金日 ≤ 対象日 かつ 契約中/延滞) を抽出 (§5-②) */
export async function listDueContracts(dueDate: string, limit: number): Promise<ContractRow[]> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_contracts")
    .select(CONTRACT_COLS)
    .in("status", ["active", "delinquent"])
    .lte("next_charge_date", dueDate)
    .order("next_charge_date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`payment_contracts due query failed: ${error.message}`);
  return (data ?? []) as ContractRow[];
}

// ---- 課金試行ログ (orderId べき等 §5-②) ----

export type ChargeRow = {
  id: string;
  order_id: string;
  charge_month: string;
  kind: "initial" | "recurring" | "retry";
  attempt: number;
  amount: number;
  ok: boolean | null;
  v_result_code: string | null;
};

/** 対象月の成功課金が既に存在するか (二重課金ガードの1段目) */
export async function hasSuccessfulCharge(contractId: string, chargeMonth: string): Promise<boolean> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("id")
    .eq("contract_id", contractId)
    .eq("charge_month", chargeMonth)
    .eq("ok", true)
    .limit(1);
  if (error) throw new Error(`payment_charges select failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** 対象月に「結果未確定 (ok=null)」の試行が残っているか。
 *  VT 呼び出し成功後・記録前にクラッシュした可能性があり、再課金すると二重課金の
 *  恐れがある → 呼び出し側はスキップして手動照合 (VT 取引照会) に回す。 */
export async function hasInDoubtAttempt(contractId: string, chargeMonth: string): Promise<boolean> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("id")
    .eq("contract_id", contractId)
    .eq("charge_month", chargeMonth)
    .is("ok", null)
    .limit(1);
  if (error) throw new Error(`payment_charges select failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** 申込 (初回登録) の取引が未確定 (ok=null) のまま残っているか。
 *  管理ボードが「申込未完了」を判定する条件 (admin-query の pendingInitial) と同じ。
 *  決済登録が済んでいない申込を連携スプレッドシートへ書かないための入口チェックに使う。 */
export async function hasUnfinishedInitialCharge(contractId: string): Promise<boolean> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("id")
    .eq("contract_id", contractId)
    .eq("kind", "initial")
    .is("ok", null)
    .limit(1);
  if (error) throw new Error(`payment_charges select failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** 対象月の試行回数 (リトライの orderId 採番に使用) */
export async function countAttempts(contractId: string, chargeMonth: string): Promise<number> {
  const service = createSupabaseService();
  const { count, error } = await service
    .from("payment_charges")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId)
    .eq("charge_month", chargeMonth);
  if (error) throw new Error(`payment_charges count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * 課金試行を orderId 一意制約つきで記録する。
 * 呼び出しは「API 実行前に insert (ok=null)」→「結果で update」の順。
 * insert が unique violation なら同じ orderId が処理済み/処理中 → スキップ (べき等)。
 */
export async function beginChargeAttempt(row: {
  tenant_id: string;
  contract_id: string;
  order_id: string;
  charge_month: string;
  kind: "initial" | "recurring" | "retry";
  attempt: number;
  amount: number;
}): Promise<{ id: string } | "duplicate"> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "duplicate"; // unique_violation
    throw new Error(`payment_charges insert failed: ${error.message}`);
  }
  return { id: (data as any).id };
}

export async function finishChargeAttempt(
  id: string,
  result: { ok: boolean; mstatus: string | null; v_result_code: string | null; error?: string | null },
): Promise<void> {
  const service = createSupabaseService();
  const { error } = await service.from("payment_charges").update(result).eq("id", id);
  if (error) throw new Error(`payment_charges update failed: ${error.message}`);
}

/** mstatus="pending" (保留) の試行: ok は null のまま経過だけ記録する。
 *  在疑義として扱われ、当月の再課金は止まる (手動確定 resolveInDoubtCharge で解消)。 */
export async function markChargePending(
  id: string,
  info: { mstatus: string | null; v_result_code: string | null },
): Promise<void> {
  const service = createSupabaseService();
  const { error } = await service.from("payment_charges").update(info).eq("id", id);
  if (error) throw new Error(`payment_charges update failed: ${error.message}`);
}

export async function getContractById(id: string): Promise<ContractRow | null> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_contracts")
    .select(CONTRACT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`payment_contracts select failed: ${error.message}`);
  return (data as ContractRow | null) ?? null;
}

/** orderId から課金試行を取得する (3DS 結果確定などの orderId 起点処理用)。
 *  order_id は UNIQUE のため高々1行。 */
export async function getChargeByOrderId(orderId: string): Promise<
  | { id: string; tenant_id: string; contract_id: string; order_id: string;
      charge_month: string; kind: string; amount: number; ok: boolean | null; v_result_code: string | null }
  | null
> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("id, tenant_id, contract_id, order_id, charge_month, kind, amount, ok, v_result_code")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`payment_charges select failed: ${error.message}`);
  return (data as any) ?? null;
}

/**
 * 未確定 (ok IS NULL) の課金試行を条件付きで確定する。
 * 3DS の結果は「結果通知(PUSH)」と「ブラウザ復帰」の両経路から非同期・順不同・複数回
 * 届くため (ガイド 3-2)、ok IS NULL を条件に UPDATE し、更新できた呼び出しだけが
 * 成功後処理 (契約有効化・通知メール等) を実行する — DB を排他点にした冪等化。
 * @returns true=この呼び出しが確定させた / false=他経路が確定済み (何もしない)
 */
export async function claimChargeFinalization(
  id: string,
  result: { ok: boolean; mstatus: string | null; v_result_code: string | null },
): Promise<boolean> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .update(result)
    .eq("id", id)
    .is("ok", null)
    .select("id");
  if (error) throw new Error(`payment_charges claim failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** 3DS 申込の未確定 (ok=null) 取引を取得する (在疑義スイーパー用)。
 *
 *  対象を kind="initial" かつ order_id が _3ds を含む行に絞るのが要点:
 *  日次課金 (recurring/retry) の在疑義は金銭移動を伴い、勝手に失敗確定すると
 *  別 orderId での再課金 = 二重課金になりうる。自動処理は申込時の本人認証取引だけに
 *  限定し、金額ありの在疑義は従来どおり手動確定 (resolveInDoubtCharge) に委ねる。 */
export async function listInDoubt3dsCharges(limit: number): Promise<
  { id: string; order_id: string; amount: number; v_result_code: string | null }[]
> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("id, order_id, amount, v_result_code")
    .is("ok", null)
    .eq("kind", "initial")
    .like("order_id", "%\\_3ds%")
    .limit(limit);
  if (error) throw new Error(`payment_charges in-doubt query failed: ${error.message}`);
  return (data ?? []) as { id: string; order_id: string; amount: number; v_result_code: string | null }[];
}

/** 在疑義 (ok=null) の課金試行1件を取得する (手動確定用) */
export async function getInDoubtCharge(chargeId: string): Promise<
  | { id: string; tenant_id: string; contract_id: string; order_id: string; charge_month: string;
      kind: string; amount: number }
  | null
> {
  const service = createSupabaseService();
  const { data, error } = await service
    .from("payment_charges")
    .select("id, tenant_id, contract_id, order_id, charge_month, kind, amount, ok")
    .eq("id", chargeId)
    .maybeSingle();
  if (error) throw new Error(`payment_charges select failed: ${error.message}`);
  if (!data || (data as any).ok !== null) return null;   // 在疑義でない行は対象外
  return data as any;
}

/** account_id に紐づく同意記録の件数 (初回課金 orderId の試行番号に使用)。
 *  申込のたびに同意を先に保存するため「これまでの申込試行回数」に一致する。 */
export async function countConsentsForAccount(accountId: string): Promise<number> {
  const service = createSupabaseService();
  const { count, error } = await service
    .from("payment_consents")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (error) throw new Error(`payment_consents count failed: ${error.message}`);
  return count ?? 0;
}

// ---- 同意ログ (§1.1-2) ----

export async function insertConsent(row: {
  tenant_id: string;
  contract_id?: string | null;
  account_id?: string | null;
  terms_version: string;
  plan_id?: string | null;
  payment_method?: string | null;
  ip?: string | null;
  user_agent?: string | null;
}): Promise<void> {
  const service = createSupabaseService();
  const { error } = await service.from("payment_consents").insert(row);
  // 同意ログの失敗で申込全体は止めない (呼び出し側でログして続行してよい)
  if (error) throw new Error(`payment_consents insert failed: ${error.message}`);
}
