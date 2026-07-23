import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { getServiceStartMap } from "./store";
import { loadBillingPolicy, firstChargeDate, todayJst } from "./billing-config";

// 登録者管理ボードの1行 (カード等の決済個人情報は一切含めない §7)。
export type RegistrantRow = {
  accountId: string;
  planName: string;
  appliedAt: string;        // 申込日 (YYYY-MM-DD, JST)
  serviceStart: string;     // 利用開始日 = 加入日の翌月1日 (§規約 有効期間)
  chargeStart: string;      // 課金開始日 = 無料期間終了後の初回課金日
  canceledAt: string | null;// 解約日
  paymentMethod: string;    // card / bank
  statusLabel: "利用前" | "利用中" | "解約";
  rawStatus: string;        // active/delinquent/suspended/canceled/card_expired
  name: string | null;
  phone: string | null;
  email: string | null;
  consented: boolean;       // 利用規約 同意済み
  monthBilling: "正常" | "決済不備" | "確認中" | "未課金" | "対象外";
  billingAlert: boolean;    // 決済不備・確認中・延滞・期限切れ等の要注意
};

export type Board = {
  month: string;            // 対象月 YYYY-MM
  rows: RegistrantRow[];
  counts: { total: number; active: number; before: number; canceled: number; alerts: number };
};

// timestamptz(UTC) → JST の日付 (YYYY-MM-DD)
function jstDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function loadBoard(opts: { month: string; status?: string; q?: string }): Promise<Board> {
  const svc = createSupabaseService();
  const policy = await loadBillingPolicy();
  const today = todayJst();
  const month = opts.month;

  const { data: contracts, error } = await svc
    .from("payment_contracts")
    .select("id, account_id, plan_name, plan_id, payment_method, status, started_at, next_charge_date, canceled_at, contact_name, contact_phone, contact_email")
    .order("started_at", { ascending: false });
  if (error) throw new Error(`payment_contracts query failed: ${error.message}`);

  const rowsRaw = contracts ?? [];
  const ids = rowsRaw.map((c: any) => c.id);

  // 利用開始日 (選択値。列 p001 未適用なら空 → 申込日から推定)
  const ssMap = await getServiceStartMap(ids);

  // 同意記録の有無 (account_id 単位)
  const { data: consents } = await svc.from("payment_consents").select("account_id");
  const consentSet = new Set((consents ?? []).map((c: any) => c.account_id));

  // 対象月の課金結果 (contract_id 単位に集約)
  const chargesByContract = new Map<string, { ok: boolean | null }[]>();
  if (ids.length) {
    const { data: charges } = await svc
      .from("payment_charges")
      .select("contract_id, ok")
      .eq("charge_month", month)
      .in("contract_id", ids);
    for (const ch of charges ?? []) {
      const arr = chargesByContract.get((ch as any).contract_id) ?? [];
      arr.push({ ok: (ch as any).ok });
      chargesByContract.set((ch as any).contract_id, arr);
    }
  }

  const rows: RegistrantRow[] = rowsRaw.map((c: any) => {
    const applied = jstDate(c.started_at);
    // 利用開始日: 選択値があればそれ、無ければ申込日の翌月1日を推定
    const chosen = ssMap.get(c.id) || null;
    const serviceStart = chosen ?? (applied ? firstChargeDate(applied, 1) : "");
    // 課金開始日: 利用開始日 + freeMonths の1日 (無料期間0なら利用開始日)
    const chargeBasis = chosen ?? applied;
    const chargeStart = chargeBasis
      ? (policy.freeMonths > 0 ? firstChargeDate(chargeBasis, policy.freeMonths) : chargeBasis)
      : "";
    const canceledAt = c.canceled_at ? jstDate(c.canceled_at) : null;

    // 状況ラベル
    let statusLabel: RegistrantRow["statusLabel"];
    if (c.status === "canceled") statusLabel = "解約";
    else if (serviceStart && today < serviceStart) statusLabel = "利用前";
    else statusLabel = "利用中";

    // 対象月の課金状況
    const chs = chargesByContract.get(c.id) ?? [];
    let monthBilling: RegistrantRow["monthBilling"];
    if (chs.some((x) => x.ok === true)) monthBilling = "正常";
    else if (chs.some((x) => x.ok === false)) monthBilling = "決済不備";
    else if (chs.some((x) => x.ok === null)) monthBilling = "確認中";
    else {
      const chargeMonth = chargeStart.slice(0, 7);
      if (!chargeStart || month < chargeMonth) monthBilling = "対象外";       // 無料期間/利用開始前
      else if (c.status === "canceled" && canceledAt && canceledAt.slice(0, 7) < month) monthBilling = "対象外";
      else monthBilling = "未課金";
    }

    const billingAlert =
      ["delinquent", "suspended", "card_expired"].includes(c.status) ||
      monthBilling === "決済不備" || monthBilling === "確認中" ||
      (monthBilling === "未課金" && c.status !== "canceled");

    return {
      accountId: c.account_id,
      planName: c.plan_name ?? c.plan_id ?? "",
      appliedAt: applied,
      serviceStart,
      chargeStart,
      canceledAt,
      paymentMethod: "クレジットカード",
      statusLabel,
      rawStatus: c.status,
      name: c.contact_name,
      phone: c.contact_phone,
      email: c.contact_email,
      consented: consentSet.has(c.account_id),
      monthBilling,
      billingAlert,
    };
  });

  let filtered = opts.status && opts.status !== "all"
    ? rows.filter((r) => (opts.status === "alert" ? r.billingAlert : r.statusLabel === opts.status))
    : rows;

  // 会員ID または お客様名での検索
  const q = (opts.q ?? "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (r) => r.accountId.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q),
    );
  }

  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.statusLabel === "利用中").length,
    before: rows.filter((r) => r.statusLabel === "利用前").length,
    canceled: rows.filter((r) => r.statusLabel === "解約").length,
    alerts: rows.filter((r) => r.billingAlert).length,
  };

  return { month, rows: filtered, counts };
}
