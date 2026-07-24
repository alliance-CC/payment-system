import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadBoard } from "@/features/payments/admin-query";
import { todayJst } from "@/features/payments/billing-config";

export const dynamic = "force-dynamic";

function cell(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// 登録者リストの CSV 出力 (管理者のみ)。カード等の決済個人情報は含めない (§7)。
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.redirect(new URL("/admin/login", req.url));

  const url = new URL(req.url);
  const mp = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(mp) ? mp : todayJst().slice(0, 7);
  const status = url.searchParams.get("status") ?? "all";
  const q = url.searchParams.get("q") ?? "";

  const { rows } = await loadBoard({ month, status, q });

  const header = [
    "申込日", "会員ID", "プラン", "利用開始日", "課金開始日", "状況",
    `当月課金(${month})`, "氏名", "フリガナ", "電話番号", "メール", "支払方法", "利用規約", "解約日",
  ];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push([
      r.appliedAt, r.accountId, r.planName, r.serviceStart, r.chargeStart, r.statusLabel,
      r.monthBilling, r.name ?? "", r.nameKana ?? "", r.phone ?? "", r.email ?? "", r.paymentMethod,
      r.consented ? "同意済" : "未同意", r.canceledAt ?? "",
    ].map(cell).join(","));
  }
  // Excel で文字化けしないよう BOM 付き UTF-8 / CRLF
  const body = "﻿" + lines.join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrants_${month}.csv"`,
    },
  });
}
