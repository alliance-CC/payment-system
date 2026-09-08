import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadDataLoaderExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { csvCell, toExcelCsv, csvHeaders } from "@/features/payments/csv";

export const dynamic = "force-dynamic";

// ⑤ データローダ用CSV。申込日を軸に、指定した期間 (from〜to) の案件を出力する。
//   ・SAF案件番号が入力済みの案件のみ (番号が無いと取込キーが無く使えないため)
//   ・解約済みも含める (解約日を渡すための出力)
//   ・カード等の決済個人情報は一切含めない (§7)
const HEADER = ["SAF案件番号", "付帯名", "課金開始日", "解約日"];

function validDate(s: string | null, fallback: string): string {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.redirect(new URL("/admin/login", req.url));

  const url = new URL(req.url);
  const today = todayJst();
  const from = validDate(url.searchParams.get("from"), today);
  const to = validDate(url.searchParams.get("to"), from);

  // 見出し行の要否。既定は「付けない」— 取込時に見出しが1件のデータとして混入するのを防ぐ。
  // チェックボックスは hidden と併用するため、順序に依存しない形で判定する。
  const withHeader = url.searchParams.getAll("header").includes("1");

  const rows = await loadDataLoaderExport(from, to);

  const lines = withHeader ? [HEADER.map(csvCell).join(",")] : [];
  for (const r of rows) {
    lines.push([r.safCaseNo, r.serviceName, r.chargeStartDate, r.canceledDate].map(csvCell).join(","));
  }

  // Excel の「CSV (コンマ区切り)」として開けるよう Shift_JIS / CRLF で出力する
  return new NextResponse(toExcelCsv(lines), { headers: csvHeaders(`dataloader_${from}_${to}.csv`) });
}
