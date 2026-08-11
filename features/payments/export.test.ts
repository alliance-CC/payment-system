// ①②④ で追加したデータ整形の単体テスト (外部I/Oを伴わない純粋部分)。
import { describe, it, expect } from "vitest";
import { splitName, planIncludesVirusBuster } from "./billing";

describe("① 氏名の姓/名分割 (スプレッドシート・CSVの項目分け)", () => {
  it("`姓 名` を分割する", () => {
    expect(splitName("山田 太郎")).toEqual({ last: "山田", first: "太郎" });
  });

  it("全角スペース区切りも分割する", () => {
    expect(splitName("山田　太郎")).toEqual({ last: "山田", first: "太郎" });
  });

  it("名に空白が含まれる場合は最初の空白でのみ分割する", () => {
    expect(splitName("Smith John Paul")).toEqual({ last: "Smith", first: "John Paul" });
  });

  it("1語のみなら姓に寄せる", () => {
    expect(splitName("山田")).toEqual({ last: "山田", first: "" });
  });

  it("未設定は空で返す (CSVは空欄になる)", () => {
    expect(splitName(null)).toEqual({ last: "", first: "" });
    expect(splitName("")).toEqual({ last: "", first: "" });
  });

  it("カタカナ・英字の氏名もそのまま扱う (要件: 漢字項目にそのまま入れてよい)", () => {
    expect(splitName("ヤマダ タロウ")).toEqual({ last: "ヤマダ", first: "タロウ" });
  });
});

describe("② ライセンスキー付与の対象プラン判定", () => {
  it("プレミアムは付与対象", () => {
    expect(planIncludesVirusBuster("premium", "暮らし安心プレミアム")).toBe(true);
  });

  it("プラスは付与しない (ウイルスバスターを含まないため)", () => {
    expect(planIncludesVirusBuster("plus", "暮らし安心プラス")).toBe(false);
  });

  it("プラン名が変わってもIDで判定できる", () => {
    expect(planIncludesVirusBuster("premium", "新プラン名")).toBe(true);
  });

  it("IDが変わっても名称に「プレミアム」があれば付与対象", () => {
    expect(planIncludesVirusBuster("premium_v2", "暮らし安心プレミアム")).toBe(true);
  });
});
