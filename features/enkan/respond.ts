import { NextResponse } from "next/server";
import { toExcelCsv } from "@/features/payments/csv";
import { enkanAuthorized, enkanTokenConfigured } from "./auth";
import { rowsWithoutPlanKind, type PlanKind } from "@/features/payments/plan-kind";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 合言葉が合わなければ返すレスポンス。合っていれば null。 */
export function denyUnlessEnkan(req: Request): NextResponse | null {
  if (!enkanTokenConfigured()) {
    return NextResponse.json({ error: "enkan-api-disabled" }, { status: 503 });
  }
  if (!enkanAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * CSV を、管理ボードのダウンロードと同じ中身 (Shift_JIS / CRLF) で JSON に包んで返す。
 * 会員IDの並びも一緒に返す — エンカンAIは「このCSVに入れたIDだけ」をエントリー済みにするため。
 * extra は返事に足す項目 (プランで分けたときの plan / otherPlanIds)。
 */
export async function csvJson(lines: string[], filename: string, accountIds: string[],
                              extra: Record<string, unknown> = {}) {
  const buf = Buffer.from(await toExcelCsv(lines).arrayBuffer());
  return NextResponse.json({
    ...extra,
    filename,
    count: accountIds.length,
    accountIds,
    csvBase64: buf.toString("base64"),
  }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * `plan` で分けたときに返事へ足す項目。
 *   plan         … 分けた区分をそのまま返す。エンカンAIはこれが返ってこなければ止まる
 *                  (分けられない古い版が全件を返すと、両方の入れ先へ同じ人を入れてしまうため)。
 *   otherPlanIds … 区分の分からない行の会員ID。どちらの CSV にも入らないので、黙って落とさず名指しする。
 */
export function planExtra<T extends { accountId: string; planKind: PlanKind | null }>(
  kind: PlanKind | null, allRows: T[],
): Record<string, unknown> {
  if (!kind) return {};
  return { plan: kind, otherPlanIds: rowsWithoutPlanKind(allRows).map((r) => r.accountId) };
}

/** `plan` が plus / premium 以外のときの 400 (黙って全件を返さない)。 */
export function badPlan(): NextResponse {
  return NextResponse.json({ error: "bad-plan", detail: "plan=plus か plan=premium" }, { status: 400 });
}
