// CSV 出力の整形テスト。先方へ渡すファイルのため Excel での見え方を固定する。
import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { csvCell, toExcelCsv } from "./csv";

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
