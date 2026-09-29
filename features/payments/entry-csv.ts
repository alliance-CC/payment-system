// エントリーCSVの1行の組み立て。管理ボードのダウンロードとエンカンAIの口で共有する
// (片方だけ直して、先方へ渡す列がずれるのを防ぐ)。
import type { EntryExportRow } from "./export-query";
import { csvCell } from "./csv";

// 1行目の見出しは先方フォーマットに合わせ A〜W の23項目を固定で出力する。
// 2行目以降に値を入れるのは当システムが保持する7項目のみ (他は空欄)。
export const ENTRY_HEADER = [
  "顧客ID",                        // A ← 出力
  "卸先会社コード",                // B
  "ライセンスキー_ウイルスバスター", // C ← 出力
  "ライセンスキー_クマモリ",        // D
  "ライセンスキー_予備1",           // E
  "ライセンスキー_予備2",           // F
  "ライセンスキー_予備3",           // G
  "サービス開始日",                // H ← 出力
  "課金開始日",                    // I ← 出力
  "保険適用開始日",                // J
  "解約日",                        // K
  "契約者名_姓_カナ",              // L
  "契約者名_名_カナ",              // M
  "契約者名_姓_漢字",              // N ← 出力
  "契約者名_名_漢字",              // O ← 出力
  "生年月日",                      // P
  "郵便番号",                      // Q
  "契約者住所_番地まで",           // R
  "契約者住所_物件名",             // S
  "契約者住所_部屋番号",           // T
  "電話番号_固定",                 // U
  "電話番号_携帯",                 // V ← 出力
  "メールアドレス",                // W
];

export function entryCsvLines(rows: EntryExportRow[], withHeader: boolean): string[] {
  const lines = withHeader ? [ENTRY_HEADER.map(csvCell).join(",")] : [];
  for (const r of rows) {
    const cols = new Array(ENTRY_HEADER.length).fill("");
    cols[0] = r.accountId;         // A 顧客ID
    cols[2] = r.licenseKey;        // C ライセンスキー_ウイルスバスター
    cols[7] = r.serviceStartDate;  // H サービス開始日
    cols[8] = r.chargeStartDate;   // I 課金開始日
    cols[13] = r.lastNameKanji;    // N 契約者名_姓_漢字
    cols[14] = r.firstNameKanji;   // O 契約者名_名_漢字
    cols[21] = r.mobilePhone;      // V 電話番号_携帯
    lines.push(cols.map(csvCell).join(","));
  }
  return lines;
}
