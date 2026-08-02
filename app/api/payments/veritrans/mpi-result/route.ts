import { NextResponse } from "next/server";
import { finalizeMpiOrder } from "@/features/payments/billing";

// 3Dセキュア2.0 結果通知 (PUSH) の受け口 (3DS 開発ガイド 4-5 / 認可要求の pushUrl)。
//
// 電文形式 (ガイド 4-5 照合済み):
//   numberOfNotify=<件数> & pushTime & pushId
//   + 件数分の orderIdNNNN / vResultCodeNNNN / txnTypeNNNN / mpiMstatusNNNN /
//     cardMstatusNNNN / dummyNNNN (NNNN=0000〜0049 の連番。項目の並び順は不定)
//   ・初回通知は必ず1件。200番台を返さないとリトライされ、リトライ時は複数件まとまる。
//   ・pushId は他決済サービスと重複しうるためユニークキーにしない。
//
// ⚠️ この電文には改ざんチェック値 (vAuthInfo) が無い。通知内の mpiMstatus 等を
//    信用して契約を有効化してはならない — orderId だけを取り出し、確定は
//    finalizeMpiOrder が MpiGetResult (authHash 署名付きサーバー間照会) で行う。
//    偽の PUSH が来ても照会結果でしか状態は変わらないため詐称は成立しない。
//
// §8: 受け口は安定して応答すること。確定処理 (照会+契約更新+通知メール) は
//     数秒で終わる想定だが、失敗時は 500 を返し VT のリトライ再送に乗せる。
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");

  // form-urlencoded を基本に、JSON でも受けられるよう防御的に解析
  // (SPEC_CHECK: Content-Type は決済サービス共通仕様。検証環境の実通知で確認)
  let fields: Record<string, string> = {};
  try {
    if (raw.trim().startsWith("{")) {
      const j = JSON.parse(raw);
      for (const [k, v] of Object.entries(j ?? {})) fields[k] = String(v ?? "");
    } else {
      fields = Object.fromEntries(new URLSearchParams(raw));
    }
  } catch {
    fields = {};
  }

  // orderIdNNNN (連番) と、念のため素の orderId も拾う
  const orderIds = new Set<string>();
  for (const [k, v] of Object.entries(fields)) {
    if (/^orderId\d{4}$/.test(k) && v) orderIds.add(v);
  }
  if (fields.orderId) orderIds.add(fields.orderId);

  if (!orderIds.size) {
    // 解析不能・orderId 無し: リトライされても結果は同じなので 200 で受ける (内容はログ)
    console.error("[payments/mpi-result] no orderId in push:", raw.slice(0, 1000));
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results: Record<string, string> = {};
  let hadError = false;
  for (const orderId of orderIds) {
    try {
      const fin = await finalizeMpiOrder(orderId);
      results[orderId] = fin.state;
    } catch (e: any) {
      hadError = true;
      results[orderId] = "error";
      console.error("[payments/mpi-result] finalize error:", orderId, String(e?.message ?? e));
    }
  }
  console.log("[payments/mpi-result] processed:", JSON.stringify(results));

  // 予期しない例外があった通知だけ 500 → VT の再送で再処理する
  // (finalize は冪等なので再送で二重確定はしない)
  if (hadError) {
    return NextResponse.json({ ok: false, results }, { status: 500 });
  }
  return NextResponse.json({ ok: true, results });
}
