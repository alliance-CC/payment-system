import { NextResponse } from "next/server";
import { runDailyCharges, sweepAbandoned3ds } from "@/features/payments/billing";

// 日次の継続課金実行 (§5-② 確定方式 / §6-5,6)。
// vercel.json の crons から毎日 01:00 UTC (= 10:00 JST) に起動される。
//   - 「次回課金日 ≤ 本日(JST)」かつ「契約中/延滞」の会員を抽出し、
//     会員ID指定の都度決済 (OpenAPI) → 結果を即時 CRM 反映。
//   - べき等: orderId = accountId_YYYYMM(+ _rN) + DB 一意制約 (§5-②)。
//   - 認可: Vercel Cron は Authorization: Bearer ${CRON_SECRET} を付与する。
//     CRON_SECRET 未設定の環境 (ローカル検証等) では拒否しない。
export const maxDuration = 300; // 大量課金対策 (§5-② 注意)。超える規模はバッチ分割へ (§10)
export const dynamic = "force-dynamic"; // ビルド時プリレンダリングで課金処理が走るのを防ぐ

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (String(process.env.VT_PRODUCTION ?? "false").toLowerCase() === "true") {
    // 本番接続では CRON_SECRET 必須 (未設定のまま課金エンドポイントを開放しない)
    return NextResponse.json({ error: "cron-secret-required-in-production" }, { status: 503 });
  }

  // 課金の前に、放置された 3DS 申込を片付ける (/api/payments/cron/mpi-sweep と同じ処理)。
  // 専用の cron を持たせず日次課金に相乗りさせているのは Vercel Hobby の制限
  // (cron は2本まで・日次のみ) のため。Pro なら mpi-sweep を毎時で回すほうが復旧が早い。
  // スイープ自身が実行時間バジェット (45s) を持ち、課金側の 240s と合わせても
  // maxDuration=300s に収まる。失敗しても課金は実行する (片付けは翌日に持ち越せる)。
  const sweep = await sweepAbandoned3ds().catch((e: any) => {
    console.error("[payments/cron] 3ds sweep failed:", String(e?.message ?? e));
    return null;
  });

  const summary = await runDailyCharges();
  // 運用ログ (Vercel の Cron 実行ログから確認できる)
  console.log("[payments/cron]", JSON.stringify({ ...summary, sweep }));
  return NextResponse.json({ ...summary, sweep });
}
