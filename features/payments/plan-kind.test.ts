// プラス / プレミアムの区分 (先方の入れ先が別なので、エントリーCSV・解約CSV をこれで分ける)。
import { describe, it, expect } from "vitest";
import { planKind, parsePlanKind, filterByPlanKind, rowsWithoutPlanKind } from "./plan-kind";

describe("プランの区分", () => {
  it("A/B はまもるんの有無なので、同じ区分に入る", () => {
    expect(planKind("plus", "暮らし安心プラスB")).toBe("plus");
    expect(planKind("plusA", "暮らし安心プラスA")).toBe("plus");
    expect(planKind("premium", "暮らし安心プレミアムB")).toBe("premium");
    expect(planKind("premiumA", "暮らし安心プレミアムA")).toBe("premium");
  });

  it("id を正とする (名称が古いまま残っていても、id で決める)", () => {
    expect(planKind("plus", "暮らし安心プレミアムB")).toBe("plus");
    expect(planKind("premium", "暮らし安心プラスB")).toBe("premium");
  });

  it("id で決まらないときだけ名称で見る", () => {
    expect(planKind("custom1", "暮らし安心プレミアム（特別）")).toBe("premium");
    expect(planKind("", "暮らし安心プラス")).toBe("plus");
    expect(planKind(null, null)).toBeNull();
    expect(planKind("other", "別の商品")).toBeNull();
  });
});

describe("URL の plan", () => {
  it("無い・空は「分けない」", () => {
    expect(parsePlanKind(null)).toBeNull();
    expect(parsePlanKind("")).toBeNull();
  });

  it("plus / premium だけを受け付け、ほかは invalid (黙って全件を返さない)", () => {
    expect(parsePlanKind("plus")).toBe("plus");
    expect(parsePlanKind("premium")).toBe("premium");
    expect(parsePlanKind("Plus")).toBe("invalid");
    expect(parsePlanKind("plusA")).toBe("invalid");
    expect(parsePlanKind("all")).toBe("invalid");
  });
});

describe("区分で絞る", () => {
  const rows = [
    { accountId: "MR-1", planKind: "plus" as const },
    { accountId: "MR-2", planKind: "premium" as const },
    { accountId: "MR-3", planKind: null },
    { accountId: "MR-4", planKind: "plus" as const },
  ];

  it("区分を指定すると、その区分だけ", () => {
    expect(filterByPlanKind(rows, "plus").map((r) => r.accountId)).toEqual(["MR-1", "MR-4"]);
    expect(filterByPlanKind(rows, "premium").map((r) => r.accountId)).toEqual(["MR-2"]);
  });

  it("指定しなければ全件 (古いエンカンAI・前に保存したリンク)", () => {
    expect(filterByPlanKind(rows, null)).toHaveLength(4);
  });

  it("区分の分からない行は、どちらにも入らない — 別に名指しする", () => {
    const both = [...filterByPlanKind(rows, "plus"), ...filterByPlanKind(rows, "premium")];
    expect(both.map((r) => r.accountId)).not.toContain("MR-3");
    expect(rowsWithoutPlanKind(rows).map((r) => r.accountId)).toEqual(["MR-3"]);
  });
});
