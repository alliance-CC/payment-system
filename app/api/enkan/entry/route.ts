import { NextResponse } from "next/server";
import { denyUnlessEnkan, csvJson, DATE_RE, planExtra, badPlan } from "@/features/enkan/respond";
import { loadEntryTodoExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { entryCsvLines } from "@/features/payments/entry-csv";
import { plusEntryCsvLines } from "@/features/payments/plus-entry-csv";
import { parsePlanKind, filterByPlanKind } from "@/features/payments/plan-kind";

export const dynamic = "force-dynamic";

// エンカンAI用：未エントリーの案件のエントリーCSV (管理ボードの「エントリー」と同じ列・見出しなし)。
//   GET /api/enkan/entry?since=YYYY-MM-DD[&plan=plus|premium]   (Authorization: Bearer <ENKAN_API_TOKEN>)
//   ・日付ではなく「まだエントリー済みになっていない」で拾う — 前の日に漏れた分も入る。
//   ・since は必須。entered_at を記録する前の案件を拾わないための区切り (export-query 参照)。
//   ・plan を付けると、その区分 (プラス / プレミアム) だけを返す — 先方の入れ先が区分ごとに別のため。
//     返事に plan (分けた区分) と otherPlanIds (区分の分からない会員ID) が付く。
//     plan が無ければ、これまでどおり全件 (古いエンカンAIのため)。
//     ⚠️ プラスは入れ先が別なので CSV の形も別 (plus-entry-csv.ts・先方の見本の47列)。プレミアム・全件は今までの23列。
//   ・読むだけ。エントリー済みにするのは POST /api/enkan/entered (先方へ入れ終わってから)。
export async function GET(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const since = url.searchParams.get("since") ?? "";
  if (!DATE_RE.test(since)) {
    return NextResponse.json({ error: "since-required", detail: "since=YYYY-MM-DD" }, { status: 400 });
  }
  const kind = parsePlanKind(url.searchParams.get("plan"));
  if (kind === "invalid") return badPlan();

  try {
    const all = await loadEntryTodoExport(since);
    const rows = filterByPlanKind(all, kind);
    const today = todayJst();
    const name = kind ? `entry_todo_${kind}_${today}.csv` : `entry_todo_${today}.csv`;
    // エンカンAIはこの返事を受け取ってすぐ先方へ入れるので、入力日・データ連携日はきょう
    const lines = kind === "plus" ? plusEntryCsvLines(rows, false, today) : entryCsvLines(rows, false);
    return csvJson(lines, name, rows.map((r) => r.accountId), planExtra(kind, all));
  } catch (e: any) {
    // entered_at 列が無い (p004 未適用) などは、全件を未エントリーとして返さずに止める
    return NextResponse.json({ error: "query-failed", detail: String(e?.message ?? e).slice(0, 300) },
                             { status: 500 });
  }
}
