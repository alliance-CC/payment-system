import { NextResponse } from "next/server";
import { denyUnlessEnkan } from "@/features/enkan/respond";
import { loadSafTodo, applySafFill, type SafFillItem } from "@/features/payments/saf-fill";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 500;

// エンカンAI用：SAF案件番号（＝Salesforce の案件ID）とフリガナを、あとから入れる（担当者 2026-11-27）。
//   GET  /api/enkan/saf   … 案件IDの形でない・フリガナが空の契約（申込未完了は除く）
//   POST /api/enkan/saf   body: {"items": [{"accountId", "oldSafCaseNo", "safCaseNo"?, "kana"?}, ...]}
//        ・SAF案件番号は、いまの値が oldSafCaseNo のときだけ書く（その間に人が直した値を消さない）
//        ・フリガナは空のときだけ書く
//   エンカンAI（暮らし安心のエントリー）が、Salesforce で案件番号・電話番号とお名前から案件IDを引いて入れる。
export async function GET(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;
  try {
    const rows = await loadSafTodo();
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: "query-failed", detail: String(e?.message ?? e).slice(0, 300) },
                             { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const items: SafFillItem[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ error: "items-required" }, { status: 400 });
  if (items.length > MAX_ITEMS) return NextResponse.json({ error: "too-many" }, { status: 400 });
  try {
    const res = await applySafFill(items);
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ error: "update-failed", detail: String(e?.message ?? e).slice(0, 300) },
                             { status: 500 });
  }
}
