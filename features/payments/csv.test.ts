// CSV 出力の整形テスト。先方へ渡すファイルのため Excel での見え方を固定する。
import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { csvCell, csvKeepLeadingZero, toExcelCsv } from "./csv";

async function decode(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  return iconv.decode(buf, "Shift_JIS");
}

describe("CSVのセル整形", () => {
  it("カンマ・引用符・改行を含む値は引用符で囲みエスケープする", () => {
    expect(csvCell("山田,太郎")).toBe('"山田,太郎"');
    expect(csvCell('あ"い')).toBe('"あ""い"');
    expect(csvCell("一行目\n二行目")).toBe('"一行目\n二行目"');
  });

  it("通常の値はそのまま", () => {
    expect(csvCell("暮らし安心プラス")).toBe("暮らし安心プラス");
    expect(csvCell(null)).toBe("");
  });
});

describe("先頭0の保持 (Excelが電話番号の0を落とす対策)", () => {
  it("0始まりの数字列は文字列として保持する", () => {
    expect(csvKeepLeadingZero("09012345678")).toBe('="09012345678"');
    expect(csvKeepLeadingZero("0312345678")).toBe('="0312345678"');
  });

  it("0始まりでない値は変換しない", () => {
    expect(csvKeepLeadingZero("9012345678")).toBe("9012345678");
    expect(csvKeepLeadingZero("MRfb4f53ccccb")).toBe("MRfb4f53ccccb");
    expect(csvKeepLeadingZero("TXEF-0084-0658")).toBe("TXEF-0084-0658");
  });

  it("数字以外を含む場合は変換しない (ハイフン付き電話番号など)", () => {
    expect(csvKeepLeadingZero("090-1234-5678")).toBe("090-1234-5678");
  });

  it("空値は空のまま", () => {
    expect(csvKeepLeadingZero("")).toBe("");
    expect(csvKeepLeadingZero(null)).toBe("");
  });
});

describe("Excel向けCSVファイル", () => {
  it("Shift_JIS で出力する (BOM付きUTF-8にしない)", async () => {
    const blob = toExcelCsv(["顧客ID,契約者名", "MR001,山田太郎"]);
    const buf = Buffer.from(await blob.arrayBuffer());
    // BOM (EF BB BF) が付いていないこと
    expect(buf[0]).not.toBe(0xef);
    // Shift_JIS としてデコードすると元の文字列に戻ること
    expect(iconv.decode(buf, "Shift_JIS")).toContain("山田太郎");
  });

  it("改行は CRLF", async () => {
    const text = await decode(toExcelCsv(["a", "b"]));
    expect(text).toBe("a\r\nb");
  });
});
