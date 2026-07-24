import { NextResponse } from "next/server";
import { isAuthed } from "@/features/admin/auth";
import { loadRevenue } from "@/features/payments/revenue-query";
import { todayJst } from "@/features/payments/billing-config";

export const dynamic = "force-dynamic";

function cell(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// 「当月の利用者」だけを CSV 出力 (月単位・実務向け)。カード等の決済個人情報は含めない (§7)。
export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.redirect(new URL("/admin/login", req.url));

  const url = new URL(req.url);
  const mp = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(mp) ? mp : todayJst().slice(0, 7);

  const b = await loadRevenue({ month });

  const header = ["会員ID", "お客様", "プラン", "プラン月額", "利用状況", `当月課金(${month})`];
  const lines = [header.map(cell).join(",")];
  for (const u of b.users) {
    lines.push([
      u.accountId, u.name ?? "", u.planName, u.planAmount,
      u.usageLabel, u.monthState,
    ].map(cell).join(","));
  }
  // 合計行 (利用者数・課金対象・予定・確定)
  lines.push("");
  lines.push(["利用者数", b.usingCount, "課金対象", b.billingCount, "売上予定", b.monthProjected, "売上確定", b.monthConfirmed].map(cell).join(","));

  const body = "﻿" + lines.join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="users_${month}.csv"`,
    },
  });
}
