import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadCancelExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { csvCell, toExcelCsv, csvHeaders } from "@/features/payments/csv";

export const dynamic = "force-dynamic";

// ④-2 解約CSV。解約日を軸に、指定した期間 (from〜to) の解約を出力する。
//   項目は 顧客ID(会員ID) と 解約日 のみ (画像4)。
const HEADER = ["顧客ID", "解約日"];

function validDate(s: string | null, fallback: string): string {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.redirect(new URL("/admin/login", req.url));

  const url = new URL(req.url);
  const today = todayJst();
  const from = validDate(url.searchParams.get("from"), today);
  const to = validDate(url.searchParams.get("to"), from);

  // 見出し行の要否。既定は「付けない」— 先方システムへそのまま取り込むのが通常の使い方で、
  // 見出しが1件のデータとして混入するのを防ぐため。必要なときだけ header=1 を付ける。
  // チェックボックスは hidden と併用するため、順序に依存しない形で判定する。
  const withHeader = url.searchParams.getAll("header").includes("1");

  const rows = await loadCancelExport(from, to);

  const lines = withHeader ? [HEADER.map(csvCell).join(",")] : [];
  for (const r of rows) lines.push([r.accountId, r.canceledDate].map(csvCell).join(","));

  // Excel の「CSV (コンマ区切り)」として開けるよう Shift_JIS / CRLF で出力する
  return new NextResponse(toExcelCsv(lines), { headers: csvHeaders(`cancel_${from}_${to}.csv`) });
}
