import { NextResponse } from "next/server";
import { denyUnlessEnkan } from "@/features/enkan/respond";
import { setCancelEnteredByAccountIds } from "@/features/payments/store";

export const dynamic = "force-dynamic";

const MAX_IDS = 500;

// エンカンAI用：渡した会員IDだけを「解約エントリー済み」にする (管理ボードのボタンと同じ処理)。
//   POST /api/enkan/cancel-entered   body: {"accountIds": ["MR...", ...]}
//   ・立てるだけ。外す (取り消す) のは管理ボードから人が行う。
//   ・解約していない案件・すでに解約エントリー済みの案件は変えない (count は実際に変わった件数)。
export async function POST(req: Request) {
  const denied = denyUnlessEnkan(req);
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  const ids: string[] = Array.isArray(body?.accountIds)
    ? body.accountIds.map((s: unknown) => String(s ?? "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return NextResponse.json({ error: "accountIds-required" }, { status: 400 });
  if (ids.length > MAX_IDS) return NextResponse.json({ error: "too-many" }, { status: 400 });

  const res = await setCancelEnteredByAccountIds(ids, true);
  if (!res.ok) return NextResponse.json({ error: "update-failed", detail: res.error ?? "" }, { status: 500 });
  return NextResponse.json({ ok: true, requested: ids.length, count: res.count });
}
