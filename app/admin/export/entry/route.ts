import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadEntryExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { csvCell, toExcelCsv, csvHeaders } from "@/features/payments/csv";

export const dynamic = "force-dynamic";

// ④-1 エントリーCSV。申込日を軸に、指定した期間 (from〜to) の申込を出力する。
//   ・1行目の見出しは先方フォーマットに合わせ A〜W の23項目を固定で出力する
//   ・2行目以降に値を入れるのは当システムが保持する7項目のみ (他は空欄)
//   ・カード等の決済個人情報は一切含めない (§7)
const HEADER = [
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

function validDate(s: string | null, fallback: string): string {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.redirect(new URL("/admin/login", req.url));

  const url = new URL(req.url);
  const today = todayJst();
  const from = validDate(url.searchParams.get("from"), today);
  const to = validDate(url.searchParams.get("to"), from);

  // 見出し行の要否 (先方システムへ取り込む際に見出しが1件として入るのを避けられるように)。
  // チェックボックスは hidden と併用するため、順序に依存しない形で判定する。
  const headerParams = url.searchParams.getAll("header");
  const withHeader = headerParams.length === 0 ? true : headerParams.includes("1");


  const rows = await loadEntryExport(from, to);

  const lines = withHeader ? [HEADER.map(csvCell).join(",")] : [];
  for (const r of rows) {
    const cols = new Array(HEADER.length).fill("");
    cols[0] = r.accountId;         // A 顧客ID
    cols[2] = r.licenseKey;        // C ライセンスキー_ウイルスバスター
    cols[7] = r.serviceStartDate;  // H サービス開始日
    cols[8] = r.chargeStartDate;   // I 課金開始日
    cols[13] = r.lastNameKanji;    // N 契約者名_姓_漢字
    cols[14] = r.firstNameKanji;   // O 契約者名_名_漢字
    cols[21] = r.mobilePhone;      // V 電話番号_携帯
    lines.push(cols.map(csvCell).join(","));
  }

  // Excel の「CSV (コンマ区切り)」として開けるよう Shift_JIS / CRLF で出力する
  return new NextResponse(toExcelCsv(lines), { headers: csvHeaders(`entry_${from}_${to}.csv`) });
}
