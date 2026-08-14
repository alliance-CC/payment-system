// CSV 出力の共通処理。先方へ渡すファイルのため Excel での見え方を優先する。
//
// ・文字コード: Shift_JIS(CP932)。Excel の「CSV (コンマ区切り)」がこれで、
//   BOM 付き UTF-8 だと「CSV UTF-8 (コンマ区切り)」として扱われてしまうため。
// ・改行: CRLF (Excel/Windows 標準)
// ・先頭0の保持: 電話番号などは Excel が数値と解釈して先頭の 0 を落とすため、
//   ="09012345678" 形式にして文字列として開かせる。
import "server-only";
import iconv from "iconv-lite";

/** 1セルをCSVの値へ整形 (引用符・改行・カンマのエスケープ) */
export function csvCell(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Excel が先頭の 0 を落とす値 (全桁が数字で 0 始まり) を文字列として保持させる。
 * 例: 09012345678 → ="09012345678"
 * 該当しない値はそのまま返す (顧客ID・ライセンスキー等は変換不要)。
 */
export function csvKeepLeadingZero(s: unknown): string {
  const v = String(s ?? "");
  if (!/^0\d+$/.test(v)) return csvCell(v);
  return `="${v}"`;
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
