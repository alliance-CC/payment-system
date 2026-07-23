import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { getServiceStartMap } from "./store";
import { loadBillingPolicy, firstChargeDate, todayJst } from "./billing-config";

// 売上予測ボードの集計。カード等の決済個人情報は含めない (§7)。
//   予定(projected) … その月に課金対象となる契約の金額合計 (継続課金の見込み)
//   確定(confirmed) … その月に実際に課金成功した金額合計 (payment_charges ok=true)
//   解約された契約は「解約月から」対象外 (§ユーザー指定)。
export type MethodTotals = { card: number; bank: number; total: number };

export type RevenueUser = {
  accountId: string;
  name: string | null;
  planName: string;
  amount: number;
  methodLabel: "クレジットカード" | "口座振替";
  usageLabel: "利用中" | "利用予定";
  billed: boolean;        // 当月の課金確定済みか
};

export type RevenueBoard = {
  month: string;
  year: number;
  method: "all" | "card" | "bank";
  users: RevenueUser[];
  monthProjected: MethodTotals;
  monthConfirmed: MethodTotals;
  annual: { month: string; projected: number; confirmed: number }[];
  annualProjected: number;
  annualConfirmed: number;
};

function jstMonth(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 7);
}

export async function loadRevenue(opts: { month: string; method?: "all" | "card" | "bank" }): Promise<RevenueBoard> {
  const svc = createSupabaseService();
  const policy = await loadBillingPolicy();
  const method = opts.method ?? "all";
  const month = opts.month;
  const year = parseInt(month.slice(0, 4), 10);
  const curMonth = todayJst().slice(0, 7);

  const { data: contracts } = await svc
    .from("payment_contracts")
    .select("id, account_id, plan_name, plan_id, amount, payment_method, status, started_at, canceled_at, contact_name");
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

  // 契約ごとに「課金開始月」「解約月」を求める
  const meta = rowsRaw.map((c: any) => {
    const startedMonth = jstMonth(c.started_at);
    const chosen = ssMap.get(c.id) || null;
    const svcStart = chosen ?? (startedMonth ? firstChargeDate(`${startedMonth}-01`, 1) : null);
    const chargeStartMonth = svcStart
      ? (policy.freeMonths > 0 ? firstChargeDate(svcStart, policy.freeMonths) : svcStart).slice(0, 7)
      : null;
    const cancelMonth = c.status === "canceled" ? jstMonth(c.canceled_at) : null;
    return { c, chargeStartMonth, cancelMonth };
  });

  const inMethod = (pm: string) => method === "all" || pm === method;
  // その月に課金対象か: 課金開始月 ≤ M かつ (未解約 or 解約月 > M)
  const billableIn = (m: (typeof meta)[number], M: string) =>
    !!m.chargeStartMonth && m.chargeStartMonth <= M && (!m.cancelMonth || m.cancelMonth > M);

  // 年間 (月別の予定/確定)
  const annual: { month: string; projected: number; confirmed: number }[] = [];
  let annualProjected = 0, annualConfirmed = 0;
  for (let mm = 1; mm <= 12; mm++) {
    const M = `${year}-${String(mm).padStart(2, "0")}`;
    let proj = 0, conf = 0;
    const cm = confirmedByMonth.get(M);
    for (const m of meta) {
      if (!inMethod(m.c.payment_method)) continue;
      if (billableIn(m, M)) proj += m.c.amount ?? 0;
      if (cm && cm.has(m.c.id)) conf += cm.get(m.c.id)!;
    }
    annual.push({ month: M, projected: proj, confirmed: conf });
    annualProjected += proj; annualConfirmed += conf;
  }

  // 当月の利用者リスト + 合計
  const users: RevenueUser[] = [];
  const monthProjected: MethodTotals = { card: 0, bank: 0, total: 0 };
  const monthConfirmed: MethodTotals = { card: 0, bank: 0, total: 0 };
  const cmSel = confirmedByMonth.get(month);
  for (const m of meta) {
    if (!inMethod(m.c.payment_method)) continue;
    const isBillable = billableIn(m, month);
    const billed = !!(cmSel && cmSel.has(m.c.id));
    if (!isBillable && !billed) continue;
    const amount = m.c.amount ?? 0;
    const pm: "card" | "bank" = m.c.payment_method === "bank" ? "bank" : "card";
    users.push({
      accountId: m.c.account_id,
      name: m.c.contact_name ?? null,
      planName: m.c.plan_name ?? m.c.plan_id ?? "",
      amount,
      methodLabel: pm === "bank" ? "口座振替" : "クレジットカード",
      usageLabel: month > curMonth ? "利用予定" : "利用中",
      billed,
    });
    if (isBillable) { monthProjected[pm] += amount; monthProjected.total += amount; }
    if (billed) { const c = cmSel!.get(m.c.id)!; monthConfirmed[pm] += c; monthConfirmed.total += c; }
  }
  users.sort((a, b) => b.amount - a.amount);

  return { month, year, method, users, monthProjected, monthConfirmed, annual, annualProjected, annualConfirmed };
}
