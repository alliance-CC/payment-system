// プラスのエントリーCSV (nuworks の「まもるん」の入れ先＝プレミアムとは別の入れ先・別の形)。
//
// 先方の見本「連携データカラム_インポート_新規」の FMT シートの47列 (A〜AU) をそのまま並べる。
// 値を入れるのは、見本の3行目が ●（必須）の列だけ。▲（任意）と「不要」の列は空のまま出す
// (担当者 2026-11-24：赤丸だけデータが入るように)。
// 管理ボードのダウンロードとエンカンAIの口で同じ関数を使う (片方だけ直して列がずれるのを防ぐ)。
// プレミアムは今までどおり entry-csv.ts の23列。
import type { EntryExportRow } from "./export-query";
import { csvCell } from "./csv";

export const PLUS_ENTRY_HEADER = [
  "No",                    // A  自動採番
  "代理店",                // B  自動反映
  "入力日",                // C  ● インポート日
  "データ連携日",          // D  ● インポート日
  "計上開始日",            // E  ● 課金開始日
  "契約番号",              // F  ● 各卸先様_管理番号 (= 会員ID)
  "サービス開始日",        // G  ● 申込日
  "解約日",                // H  ▲
  "郵便番号",              // I  ▲
  "契約者住所",            // J  ▲
  "物件番号",              // K  ▲
  "契約者名_姓",           // L  ●
  "契約者名_名",           // M  ●
  "契約者名_セイ",         // N  ● (申込でカナを聞いていないので空。先方に確認中)
  "契約者名_メイ",         // O  ● (同上)
  "電話番号①",             // P  ● ハイフン有り
  "電話番号②",             // Q  ▲
  "メールアドレス",        // R  ▲
  "性別",                  // S  ▲
  "生年月日",              // T  ▲
  "居住形態区分",          // U  不要
  "管理会社名_家主名",     // V  不要
  "連絡先",                // W  不要
  "加入店電話番号",        // X  不要
  "加入店FAX番号",         // Y  不要
  "同居家族1 フリガナ",    // Z  不要
  "同居家族1 氏名",        // AA 不要
  "同居家族1 生年月日",    // AB 不要
  "同居家族1 続柄",        // AC 不要
  "商品名",                // AD ●
  "販売区分",              // AE 不要
  "更新日",                // AF 不要
  "入電日",                // AG 不要
  "受電担当者",            // AH 不要
  "問合せ内容",            // AI 不要
  "対応結果",              // AJ 不要
  "折り返し連絡先電話番号", // AK ▲
  "折り返し連絡希望日",    // AL ▲
  "備考",                  // AM 不要
  "代理店CD",              // AN 不要
  "作成日時",              // AO 不要
  "修正日時",              // AP 不要
  "性別_計算",             // AQ 不要
  "同居家族1 フリガナ 2",  // AR 不要
  "同居家族1 氏名 2",      // AS 不要
  "同居家族1 生年月日 2",  // AT 不要
  "同居家族1 続柄 2",      // AU 不要
];

/** 商品名 (担当者 2026-11-24：プラスは「まもるん」) */
export const PLUS_PRODUCT_NAME = "まもるん";

const COL = Object.fromEntries(PLUS_ENTRY_HEADER.map((h, i) => [h, i])) as Record<string, number>;

/** YYYY-MM-DD → 見本と同じ「2022/11/1」の形 (月・日の頭に0を付けない)。空や形の違う値はそのまま。 */
export function slashDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

/**
 * プラスのエントリーCSVの行。
 * importDate (YYYY-MM-DD) は先方に入れる日 = 入力日・データ連携日 (見本の備考「インポート日」)。
 */
export function plusEntryCsvLines(rows: EntryExportRow[], withHeader: boolean, importDate: string): string[] {
  const lines = withHeader ? [PLUS_ENTRY_HEADER.map(csvCell).join(",")] : [];
  const imported = slashDate(importDate);
  for (const r of rows) {
    const cols = new Array(PLUS_ENTRY_HEADER.length).fill("");
    cols[COL["入力日"]] = imported;
    cols[COL["データ連携日"]] = imported;
    cols[COL["計上開始日"]] = slashDate(r.chargeStartDate);
    cols[COL["契約番号"]] = r.accountId;
    cols[COL["サービス開始日"]] = slashDate(r.appliedDate);   // 見本の備考どおり「申込日」
    cols[COL["契約者名_姓"]] = r.lastNameKanji;
    cols[COL["契約者名_名"]] = r.firstNameKanji;
    // 契約者名_セイ・メイ：申込でカナを聞いていないので空 (担当者 2026-11-24：いまは空でよい・先方に確認中)
    cols[COL["電話番号①"]] = r.mobilePhone;
    cols[COL["商品名"]] = PLUS_PRODUCT_NAME;
    lines.push(cols.map(csvCell).join(","));
  }
  return lines;
}
