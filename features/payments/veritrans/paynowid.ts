// VeriTrans 4G — PayNow ID (ワンクリック継続課金) 関連の API 呼び出し (§4 / §6-4〜7)。
//
// 2026-07-11 公式仕様書照合済み (docs/09-payments.md のチェックリスト参照):
//   ✅ 決済系は {test-}paynow/v2、会員管理系は {test-}paynowid/v1 の別ベースURL
//   ✅ payNowIdParam の構造は { token, accountParam: { accountId, accountBasicParam,
//      cardParam, recurringChargeParam }, memo1, freeKey } — accountId は accountParam 配下
//   ✅ 旧実装の memberAdd フラグは存在しない。未登録の accountId を指定すると
//      会員登録+カード登録+課金が自動的に同時実行される (カード登録時は2円与信の
//      有効性確認が走り、失敗すると会員登録ごと失敗する)
//   ✅ 継続課金は token なし・accountParam.accountId のみで「標準カード」に課金
//   ✅ merchantCcid は params 内の必須フィールド (client.ts の vtCall が注入)
//   残 SPEC_CHECK: 会員取得のコマンド名 / Update/cardinfo の詳細パラメータ /
//   Delete/account の accountBasicParam 省略時挙動 / 3DS2.0 の必須フィールド
//   → テスト利用情報通知書の取得後、検証環境 (/test-paynow + dummyRequest:"1") で実機確認
import { vtCall, type VtResult } from "./client";
import { loadVeritransConfig, VT_TXN_VERSION, type VeritransConfig } from "./config";

// API パス。決済系 (base: payment = {test-}paynow/v2) と
// 会員管理系 (base: member = {test-}paynowid/v1 / {コマンド}/{サービスタイプ} 形式)
export const PAYNOWID_PATHS = {
  /** カード与信 (会員登録・カード登録・都度決済いずれもここ) — 公式確認済み */
  authorize: "/Authorize/card",
  /** 3Dセキュア認可 — §4 で確定 */
  mpi: "/Authorize/mpi",
  /** 登録カードの更新 (会員管理系) — サービスタイプ cardinfo (公式確認済みのコマンド体系) */
  cardUpdate: "/Update/cardinfo",
  /** 登録カードの削除 (会員管理系) */
  cardDelete: "/Delete/cardinfo",
  /** 会員(アカウント)の削除 — 解約時 (§6-7)。公式リクエスト例で確認済み */
  accountDelete: "/Delete/account",
  /** 会員情報の取得 SPEC_CHECK: コマンド名 (Get/Search 等) 未確認 */
  accountGet: "/Get/account",
} as const;

function baseParams(c: VeritransConfig): Record<string, any> {
  return { txnVersion: VT_TXN_VERSION, dummyRequest: c.dummyRequest };
}

// --- 初回: 会員登録 + カード登録 + 初回課金 (与信+売上) を同時実行 ---------------
// §1.1-5 / §6 step 3。ブラウザで /4gtoken 化したトークンと自社採番の accountId を使う。
// 公式仕様: 未登録の accountId を accountParam に指定すると会員+カードが自動登録される。
// トークンは payNowIdParam.token (ワンタイム・15分有効)。
export type RegisterAndChargeInput = {
  accountId: string;
  orderId: string;
  amount: number;
  token: string;
  /** 旧実装互換のため残置。/4gtoken レスポンスに token_key は無く、送信もしない */
  tokenKey?: string;
  freeKey?: string;
  /** true(既定)=与信+売上 (課金確定)。false=与信のみ (会員+カード登録だけ行い課金しない)。
   *  無料期間の申込時は capture=false で「会員登録+カード登録のみ」に使う (§無料期間)。 */
  capture?: boolean;
};

export async function registerAndCharge(input: RegisterAndChargeInput, cfg?: VeritransConfig): Promise<VtResult> {
  const c = cfg ?? (await loadVeritransConfig());
  const payNowIdParam: Record<string, any> = {
    token: input.token,
    accountParam: { accountId: input.accountId },
  };
  // freeKey は VeriTrans では半角英数字。CRM の customerId は UUID (ハイフン付き) のため
  // ハイフンを除去して英数字32桁に整える (UUID → 32 hex で一意性は保たれる)
  if (input.freeKey) {
    const fk = input.freeKey.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    if (fk) payNowIdParam.freeKey = fk;
  }
  const params: Record<string, any> = {
    ...baseParams(c),
    orderId: input.orderId,
    amount: String(input.amount),
    // capture=false は与信のみ (売上確定しない)。無料期間の申込時に会員+カード登録だけ行う用途。
    withCapture: String(input.capture ?? true),
    jpo: "10",                       // 一括 (公式確認済み。分割等は加盟店契約に応じ §10 で調整)
    payNowIdParam,
  };
  return vtCall(PAYNOWID_PATHS.authorize, params, c);
}

// --- 毎月: 会員ID指定の都度決済 (§5-② 確定方式) --------------------------------
// 保存済み「標準カード」に課金する (公式確認済み: token 不要・cardId 指定も不要)。
export type ChargeByAccountInput = {
  accountId: string;
  orderId: string;                   // `${accountId}_${YYYYMM}` 等で決定的に採番 (§5-②)
  amount: number;
  freeKey?: string;
};

export async function chargeByAccount(input: ChargeByAccountInput, cfg?: VeritransConfig): Promise<VtResult> {
  const c = cfg ?? (await loadVeritransConfig());
  const payNowIdParam: Record<string, any> = {
    accountParam: { accountId: input.accountId },
  };
  // freeKey は VeriTrans では半角英数字。CRM の customerId は UUID (ハイフン付き) のため
  // ハイフンを除去して英数字32桁に整える (UUID → 32 hex で一意性は保たれる)
  if (input.freeKey) {
    const fk = input.freeKey.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    if (fk) payNowIdParam.freeKey = fk;
  }
  const params: Record<string, any> = {
    ...baseParams(c),
    orderId: input.orderId,
    amount: String(input.amount),
    withCapture: "true",
    jpo: "10",
    payNowIdParam,
  };
  return vtCall(PAYNOWID_PATHS.authorize, params, c);
}

