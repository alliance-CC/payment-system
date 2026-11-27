// SAF案件番号（案件ID）とフリガナを、あとから入れるときの決まり。
//   ・SAF案件番号は、いまの値がエンカンAIが読んだときのままのときだけ（人が直した値を消さない）
//   ・フリガナは空のときだけ
import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/shared/db/service", () => ({ createSupabaseService: () => ({}) }));
const { planSafFill, normalizeKanaPair, CASE_ID_RE } = await import("./saf-fill");

const ID = "006RB00001T3XUmYAN";

describe("SAF案件番号とフリガナを入れる", () => {
  it("案件番号が入っていた契約に案件IDを入れる（読んだときと同じなら）", () => {
    const r = planSafFill({ saf_case_no: "AA00253791", contact_kana: null },
                          { accountId: "MR1", oldSafCaseNo: "AA00253791", safCaseNo: ID });
    expect(r.patch).toEqual({ saf_case_no: ID });
    expect(r.saf).toBe("入れた");
  });

  it("空の契約にも入れる（空と null は同じに見る）", () => {
    const r = planSafFill({ saf_case_no: null, contact_kana: "" },
                          { accountId: "MR1", oldSafCaseNo: "", safCaseNo: ID });
    expect(r.patch.saf_case_no).toBe(ID);
  });

  it("読んだあとに人が直していたら変えない", () => {
    const r = planSafFill({ saf_case_no: "006RB00009ZZZZZYAA", contact_kana: null },
                          { accountId: "MR1", oldSafCaseNo: "", safCaseNo: ID });
    expect(r.patch).toEqual({});
    expect(r.saf).toContain("変わっていた");
  });

  it("案件IDの形でないものは入れない", () => {
    const r = planSafFill({ saf_case_no: "", contact_kana: null },
                          { accountId: "MR1", oldSafCaseNo: "", safCaseNo: "AA00253791" });
    expect(r.patch).toEqual({});
  });

  it("フリガナは空のときだけ・カタカナにそろえて入れる", () => {
    expect(planSafFill({ saf_case_no: ID, contact_kana: null }, { accountId: "MR1", kana: "さとう のぶひろ" }).patch)
      .toEqual({ contact_kana: "サトウ ノブヒロ" });
    expect(planSafFill({ saf_case_no: ID, contact_kana: "サトウ ノブヒロ" }, { accountId: "MR1", kana: "サトウ ノブ" }).patch)
      .toEqual({});
    expect(planSafFill({ saf_case_no: ID, contact_kana: null }, { accountId: "MR1", kana: "佐藤 暢廣" }).patch)
      .toEqual({});
  });

  it("「セイ メイ」は2つに分かれているときだけ", () => {
    expect(normalizeKanaPair("ヤマダ　タロウ")).toBe("ヤマダ タロウ");
    expect(normalizeKanaPair("ヤマダタロウ")).toBeNull();
    expect(normalizeKanaPair("")).toBeNull();
  });

  it("案件IDは 006 で始まる15桁か18桁", () => {
    expect(CASE_ID_RE.test(ID)).toBe(true);
    expect(CASE_ID_RE.test(ID.slice(0, 15))).toBe(true);
    expect(CASE_ID_RE.test("AA00253791")).toBe(false);
    expect(CASE_ID_RE.test(ID + "X")).toBe(false);
  });
});
