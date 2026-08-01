import { NextResponse } from "next/server";
import { save3dsDebug } from "@/features/payments/veritrans/threeds-debug";

// 3Dセキュア (3DS2.0) 結果通知の受け口 (pushUrl §4 / §6-4)。
//
// ⚠️ SPEC_CHECK: 通知電文のフォーマット・署名検証・応答仕様は 3DS 開発ガイドとの照合が必要。
//    現状は「検証用に受信内容をそのまま保存」するのみ。認証完了後に /subscribe/3ds-return
//    で内容を確認できる。VT_USE_3DS=true になるまで申込フローはこの受け口を本番用途では使わない。
//
// §8: この受け口は安定して即応答する必要がある。重い処理はしない。
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  const ct = req.headers.get("content-type");
  // 検証用: 認証完了後に /subscribe/3ds-return で内容を確認できるよう退避 (失敗しても即200)
  await save3dsDebug("push", raw, ct);
  console.log("[payments/mpi-result] received:", raw.slice(0, 2000));
  return NextResponse.json({ ok: true });
}
