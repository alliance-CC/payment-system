import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadEntryExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { parsePlanKind, filterByPlanKind } from "@/features/payments/plan-kind";
import { toExcelCsv, csvHeaders } from "@/features/payments/csv";
import { entryCsvLines } from "@/features/payments/entry-csv";
import { plusEntryCsvLines } from "@/features/payments/plus-entry-csv";

export const dynamic = "force-dynamic";

// ④-1 エントリーCSV。申込日を軸に、指定した期間 (from〜to) の申込を出力する。
//   ・列の組み立ては features/payments/entry-csv.ts (エンカンAIの口と共有)
//   ・カード等の決済個人情報は一切含めない (§7)
//   ・plan=plus|premium で、その区分だけを出す (先方の入れ先がプラスとプレミアムで別のため)。
//     plan が無ければ全件 (前に保存したリンクのため)。
//   ・⚠️ プラスは入れ先が別なので形も別 (plus-entry-csv.ts・先方の見本の47列)。入力日・データ連携日はダウンロードした日。

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


  const kind = parsePlanKind(url.searchParams.get("plan"));
  if (kind === "invalid") return NextResponse.json({ error: "bad-plan" }, { status: 400 });

  const rows = filterByPlanKind(await loadEntryExport(from, to), kind);

  const lines = kind === "plus" ? plusEntryCsvLines(rows, withHeader, today) : entryCsvLines(rows, withHeader);

  // Excel の「CSV (コンマ区切り)」として開けるよう Shift_JIS / CRLF で出力する
  const tag = kind ? `_${kind}` : "";
  return new NextResponse(toExcelCsv(lines), { headers: csvHeaders(`entry${tag}_${from}_${to}.csv`) });
}
