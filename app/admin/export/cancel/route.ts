import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadCancelExport } from "@/features/payments/export-query";
import { todayJst } from "@/features/payments/billing-config";

export const dynamic = "force-dynamic";

// ④-2 解約CSV。解約日を軸に、指定した期間 (from〜to) の解約を出力する。
//   項目は 顧客ID(会員ID) と 解約日 のみ (画像4)。
const HEADER = ["顧客ID", "解約日"];

function cell(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function validDate(s: string | null, fallback: string): string {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.redirect(new URL("/admin/login", req.url));

  const url = new URL(req.url);
  const today = todayJst();
  const from = validDate(url.searchParams.get("from"), today);
  const to = validDate(url.searchParams.get("to"), from);

  const rows = await loadCancelExport(from, to);

  const lines = [HEADER.map(cell).join(",")];
  for (const r of rows) lines.push([r.accountId, r.canceledDate].map(cell).join(","));

  // Excel で文字化けしないよう BOM 付き UTF-8 / CRLF
  const body = "﻿" + lines.join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cancel_${from}_${to}.csv"`,
    },
  });
}
