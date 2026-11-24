// プラスのエントリーCSV (先方の見本「連携データカラム_インポート_新規」の FMT・47列)。
// 値を入れるのは見本の3行目が ● の列だけ。ほかは空で出す。
import { describe, it, expect } from "vitest";
import { plusEntryCsvLines, PLUS_ENTRY_HEADER, PLUS_PRODUCT_NAME, slashDate } from "./plus-entry-csv";

const row = {
  accountId: "MR1", licenseKey: "", serviceStartDate: "2026-12-01",
  chargeStartDate: "2026-12-01", appliedDate: "2026-11-05", lastNameKanji: "山田", firstNameKanji: "太郎",
  mobilePhone: "090-1234-5678", planKind: "plus" as const,
};
const at = (h: string) => PLUS_ENTRY_HEADER.indexOf(h);

describe("プラスのエントリーCSV", () => {
  it("見本の FMT と同じ47列 (A〜AU)", () => {
    expect(PLUS_ENTRY_HEADER).toHaveLength(47);
    expect(PLUS_ENTRY_HEADER[0]).toBe("No");
    expect(PLUS_ENTRY_HEADER[5]).toBe("契約番号");        // F
    expect(PLUS_ENTRY_HEADER[29]).toBe("商品名");         // AD
    expect(PLUS_ENTRY_HEADER[46]).toBe("同居家族1 続柄 2"); // AU
  });

  it("● の列に値が入り、ほかは空", () => {
    const [line] = plusEntryCsvLines([row], false, "2026-11-24");
    const cols = line.split(",");
    expect(cols).toHaveLength(47);
    expect(cols[at("入力日")]).toBe("2026/11/24");
    expect(cols[at("データ連携日")]).toBe("2026/11/24");
    expect(cols[at("計上開始日")]).toBe("2026/12/1");
    expect(cols[at("契約番号")]).toBe("MR1");
    expect(cols[at("サービス開始日")]).toBe("2026/11/5");   // 申込日 (利用開始日ではない)
    expect(cols[at("契約者名_姓")]).toBe("山田");
    expect(cols[at("契約者名_名")]).toBe("太郎");
    expect(cols[at("契約者名_セイ")]).toBe("");            // 申込でカナを聞いていない
    expect(cols[at("契約者名_メイ")]).toBe("");
    expect(cols[at("電話番号①")]).toBe("090-1234-5678");
    expect(cols[at("商品名")]).toBe(PLUS_PRODUCT_NAME);
    const filled = new Set(["入力日", "データ連携日", "計上開始日", "契約番号", "サービス開始日",
                            "契約者名_姓", "契約者名_名", "電話番号①", "商品名"].map(at));
    cols.forEach((v, i) => { if (!filled.has(i)) expect(v).toBe(""); });
  });

  it("見出しは選んだときだけ (先方の FMT の1行目と同じ)", () => {
    expect(plusEntryCsvLines([row], false, "2026-11-24")).toHaveLength(1);
    const lines = plusEntryCsvLines([row], true, "2026-11-24");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("No,代理店,入力日,")).toBe(true);
  });

  it("日付は見本と同じ形 (頭に0を付けない)", () => {
    expect(slashDate("2022-11-01")).toBe("2022/11/1");
    expect(slashDate("2022-10-16")).toBe("2022/10/16");
    expect(slashDate("")).toBe("");
  });
});
