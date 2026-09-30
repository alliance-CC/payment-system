import { NextResponse } from "next/server";
import { denyUnlessEnkan, DATE_RE } from "@/features/enkan/respond";
import { loadDataLoaderExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";

export const dynamic = "force-dynamic";

// エンカンAI用：管理ボードの「データローダ」CSVと同じ中身を JSON で返す（Salesforce の進捗反映に使う）。
//   GET /api/enkan/dataloader?from=YYYY-MM-DD&to=YYYY-MM-DD   (to 省略時は今日・JST)
//   ・申込日で抽出し、SAF案件番号が入っている案件だけ（解約済みも含む）
//   ・読むだけ。何も書き換えない
export async function GET(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") || todayJst();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "bad-date", detail: "from=YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const rows = await loadDataLoaderExport(from, to);
    return NextResponse.json({ from, to, count: rows.length, rows },
                             { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: "query-failed", detail: String(e?.message ?? e).slice(0, 300) },
                             { status: 500 });
  }
}
