// VeriTrans 4G OPEN API — サーバー側共通呼び出し。
// 引き継ぎ資料 §3 の Python 参考実装を TypeScript へ移植したもの。
//
// ⚠️ 典型バグ (§3): authHash に使う minify(params) 文字列と、実際に送信する
//    params 部分の文字列は「バイト単位で完全一致」させること。
//    → minify 文字列を 1 度だけ作り (`p`)、それを hash 計算にも body 生成にも使い回す。
//      params を二重にシリアライズしない。
// ⚠️ このモジュールは merchantKey を扱うためサーバー専用。クライアントから import しないこと。
import { loadVeritransConfig, VT_TXN_VERSION, type VeritransConfig } from "./config";
import { signVtRequest } from "./signing";

export type VtResult = {
  /** 生レスポンス。result.mstatus / result.vResultCode で判定 (§3) */
  raw: any;
  mstatus: string | null;
  vResultCode: string | null;
  ok: boolean;
  /** mstatus="pending" (保留)。失敗扱いにせず結果未確定として扱うこと (二重課金防止) */
  pending: boolean;
  /** 結果不明: VeriTrans から確定応答を得られていない (通信断・タイムアウト・HTTPエラー・
   *  応答不正)。VT 側で成立している可能性があるため、確定失敗として別 orderId で
   *  リトライしてはならない (= 二重課金)。pending と同様に在疑義 (ok=null) 扱いにする。
   *  ※ 設定不備 (veritrans-not-configured) はリクエスト未送信で確定的に未課金なので false */
  indeterminate: boolean;
  /** 通信自体が失敗した場合のエラー (HTTP エラー等) */
  transportError?: string;
};

// API の共通呼び出し。path は "/Authorize/card" (決済系) / "/Delete/account" (会員管理系) 等。
// base="member" で会員管理系ベースURL ({test-}paynowid/v1) を使う。
export async function vtCall(
  path: string,
  params: Record<string, any>,
  cfg?: VeritransConfig,
  base: "payment" | "member" = "payment",
): Promise<VtResult> {
  const c = cfg ?? (await loadVeritransConfig());
  if (!c.merchantCcid || !c.merchantKey) {
    // リクエスト未送信 = 確定的に未課金 → indeterminate=false (安全に扱える)
    return { raw: null, mstatus: null, vResultCode: null, ok: false, pending: false, indeterminate: false, transportError: "veritrans-not-configured" };
  }

  // merchantCcid は params 内の必須フィールド (公式リファレンスのリクエスト例で確認。
  // authHash だけではサーバーが加盟店を特定できない)
  const fullParams = { ...params, merchantCcid: c.merchantCcid };
  // 署名の詳細 (minify 1回・authHash・URLエンコード §3) は signing.ts に分離 (テスト対象)
  const signed = signVtRequest(fullParams, c.merchantCcid, c.merchantKey);

  try {
    const res = await fetch((base === "member" ? c.memberBaseUrl : c.baseUrl) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: signed.body,
    });
    const raw = await res.json().catch(() => null);
    const result = raw?.result ?? {};
    const mstatus = result.mstatus ?? null;
    return {
      raw,
      mstatus,
      vResultCode: result.vResultCode ?? null,
      ok: mstatus === "success",
      pending: mstatus === "pending",
      // HTTP エラー or mstatus が読めない = 確定応答なし → 結果不明 (在疑義扱い)
      indeterminate: !res.ok || mstatus === null,
      transportError: res.ok ? undefined : `http-${res.status}`,
    };
  } catch (e: any) {
    // fetch 例外 (タイムアウト・接続断・DNS) = VT 到達可否も結果も不明 → 在疑義扱い
    return { raw: null, mstatus: null, vResultCode: null, ok: false, pending: false, indeterminate: true, transportError: String(e?.message ?? e) };
  }
}

// --- /Authorize/card : カード与信 (§4) ---
// 最小構成 (§6 step 3): MDK トークン + orderId + amount で与信+売上を同時実行。
// 3Dセキュア (§6-4)・PayNow ID 会員登録/継続課金 (§6-5) は次段階。
export type AuthorizeCardInput = {
  orderId: string;
  amount: number;
  token: string;        // ブラウザで /4gtoken から取得した MDK トークン
  tokenKey?: string;    // トークンに紐づくキー (MDK が返す token_key)
  withCapture?: boolean; // true=与信+売上同時 (既定 true)
  /** CRM 相互参照用 (§5)。顧客ID/案件ID 等を入れる */
  freeKey?: string;
};

export async function authorizeCard(input: AuthorizeCardInput, cfg?: VeritransConfig): Promise<VtResult> {
  const c = cfg ?? (await loadVeritransConfig());
  // 2026-07 仕様照合: MDK トークンは payNowIdParam.token に載せる
  // (公式リファレンスの Authorize/card リクエスト例で確認。top-level の token ではない)
  const payNowIdParam: Record<string, any> = { token: input.token };
  if (input.freeKey) payNowIdParam.freeKey = input.freeKey;
  const params: Record<string, any> = {
    txnVersion: VT_TXN_VERSION,
    dummyRequest: c.dummyRequest,           // ダミー取引="1" / 本番取引="0" (§3-4)
    orderId: input.orderId,                 // VeriTrans↔CRM 結合キー (§5)
    amount: String(input.amount),
    withCapture: String(input.withCapture ?? true),
    jpo: "10",                              // 支払区分: 一括 (公式確認済み。分割等は §10 で要調整)
    payNowIdParam,
  };
  return vtCall("/Authorize/card", params, c);
}
