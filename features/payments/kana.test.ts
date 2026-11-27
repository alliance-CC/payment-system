// フリガナ (セイ・メイ) のそろえ方。申込画面・申込API・管理画面が同じ決まりを使う。
import { describe, it, expect } from "vitest";
import { toKatakana, isKatakana, normalizeKanaPart, joinKana, splitKana } from "./kana";

describe("フリガナ", () => {
  it("ひらがな・半角カナは全角カタカナにそろえる", () => {
    expect(toKatakana("やまだ")).toBe("ヤマダ");
    expect(toKatakana("ﾔﾏﾀﾞ")).toBe("ヤマダ");
    expect(toKatakana("ｻﾄｳ ｰ")).toBe("サトウー");
    expect(toKatakana("ゔぃ")).toBe("ヴィ");
  });

  it("空白は取り除く (セイ・メイは別々の欄)", () => {
    expect(toKatakana(" ヤマ　ダ ")).toBe("ヤマダ");
  });

  it("カタカナ (長音・中黒を含む) だけを通す", () => {
    expect(isKatakana("ヤマダ")).toBe(true);
    expect(isKatakana("ジョン・スミス")).toBe(true);
    expect(isKatakana("コーヒー")).toBe(true);
    expect(isKatakana("山田")).toBe(false);
    expect(isKatakana("Yamada")).toBe(false);
    expect(isKatakana("")).toBe(false);
  });

  it("保存できる形にできなければ null", () => {
    expect(normalizeKanaPart("たろう")).toBe("タロウ");
    expect(normalizeKanaPart("太郎")).toBeNull();
    expect(normalizeKanaPart("")).toBeNull();
    expect(normalizeKanaPart(undefined)).toBeNull();
    expect(normalizeKanaPart("ア".repeat(51))).toBeNull();
  });

  it("「セイ メイ」で保存し、セイ・メイに戻せる", () => {
    const saved = joinKana("ヤマダ", "タロウ");
    expect(saved).toBe("ヤマダ タロウ");
    expect(splitKana(saved)).toEqual({ last: "ヤマダ", first: "タロウ" });
    expect(splitKana(null)).toEqual({ last: "", first: "" });
    expect(splitKana("ヤマダ")).toEqual({ last: "ヤマダ", first: "" });
  });
});
