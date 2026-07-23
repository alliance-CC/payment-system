// VeriTrans 4G (DGFT) OPEN API — 接続設定。
// 引き継ぎ資料 §2 / §3 準拠。接続先ドメインは api3.veritrans.co.jp のみ (旧 api. は廃止)。
//
// OEM 方針 (§1.2): 会社ごとに変わる値 (CCID・鍵・token_api_key・接続先) は
// すべて DB(integrations) または env から取得し、コードに直書きしない。
import { getIntegration } from "@/features/integrations/service";

// --- 固定エンドポイント (仕様で決まっており会社ごとに変わらない) ---
export const VT_ENDPOINTS = {
  // カードトークン化 (ブラウザから直接POST。authHash 不要・URLエンコード不要)
  token: "https://api3.veritrans.co.jp/4gtoken",
  // 決済APIベース (検証 / 本番) — Authorize/card, Authorize/mpi 等
  test: "https://api3.veritrans.co.jp/test-paynow/v2",
  prod: "https://api3.veritrans.co.jp/paynow/v2",
  // 会員管理APIベース (検証 / 本番) — {Add|Update|Delete}/{account|cardinfo|recurring}
  // (2026-07 仕様照合: 決済系とは別系統の paynowid/v1 を使う)
  memberTest: "https://api3.veritrans.co.jp/test-paynowid/v1",
  memberProd: "https://api3.veritrans.co.jp/paynowid/v1",
} as const;

// 決済系APIの共通バージョン (§3-5)
export const VT_TXN_VERSION = "2.0.0";

export type VeritransConfig = {
  merchantCcid: string;
  merchantKey: string;
  tokenApiKey: string;
  production: boolean;
  /** 決済APIのベースURL (production に応じて test/prod を選択) */
  baseUrl: string;
  /** 会員管理APIのベースURL ({test-}paynowid/v1) */
  memberBaseUrl: string;
  /** ダミー取引フラグ: 検証 "1" / 本番取引 "0" (§3-4) */
  dummyRequest: "0" | "1";
  source: "db" | "env" | "none";
};

// サーバー側でのみ呼ぶこと (merchantKey を含むため)。
// OEM (§1.2): tenantId を渡すと自テナントの integrations 行を優先し、無ければ env。
// tenantId 無しは env のみ (= 弊社=既定テナントの設定)。
export async function loadVeritransConfig(tenantId?: string | null): Promise<VeritransConfig> {
  const integ = await getIntegration("veritrans", { tenantId });
  const production = String(integ.config.production ?? "false").toLowerCase() === "true";
  return {
    merchantCcid: integ.secret.merchant_ccid ?? "",
    merchantKey: integ.secret.merchant_key ?? "",
    tokenApiKey: integ.config.token_api_key ?? "",
    production,
    baseUrl: production ? VT_ENDPOINTS.prod : VT_ENDPOINTS.test,
    memberBaseUrl: production ? VT_ENDPOINTS.memberProd : VT_ENDPOINTS.memberTest,
    dummyRequest: production ? "0" : "1",
    source: integ.source,
  };
}

// ブラウザに渡してよい公開情報のみを抽出 (merchantKey / CCID は絶対に含めない)。
export type VeritransPublicConfig = {
  tokenApiKey: string;
  tokenUrl: string;
  configured: boolean;
};

export function toPublicConfig(cfg: VeritransConfig): VeritransPublicConfig {
  return {
    tokenApiKey: cfg.tokenApiKey,
    tokenUrl: VT_ENDPOINTS.token,
    // authorize に必要な秘密鍵が揃っているか (トークンだけでは決済不可)
    configured: !!(cfg.merchantCcid && cfg.merchantKey && cfg.tokenApiKey),
  };
}
