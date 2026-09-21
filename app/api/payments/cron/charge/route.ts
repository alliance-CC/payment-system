import { NextResponse } from "next/server";
import {
  runDailyCharges, sweepAbandoned3ds, notifyCronFailure, recordDailyChargeRun,
} from "@/features/payments/billing";
import { pingDb } from "@/features/payments/store";

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

  // ⓪ DBに繋がるかを先に確かめる。
  //    繋がらないまま進むと課金対象が「0件」に見え、1件も課金していないのに
  //    正常終了として記録されてしまう (=誰も気づけない)。失敗は必ず残して止める。
  const health = await pingDb();
  if (!health.ok) {
    await notifyCronFailure("DBに接続できないため課金を実行しませんでした", health.error ?? "");
    return NextResponse.json(
      { error: "db-unavailable", detail: health.error ?? "" },
      { status: 503 },
    );
  }

  // 課金の前に、放置された 3DS 申込を片付ける (/api/payments/cron/mpi-sweep と同じ処理)。
  // ① 課金を先に実行する。
  //    実行時間の上限に当たったとき、後回しにできるのは片付け (sweep) のほうで、
  //    課金は当日中に済ませたい。スイープを先に回すと、そこで時間を使い切った場合に
  //    その日の課金が丸ごと流れてしまうため、順序は入れ替えないこと。
  let summary;
  try {
    summary = await runDailyCharges();
  } catch (e: any) {
    // 想定外の中断。ここで黙って 500 にすると Cron ログを見ない限り気づけない
    const detail = String(e?.message ?? e);
    await notifyCronFailure("課金処理が途中で異常終了しました", detail);
    return NextResponse.json({ error: "charge-run-failed", detail }, { status: 500 });
  }

  // ② 放置された 3DS 申込の片付け (/api/payments/cron/mpi-sweep と同じ処理)。
  //    専用の cron を持たせず日次課金に相乗りさせている。
  //    失敗しても課金の結果には影響しない (片付けは翌日に持ち越せる)。
  const sweep = await sweepAbandoned3ds().catch((e: any) => {
    console.error("[payments/cron] 3ds sweep failed:", String(e?.message ?? e));
    return null;
  });

  // ③ 完走の記録 (管理ボードが「Cronが動いているか」を見るために使う)
  await recordDailyChargeRun(summary);

  // 運用ログ (Vercel の Cron 実行ログから確認できる)
  console.log("[payments/cron]", JSON.stringify({ ...summary, sweep }));

  // 個別の課金失敗も通知する (放置すると未課金のまま月をまたぐ)
  if (summary.errors.length) {
    await notifyCronFailure(
      `課金処理で ${summary.errors.length} 件のエラーが出ました`,
      summary.errors.slice(0, 20).join(" / "),
    );
  }
  return NextResponse.json({ ...summary, sweep });
}
