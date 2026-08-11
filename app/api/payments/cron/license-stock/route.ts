import { NextResponse } from "next/server";
import { countLicenseStock } from "@/features/payments/entry-sheet";
import { patchPaymentSettings } from "@/features/payments/payment-settings";

// ② ライセンスキー在庫の日次集計。
// vercel.json の crons から毎日 00:00 UTC (= 9:00 JST) に起動される。
//   連携スプレッドシートの「ライセンスキー」タブを読み、
//     母数 = A列2行目以降でキーが入っている行数 (増える可能性あり)
//     使用 = そのうち B列(会員ID)が入っている行数
//   を数えて、残数を課金設定 (/admin/settings) に記録する。
//   - 認可: 課金 Cron と同じ CRON_SECRET (本番では必須)。
//   - 課金は行わない読み取り専用の処理。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else if (String(process.env.VT_PRODUCTION ?? "false").toLowerCase() === "true") {
    return NextResponse.json({ error: "cron-secret-required-in-production" }, { status: 503 });
  }

  const stock = await countLicenseStock();
  if (!stock) {
    // スプレッドシート未設定/読み取り失敗。既存の記録は残したまま何もしない
    console.error("[payments/cron/license-stock] sheet unavailable");
    return NextResponse.json({ ok: false, error: "sheet-unavailable" }, { status: 200 });
  }

  const saved = await patchPaymentSettings({
    licenseStock: { ...stock, checkedAt: new Date().toISOString() },
  });
  console.log("[payments/cron/license-stock]", JSON.stringify({ ...stock, saved: saved.ok }));
  return NextResponse.json({ ok: saved.ok, ...stock, error: saved.error });
}
