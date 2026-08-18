// CSV 出力の共通処理。先方へ渡すファイルのため Excel での見え方を優先する。
//
// ・文字コード: Shift_JIS(CP932)。Excel の「CSV (コンマ区切り)」がこれで、
//   BOM 付き UTF-8 だと「CSV UTF-8 (コンマ区切り)」として扱われてしまうため。
// ・改行: CRLF (Excel/Windows 標準)
// ・電話番号は phone.ts でハイフン付きに揃えているため、Excel が数値と解釈せず
//   先頭の 0 も落ちない (="..." のような小細工は不要)。
import "server-only";
import iconv from "iconv-lite";

/** 1セルをCSVの値へ整形 (引用符・改行・カンマのエスケープ) */
export function csvCell(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * 行配列を Excel 向けの CSV ファイル (Shift_JIS / CRLF) に変換する。
 * Shift_JIS で表現できない文字 (一部の環境依存文字) は "?" に置き換わるため、
 * 氏名に稀な漢字が含まれる場合は元データ側で確認すること。
 */
export function toExcelCsv(lines: string[]): Blob {
  // Response のボディへそのまま渡せるよう Blob で返す (Buffer は BodyInit ではない)
  const buf = iconv.encode(lines.join("\r\n"), "Shift_JIS");
  const bytes = new Uint8Array(buf.length);   // 通常の ArrayBuffer backed にコピー
  bytes.set(buf);
  return new Blob([bytes]);
}

/** CSV レスポンスの共通ヘッダー */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    // charset は実際の出力に合わせる (Excel が素の CSV として開けるようにする)
    "Content-Type": "text/csv; charset=Shift_JIS",
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}
