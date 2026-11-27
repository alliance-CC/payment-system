// まもるん有無によるプラン体系 (A/B) のテスト。
//   A … まもるん無し (plusA 990 / premiumA 1430)
//   B … まもるん有り (plus 1320 / premium 1870 ＝ 従来プラン。既存契約はすべて B)
// 顧客には A/B を見せず、社内表記(name)にのみ現れることを固定する。
import { describe, it, expect } from "vitest";
import { getPlans, getPlan, customerPlanName, noMamoruLinks } from "./plans";

describe("プラン体系 (まもるん有無の A/B)", () => {
  it("4プランが定義され、表示順は B(まもるん有り) → A(無し)", () => {
    expect(getPlans().map((p) => p.id)).toEqual(["plus", "premium", "plusA", "premiumA"]);
  });

  it("金額: B は従来どおり / A はまもるん抜きの安価", () => {
    expect(getPlan("plus")?.amount).toBe(1320);
    expect(getPlan("premium")?.amount).toBe(1870);
    expect(getPlan("plusA")?.amount).toBe(990);
    expect(getPlan("premiumA")?.amount).toBe(1430);
  });

  it("社内表記(name)には A/B が付く (管理画面・CSV・連携シート用)", () => {
    expect(getPlan("plus")?.name).toBe("暮らし安心プラスB");
    expect(getPlan("premium")?.name).toBe("暮らし安心プレミアムB");
    expect(getPlan("plusA")?.name).toBe("暮らし安心プラスA");
    expect(getPlan("premiumA")?.name).toBe("暮らし安心プレミアムA");
  });

  it("顧客向け表記には A/B を出さない", () => {
    for (const id of ["plus", "plusA"]) {
      expect(customerPlanName(getPlan(id)!)).toBe("暮らし安心プラス");
    }
    for (const id of ["premium", "premiumA"]) {
      expect(customerPlanName(getPlan(id)!)).toBe("暮らし安心プレミアム");
    }
  });

  it("B からは対応する A への導線がある / A からは無い (行き止まり)", () => {
    expect(getPlan("plus")?.withoutMamoruPlanId).toBe("plusA");
    expect(getPlan("premium")?.withoutMamoruPlanId).toBe("premiumA");
    expect(getPlan("plusA")?.withoutMamoruPlanId).toBeUndefined();
    expect(getPlan("premiumA")?.withoutMamoruPlanId).toBeUndefined();
  });

  it("A/B は同じ利用規約ページを参照する", () => {
    expect(getPlan("plus")?.termsSlug).toBe("plus");
    expect(getPlan("plusA")?.termsSlug).toBe("plus");
    expect(getPlan("premium")?.termsSlug).toBe("premium");
    expect(getPlan("premiumA")?.termsSlug).toBe("premium");
  });

  it("既存のプランIDは変えない (LPリンク ?plan=plus と既存契約を維持)", () => {
    expect(getPlan("plus")).toBeDefined();
    expect(getPlan("premium")).toBeDefined();
  });

  it("variant で A/B を判別できる", () => {
    expect(getPlan("plus")?.variant).toBe("B");
    expect(getPlan("plusA")?.variant).toBe("A");
  });
});

describe("「まもるんをご不要な方はこちら」の導線 (noMamoruLinks)", () => {
  const all = getPlans();
  const plus = getPlan("plus");

  it("出さない設定なら、プラン選択画面にも確定画面にも出さない (担当者 2026-11-27：いまは隠す)", () => {
    expect(noMamoruLinks(all, { show: false, wantA: false, keepQs: "" }))
      .toEqual({ altHref: null, altOf: {} });
    expect(noMamoruLinks(all, { show: false, selected: plus, wantA: false, keepQs: "" }))
      .toEqual({ altHref: null, altOf: {} });
  });

  it("出す設定なら、今までどおり (選択画面＝?v=a へ・確定画面＝その場で A へ)", () => {
    const pick = noMamoruLinks(all, { show: true, wantA: false, keepQs: "&case=006XX" });
    expect(pick.altHref).toBe("/subscribe?v=a&case=006XX");
    expect(pick.altOf).toEqual({ plus: "plusA", premium: "premiumA" });

    const locked = noMamoruLinks(all, { show: true, selected: plus, wantA: false, keepQs: "" });
    expect(locked.altHref).toBeNull();
    expect(locked.altOf.plus).toBe("plusA");
  });

  it("まもるん無しを見ているときは選択画面の導線を出さない", () => {
    expect(noMamoruLinks(all, { show: true, wantA: true, keepQs: "" }).altHref).toBeNull();
  });
});
