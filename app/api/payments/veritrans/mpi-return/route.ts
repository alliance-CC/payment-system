import { NextResponse } from "next/server";
import { finalizeMpiOrder } from "@/features/payments/billing";
import { rateLimit, clientIpOf } from "@/shared/utils/rateLimit";

// 3Dセキュア2.0 ブラウザ復帰の受け口 (認可要求の redirectionUri。ガイド 4.4.1)。
// チャレンジ完了後、決済サーバーが消費者ブラウザをここへ POST (verifyResultLink=1) で戻す。
//
// ・キー情報は「RequestId」「OrderId」(旧仕様互換で先頭大文字) で届く。
// ・詳細パラメータ (mpiMstatus / vAuthInfo 等) も届くが、ブラウザ経由の値は
//   ここでは一切信用しない — orderId だけを取り出し、確定は finalizeMpiOrder が
//   MpiGetResult (署名付きサーバー間照会) で行う。改ざん POST では状態は変わらない。
// ・複数回アクセスされてもエラーにしないこと (ガイド 3-2-1 注意書き)。finalize は冪等。
// ・PUSH (mpi-result) と非同期・順不同 — どちらが先でも同じ結果になる。
//
// 処理後は結果表示ページ /subscribe/complete へ 303 リダイレクト (PRG パターン)。
async function handle(req: Request): Promise<Response> {
  // ブラウザから叩かれるオープンな口のため、照会連打の防壁として軽いレート制限
  const rl = rateLimit(`mpi-return:${clientIpOf(req)}`, { limit: 20, windowMs: 60_000 });
  const url = new URL(req.url);

  let orderId = url.searchParams.get("OrderId") ?? url.searchParams.get("orderId") ?? "";
  if (!orderId && req.method === "POST") {
    const raw = await req.text().catch(() => "");
    const form = Object.fromEntries(new URLSearchParams(raw));
    orderId = form.OrderId ?? form.orderId ?? "";
  }
  orderId = orderId.slice(0, 100);

  const dest = new URL("/subscribe/complete", url.origin);
  if (orderId) dest.searchParams.set("order", orderId);

  if (!orderId || !rl.allowed) {
    dest.searchParams.set("r", "pending");
    return NextResponse.redirect(dest, 303);
  }

  try {
    const fin = await finalizeMpiOrder(orderId);
    const r =
      fin.state === "activated" || fin.state === "already-active" ? "ok"
      : fin.state === "failed" || fin.state === "already-failed" ? "ng"
      : "pending"; // pending / unknown-order → 結果ページ側で案内
    dest.searchParams.set("r", r);
  } catch (e: any) {
    console.error("[payments/mpi-return] finalize error:", orderId, String(e?.message ?? e));
    dest.searchParams.set("r", "pending"); // PUSH 側の確定に任せ、案内表示に留める
  }
  return NextResponse.redirect(dest, 303);
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
