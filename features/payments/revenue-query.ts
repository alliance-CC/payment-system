import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { getServiceStartMap } from "./store";
import { loadBillingPolicy, firstChargeDate, todayJst } from "./billing-config";

// 売上予測ボードの集計 (クレジットカードのみ)。カード等の決済個人情報は含めない (§7)。
//   予定(projected) … その月に課金対象となる契約の月額合計 (継続課金の見込み)
//   確定(confirmed) … その月に実際に課金成功した金額合計 (payment_charges ok=true)
//   ・利用者 = その月にサービスが有効な契約 (無料期間中も「利用中」として表示。売上寄与は0)
//   ・解約は「解約月の翌月から」対象外 (解約月は在籍=当月まで課金対象・§規約/解約月の翌月から停止)
export type RevenueUser = {
  accountId: string;
  name: string | null;
  planName: string;
  planAmount: number;                       // プラン月額 (参考)
  usageLabel: "利用中" | "利用予定";          // 本日時点で利用開始済みか
  monthState: "確定" | "課金予定" | "無料";   // 当月の課金状態 (無料=無料期間中で当月は¥0)
};

export type RevenueBoard = {
  month: string;
  year: number;
  users: RevenueUser[];
  monthProjected: number;
  monthConfirmed: number;
  usingCount: number;        // 当月の利用者数 (無料期間含む)
  billingCount: number;      // 当月の課金対象者数 (無料期間除く)
  annual: { month: string; projected: number; confirmed: number }[];
  annualProjected: number;
  annualConfirmed: number;
};

function jstMonth(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

export async function loadRevenue(opts: { month: string }): Promise<RevenueBoard> {
  const svc = createSupabaseService();
  const policy = await loadBillingPolicy();
  const month = opts.month;
  const year = parseInt(month.slice(0, 4), 10);
  const curMonth = todayJst().slice(0, 7);

  const { data: contracts } = await svc
    .from("payment_contracts")
    .select("id, account_id, plan_name, plan_id, amount, status, started_at, canceled_at, contact_name");
  const rowsRaw = contracts ?? [];
  const ids = rowsRaw.map((c: any) => c.id);
  const ssMap = await getServiceStartMap(ids);

  // 当年の課金成功額 (確定) を月×契約で集計
  const { data: charges } = ids.length
    ? await svc.from("payment_charges")
        .select("contract_id, charge_month, amount, ok")
        .gte("charge_month", `${year}-01`).lte("charge_month", `${year}-12`)
        .in("contract_id", ids)
    : { data: [] as any[] };
  const confirmedByMonth = new Map<string, Map<string, number>>();
  for (const ch of charges ?? []) {
    if ((ch as any).ok !== true) continue;
    const m = (ch as any).charge_month as string;
    if (!confirmedByMonth.has(m)) confirmedByMonth.set(m, new Map());
    confirmedByMonth.get(m)!.set((ch as any).contract_id, (ch as any).amount ?? 0);
  }

  // 契約ごとに「利用開始月」「課金開始月」「解約月」を求める
  const meta = rowsRaw.map((c: any) => {
    const startedMonth = jstMonth(c.started_at);
    const chosen = ssMap.get(c.id) || null;
    const svcStart = chosen ?? (startedMonth ? firstChargeDate(`${startedMonth}-01`, 1) : null);
    const serviceStartMonth = svcStart ? svcStart.slice(0, 7) : null;
    const chargeStartMonth = svcStart
      ? (policy.freeMonths > 0 ? firstChargeDate(svcStart, policy.freeMonths) : svcStart).slice(0, 7)
      : null;
    const cancelMonth = c.status === "canceled" ? jstMonth(c.canceled_at) : null;
    return { c, serviceStartMonth, chargeStartMonth, cancelMonth };
  });

  type Meta = (typeof meta)[number];
  // 在籍(利用中): 利用開始月 ≤ M かつ (未解約 or 解約月 ≥ M)。解約月は在籍扱い(当月まで)。
  const usingIn = (m: Meta, M: string) =>
    !!m.serviceStartMonth && m.serviceStartMonth <= M && (!m.cancelMonth || m.cancelMonth >= M);
  // 課金対象: 課金開始月 ≤ M かつ 在籍。無料期間中(課金開始前)は対象外。
  const billableIn = (m: Meta, M: string) =>
    !!m.chargeStartMonth && m.chargeStartMonth <= M && usingIn(m, M);

  // 年間 (月別の予定/確定)
  const annual: { month: string; projected: number; confirmed: number }[] = [];
  let annualProjected = 0, annualConfirmed = 0;
  for (let mm = 1; mm <= 12; mm++) {
    const M = `${year}-${String(mm).padStart(2, "0")}`;
    let proj = 0, conf = 0;
    const cm = confirmedByMonth.get(M);
    for (const m of meta) {
      if (billableIn(m, M)) proj += m.c.amount ?? 0;
      if (cm && cm.has(m.c.id)) conf += cm.get(m.c.id)!;
    }
    annual.push({ month: M, projected: proj, confirmed: conf });
    annualProjected += proj; annualConfirmed += conf;
  }

  // 当月の利用者リスト + 合計
  const users: RevenueUser[] = [];
  let monthProjected = 0, monthConfirmed = 0, billingCount = 0;
  const cmSel = confirmedByMonth.get(month);
  for (const m of meta) {
    const using = usingIn(m, month);
    const billable = billableIn(m, month);
    const billed = !!(cmSel && cmSel.has(m.c.id));
    if (!using && !billed) continue;   // その月に無関係な契約は除外
    const planAmount = m.c.amount ?? 0;
    const monthState: RevenueUser["monthState"] = billed ? "確定" : billable ? "課金予定" : "無料";
    users.push({
      accountId: m.c.account_id,
      name: m.c.contact_name ?? null,
      planName: m.c.plan_name ?? m.c.plan_id ?? "",
      planAmount,
      usageLabel: m.serviceStartMonth && m.serviceStartMonth > curMonth ? "利用予定" : "利用中",
      monthState,
    });
    if (billable) { monthProjected += planAmount; billingCount++; }
    if (billed) monthConfirmed += cmSel!.get(m.c.id)!;
  }
  // 課金予定→確定→無料 の順、同状態内は金額降順で見やすく
  const stateRank: Record<RevenueUser["monthState"], number> = { "課金予定": 0, "確定": 1, "無料": 2 };
  users.sort((a, b) => stateRank[a.monthState] - stateRank[b.monthState] || b.planAmount - a.planAmount);

  return {
    month, year, users,
    monthProjected, monthConfirmed,
    usingCount: users.length,   // 当月の利用者数 (在籍・無料期間含む)
    billingCount,
    annual, annualProjected, annualConfirmed,
  };
}
