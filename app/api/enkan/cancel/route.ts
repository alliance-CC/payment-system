import { NextResponse } from "next/server";
import { denyUnlessEnkan, csvJson, DATE_RE } from "@/features/enkan/respond";
import { loadCancelExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";
import { csvCell } from "@/features/payments/csv";

export const dynamic = "force-dynamic";

// エンカンAI用：解約CSV (管理ボードの「解約」と同じ列・見出しなし)。
//   GET /api/enkan/cancel?from=YYYY-MM-DD&to=YYYY-MM-DD   (省略時は今日・JST)
export async function GET(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;

  const url = new URL(req.url);
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
