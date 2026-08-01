import { NextResponse } from "next/server";
import { authorizeMpi } from "@/features/payments/veritrans/paynowid";
import { loadVeritransConfig } from "@/features/payments/veritrans/config";

export const dynamic = "force-dynamic";

// 3Dセキュア(3DS2.0) 疎通テスト (検証環境のみ)。
//   authorizeMpi(/Authorize/mpi) を1回だけ呼び、VeriTransの生レスポンスをそのまま返す。
//   目的: 「3DSで何を要求され・何が返るか」を実機で確認し、本実装の必須フィールドを確定する。
//   ・本番(production)では実行しない。・課金や契約作成は一切行わない。
//   ・カード番号/セキュリティコードはトークン化済みでサーバー非通過(§2/§7)。
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "token-required" }, { status: 400 });

  const cfg = await loadVeritransConfig();
  if (cfg.production) return NextResponse.json({ error: "verification-only（本番では実行しません）" }, { status: 400 });
  if (!cfg.merchantCcid || !cfg.merchantKey) return NextResponse.json({ error: "veritrans-not-configured（CCID/鍵が未設定）" }, { status: 400 });

  const origin = new URL(req.url).origin;
  try {
    const r = await authorizeMpi(
      {
        orderId: `probe_${Date.now()}`,
        amount: 100,
        token,
        pushUrl: `${origin}/api/payments/veritrans/mpi-result`,
        redirectionUri: `${origin}/subscribe/3ds-return`,
      },
      cfg,
    );
    return NextResponse.json({
      ok: r.ok,
      mstatus: r.mstatus,
      vResultCode: r.vResultCode,
      authStartUrl: r.authStartUrl ?? null,
      // 本人認証画面のHTML。ブラウザ側でこれを表示して認証を実行する。
      challengeHtml: r.resResponseContents ?? null,
      transportError: r.transportError ?? null,
      raw: r.raw,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 400) }, { status: 500 });
  }
}
