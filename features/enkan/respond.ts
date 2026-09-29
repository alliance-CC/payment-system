import { NextResponse } from "next/server";
import { toExcelCsv } from "@/features/payments/csv";
import { enkanAuthorized, enkanTokenConfigured } from "./auth";

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
 */
export async function csvJson(lines: string[], filename: string, accountIds: string[]) {
  const buf = Buffer.from(await toExcelCsv(lines).arrayBuffer());
  return NextResponse.json({
    filename,
    count: accountIds.length,
    accountIds,
    csvBase64: buf.toString("base64"),
  }, { headers: { "Cache-Control": "no-store" } });
}
