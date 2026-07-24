import { describe, it, expect, vi } from "vitest";

// --- モック: DB / store / ポリシー -------------------------------------------
// 契約・課金データはテスト内で差し替える
const state: { contracts: any[]; charges: any[]; ss: Map<string, string> } = {
  contracts: [], charges: [], ss: new Map(),
};

// Supabase クエリビルダの薄いモック (select/gte/lte/in/eq/order は自身を返す thenable)
function query(data: any) {
  const p: any = Promise.resolve({ data, error: null });
  for (const m of ["select", "gte", "lte", "in", "eq", "order"]) p[m] = () => p;
  return p;
}
vi.mock("@/shared/db/service", () => ({
  createSupabaseService: () => ({
    from: (t: string) => query(t === "payment_contracts" ? state.contracts : state.charges),
  }),
}));
vi.mock("./store", () => ({
  getServiceStartMap: async () => state.ss,
  getContractNameKanaMap: async () => new Map(),
}));
vi.mock("./billing-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing-config")>();
  return { ...actual, loadBillingPolicy: async () => ({ freeMonths: 2 } as any), todayJst: () => "2026-08-15" };
});

import { loadRevenue } from "./revenue-query";

// serviceStart から課金開始月 = +2ヶ月 (freeMonths=2)。
//   A: 利用開始 06 → 課金開始 08。08は課金対象、07は無料。
//   C: 利用開始 03 → 課金開始 05。08に「解約」。→ 解約月(08)は在籍・課金対象、09は対象外。
//   D: 利用開始 07 → 課金開始 09。08は無料期間中(在籍・¥0)。
//   B: 利用開始 09 → 08時点では未在籍(リストに出ない)。
function seed() {
  state.contracts = [
    { id: "A", account_id: "MR-A", plan_name: "プラス", plan_id: "plus", amount: 1320, status: "active", started_at: "2026-05-10T00:00:00Z", canceled_at: null, contact_name: "エー" },
    { id: "B", account_id: "MR-B", plan_name: "プレミアム", plan_id: "premium", amount: 1870, status: "active", started_at: "2026-08-01T00:00:00Z", canceled_at: null, contact_name: "ビー" },
    { id: "C", account_id: "MR-C", plan_name: "プラス", plan_id: "plus", amount: 1320, status: "canceled", started_at: "2026-02-10T00:00:00Z", canceled_at: "2026-08-20T00:00:00Z", contact_name: "シー" },
    { id: "D", account_id: "MR-D", plan_name: "プラス", plan_id: "plus", amount: 1320, status: "active", started_at: "2026-06-10T00:00:00Z", canceled_at: null, contact_name: "ディー" },
  ];
  state.ss = new Map([["A", "2026-06-01"], ["B", "2026-09-01"], ["C", "2026-03-01"], ["D", "2026-07-01"]]);
  // A は 08 に課金成功 (確定)
  state.charges = [{ contract_id: "A", charge_month: "2026-08", amount: 1320, ok: true }];
}

describe("loadRevenue 売上予測ロジック", () => {
  it("無料期間中の在籍者は一覧に出るが売上予定には含めない / 課金対象のみ予定計上", async () => {
    seed();
    const b = await loadRevenue({ month: "2026-08" });
    const byId = Object.fromEntries(b.users.map((u) => [u.accountId, u]));

    // 08時点の一覧: A(確定)・C(課金予定)・D(無料)。B は未在籍で出ない。
    expect(new Set(b.users.map((u) => u.accountId))).toEqual(new Set(["MR-A", "MR-C", "MR-D"]));
    expect(byId["MR-A"].monthState).toBe("確定");
    expect(byId["MR-C"].monthState).toBe("課金予定");   // ← 解約月でも当月は課金対象
    expect(byId["MR-D"].monthState).toBe("無料");        // ← 無料期間中は在籍表示・¥0

    // 予定=課金対象(A,C)の月額合計。無料のDは含めない。
    expect(b.monthProjected).toBe(1320 + 1320);
    expect(b.monthConfirmed).toBe(1320);                 // Aの実課金
    expect(b.usingCount).toBe(3);                        // 在籍(無料含む)
    expect(b.billingCount).toBe(2);                      // 課金対象(A,C)
  });

  it("解約月の翌月からは対象外 (解約月は在籍・課金対象)", async () => {
    seed();
    const sep = await loadRevenue({ month: "2026-09" });
    // 09: C は解約済み(08解約)→対象外。A(課金中)・D(09から課金開始)が対象。B は無料期間中(在籍)。
    expect(sep.users.find((u) => u.accountId === "MR-C")).toBeUndefined();
    // 予定 = A(1320) + D(1320)。B は無料(¥0)、C は対象外。
    expect(sep.monthProjected).toBe(1320 + 1320);
    // 年間: Cは05〜08が課金対象(4ヶ月)、09以降は0。annual[7](8月)にCを含み、annual[8](9月)には含めない。
    const aug = sep.annual.find((a) => a.month === "2026-08")!;
    const sepM = sep.annual.find((a) => a.month === "2026-09")!;
    expect(aug.projected).toBe(1320 /*A*/ + 1320 /*C 解約月も対象*/); // D は8月無料
    expect(sepM.projected).toBe(1320 /*A*/ + 1320 /*D*/);            // C 対象外
  });
});
