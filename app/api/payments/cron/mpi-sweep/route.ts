import { NextResponse } from "next/server";
import { sweepAbandoned3ds } from "@/features/payments/billing";

// 放置された 3DS 申込の定期片付け。
// vercel.json の crons から毎時 :20 に起動される。
//   3DS はブラウザ遷移を挟むため、認証画面 (ACS) で離脱されると結果が返らず、
//   課金行が ok=null のまま = 管理ボードで「確認中」が永久に残る。これを拾って
//   VeriTrans へ照会し、確定できるものを確定する (成功なら有効化 / 期限切れなら失敗確定)。
//   - 判定は必ず MpiGetResult (署名付き照会) 経由。このジョブ自体は成否を推測しない。
//   - 対象は申込時の 0円与信のみ。日次課金の在疑義 (金額あり) には触れない
//     — 勝手に失敗確定すると別 orderId で再課金され二重課金になるため、
//       従来どおり VT 取引照会のうえ手動確定する運用に委ねる。
//   - 認可: 課金 Cron と同じ CRON_SECRET (本番では必須)。
export const maxDuration = 60;   // 1件ごとに VT 照会が入るため余裕を持たせる
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (String(process.env.VT_PRODUCTION ?? "false").toLowerCase() === "true") {
    // 本番接続では CRON_SECRET 必須 (契約状態を変える口を無認可で開放しない)
    return NextResponse.json({ error: "cron-secret-required-in-production" }, { status: 503 });
  }

  const summary = await sweepAbandoned3ds();
  console.log("[payments/cron/mpi-sweep]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
