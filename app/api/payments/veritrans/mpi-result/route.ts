import { NextResponse } from "next/server";

// 3Dセキュア (3DS2.0) 結果通知の受け口 (pushUrl §4 / §6-4)。
//
// ⚠️ SPEC_CHECK: 通知電文のフォーマット (JSON / form)・署名検証・応答仕様は
//    3DS 開発ガイド (§9) との照合が必要。テスト利用情報通知書の取得後、
//    検証環境でチャレンジフローを通しながら実装を確定させること。
//    VT_USE_3DS=true になるまで申込フローはこの受け口を使用しない (billing-config)。
//
// §8: この受け口は安定して即応答する必要がある。重い処理 (課金確定・CRM反映) は
//     受信記録と切り離し、失敗時に再処理できる形にする。
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  // TODO(§6-4): 電文の検証 → orderId で契約特定 → 3DS 結果に応じて
  //   /Authorize/card (mpi 完了フラグ付き SPEC_CHECK) を実行 → 契約有効化。
  // 現段階では受信を記録するのみ (仕様照合前に誤実装で課金しないため)。
  console.log("[payments/mpi-result] received:", raw.slice(0, 2000));
  return NextResponse.json({ ok: true });
}
