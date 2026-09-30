import { NextResponse } from "next/server";
import { denyUnlessEnkan, csvJson, DATE_RE } from "@/features/enkan/respond";
import { loadCancelExport, loadCancelTodoExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { csvCell } from "@/features/payments/csv";

export const dynamic = "force-dynamic";

// エンカンAI用：解約CSV (管理ボードの「解約」と同じ列・見出しなし)。
//   GET /api/enkan/cancel?from=YYYY-MM-DD&to=YYYY-MM-DD   (省略時は今日・JST)
//   GET /api/enkan/cancel?todo=1&since=YYYY-MM-DD        まだ「解約エントリー済み」でない解約 (since 以降)
export async function GET(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;

  const url = new URL(req.url);
  if (url.searchParams.get("todo") === "1") {
    const since = url.searchParams.get("since") || "";
    if (!DATE_RE.test(since)) return NextResponse.json({ error: "since-required" }, { status: 400 });
    try {
      const rows = await loadCancelTodoExport(since);
      const lines = rows.map((r) => [r.accountId, r.canceledDate].map(csvCell).join(","));
      return csvJson(lines, `cancel_todo_${since}.csv`, rows.map((r) => r.accountId));
    } catch (e: any) {
      // cancel_entered_at 列が無い (p006 未適用) などは、全件を未エントリーとして返さずに止める
      return NextResponse.json({ error: "query-failed", detail: String(e?.message ?? e).slice(0, 300) },
                               { status: 500 });
    }
  }

  const today = todayJst();
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "bad-date" }, { status: 400 });
  }

  try {
    const rows = await loadCancelExport(from, to);
    const lines = rows.map((r) => [r.accountId, r.canceledDate].map(csvCell).join(","));
    return csvJson(lines, `cancel_${from}_${to}.csv`, rows.map((r) => r.accountId));
  } catch (e: any) {
    return NextResponse.json({ error: "query-failed", detail: String(e?.message ?? e).slice(0, 300) },
                             { status: 500 });
  }
}
