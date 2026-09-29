import { NextResponse } from "next/server";
import { denyUnlessEnkan, csvJson, DATE_RE } from "@/features/enkan/respond";
import { loadEntryTodoExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { entryCsvLines } from "@/features/payments/entry-csv";

export const dynamic = "force-dynamic";

// エンカンAI用：未エントリーの案件のエントリーCSV (管理ボードの「エントリー」と同じ列・見出しなし)。
//   GET /api/enkan/entry?since=YYYY-MM-DD   (Authorization: Bearer <ENKAN_API_TOKEN>)
//   ・日付ではなく「まだエントリー済みになっていない」で拾う — 前の日に漏れた分も入る。
//   ・since は必須。entered_at を記録する前の案件を拾わないための区切り (export-query 参照)。
//   ・読むだけ。エントリー済みにするのは POST /api/enkan/entered (先方へ入れ終わってから)。
export async function GET(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;

  const since = new URL(req.url).searchParams.get("since") ?? "";
  if (!DATE_RE.test(since)) {
    return NextResponse.json({ error: "since-required", detail: "since=YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const rows = await loadEntryTodoExport(since);
    return csvJson(entryCsvLines(rows, false), `entry_todo_${todayJst()}.csv`,
                   rows.map((r) => r.accountId));
  } catch (e: any) {
    // entered_at 列が無い (p004 未適用) などは、全件を未エントリーとして返さずに止める
    return NextResponse.json({ error: "query-failed", detail: String(e?.message ?? e).slice(0, 300) },
                             { status: 500 });
  }
}