// --- カード更新 (期限切れ時の再登録 §5 / §6-7) ---------------------------------
// 洗替サービス無し (§0) のため、顧客に再入力してもらった新トークンで登録カードを差し替える。
// 会員管理系 API (paynowid/v1)。Add/Update 時は2円与信の有効性確認が走る (公式確認済み)。
export type UpdateCardInput = {
  accountId: string;
  token: string;
  /** 旧実装互換のため残置 (送信しない) */
  tokenKey?: string;
};

export async function updateCardByToken(input: UpdateCardInput, cfg?: VeritransConfig): Promise<VtResult> {
  const c = cfg ?? (await loadVeritransConfig());
  const params: Record<string, any> = {
    ...baseParams(c),
    payNowIdParam: {
      accountParam: {
        accountId: input.accountId,
        // SPEC_CHECK: Update/cardinfo の詳細 (token でのカード差し替え指定・
        // defaultCard フラグ名) は IF01 PayNowID PDF で最終確認すること
        cardParam: {
          token: input.token,
          defaultCard: "1",
        },
      },
    },
  };
  return vtCall(PAYNOWID_PATHS.cardUpdate, params, c, "member");
}

// --- 解約: 会員データの削除 (§6-7) ---------------------------------------------
// 公式リクエスト例 (Delete/account): payNowIdParam.accountParam に accountId と
// accountBasicParam { deleteDate, forceDeleteDate, deleteCardInfo } を指定。
// deleteCardInfo:"1" で登録カードも同時削除。deleteDate 省略で即時削除の想定
// (SPEC_CHECK: 省略時挙動は検証環境で確認)。
export async function deleteAccount(accountId: string, cfg?: VeritransConfig): Promise<VtResult> {
  const c = cfg ?? (await loadVeritransConfig());
  const params: Record<string, any> = {
    ...baseParams(c),
    payNowIdParam: {
      accountParam: {
        accountId,
        accountBasicParam: { deleteCardInfo: "1" },
      },
    },
  };
  return vtCall(PAYNOWID_PATHS.accountDelete, params, c, "member");
}

// --- 3Dセキュア 2.0 (§6-4) ------------------------------------------------------
// /Authorize/mpi → レスポンスの authStartUrl / resResponseContents(HTML) で
// チャレンジ画面へ遷移 → 結果は pushUrl へ通知 (§4)。
// ⚠️ 2025年4月以降 3DS2.0 必須 (§2)。本番接続前に必ずこのフローを有効化・検証する。
//    ここでは開始呼び出しのみ実装。SPEC_CHECK: 3DS2.0 の必須フィールド
//    (serviceOptionType / accountInfo / browserInfo 等) は 3DS 開発ガイドとの照合必須。
export type MpiAuthorizeInput = {
  orderId: string;
  amount: number;
  token: string;
  tokenKey?: string;
  accountId?: string;                // 会員登録も同時に行う場合
  /** 3DS 結果の受信先 (自社 pushUrl)。安定して即応答すること (§8)。https 必須 */
  pushUrl: string;
  /** チャレンジ完了後に購入者を戻すURL (公式確認済みフィールド)。https 必須 */
  redirectionUri: string;
  /** MPI サービスの動作区分 (公式確認済み: "mpi-complete"/"mpi-company"/"mpi-merchant"/"mpi-none")。
   *  SPEC_CHECK: 既定値と決済確定までの分担は 3DS 開発ガイドで確認 */
  serviceOptionType?: string;
  httpAccept?: string;
  httpUserAgent?: string;
};

export type MpiStartResult = VtResult & {
  /** チャレンジ画面へ遷移させる URL (レスポンス由来 §4) */
  authStartUrl?: string;
  /** もしくはそのまま返す HTML (レスポンス由来 §4) */
  resResponseContents?: string;
};

export async function authorizeMpi(input: MpiAuthorizeInput, cfg?: VeritransConfig): Promise<MpiStartResult> {
  const c = cfg ?? (await loadVeritransConfig());
  const payNowIdParam: Record<string, any> = { token: input.token };
  if (input.accountId) payNowIdParam.accountParam = { accountId: input.accountId };
  const params: Record<string, any> = {
    ...baseParams(c),
    orderId: input.orderId,
    amount: String(input.amount),
    // フィールド名 (serviceOptionType/pushUrl/redirectionUri/httpAccept/httpUserAgent) は
    // 公式ドキュメントで存在確認済み。SPEC_CHECK: 必須集合と accountInfo 等の
    // 追加フィールドは 3DS2.0 開発ガイド別冊 (ex_3DS2) で照合すること。
    serviceOptionType: input.serviceOptionType ?? process.env.VT_3DS_SERVICE_OPTION ?? "mpi-complete",
    pushUrl: input.pushUrl,
    redirectionUri: input.redirectionUri,
    payNowIdParam,
  };
  if (input.httpAccept) params.httpAccept = input.httpAccept;
  if (input.httpUserAgent) params.httpUserAgent = input.httpUserAgent;

  const res = await vtCall(PAYNOWID_PATHS.mpi, params, c);
  const r = res.raw?.result ?? {};
  return {
    ...res,
    authStartUrl: r.authStartUrl ?? undefined,
    resResponseContents: r.resResponseContents ?? undefined,
  };
}
