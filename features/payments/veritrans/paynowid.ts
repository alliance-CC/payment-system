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
  /** 本人認証結果確認 (3DS ガイド 4.4.2 MpiGetResult)。
   *  SPEC_CHECK: REST パスは MDK コマンド名 {サービス}{コマンド} → /{コマンド}/{サービス} の
   *  命名則 (MpiAuthorize→/Authorize/mpi 公式確認済み) からの導出。検証環境で実機確認する */
  mpiGetResult: "/GetResult/mpi",
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
// /Authorize/mpi → レスポンスの authStartUrl (302リダイレクト) か resResponseContents
// (そのままブラウザへ返すHTML) で ACS 認証画面へ遷移 → 結果は redirectionUri (ブラウザ復帰)
// と pushUrl (結果通知PUSH) の両方で受信する (非同期・順不同。ガイド 3-2 / 4-4)。
//
// 2026-08 3DS2.0 開発ガイド (ex_3DS2 v1.0.21) 照合済み — MpiAuthorizeRequestDto:
//   必須○ : serviceOptionType / orderId / amount / redirectionUri / deviceChannel("02")
//   必須○ : token またはカード情報 (当アプリはトークンのみ §2)
//   ブランドルール必須 (2024-08〜。未設定でもVTはエラーにしないが必ず送ること・注1〜3):
//     cardholderName / (cardholderEmail または電話番号) / customerIp
//   任意△ : withCapture(既定"false"=与信のみ) / pushUrl / verifyResultLink /
//            verifyTimeout / httpUserAgent (未指定はVT側で画面から取得)
//   ※ deviceChannel 未設定だと authStartUrl が返らない (3DS2.0 リクエストにならない)。
export type MpiAuthorizeInput = {
  orderId: string;
  amount: number;
  token: string;
  tokenKey?: string;
  accountId?: string;                // 会員登録も同時に行う場合 (ワンクリック継続課金併用)
  /** 3DS 結果の受信先 (自社 pushUrl)。安定して即応答すること (§8)。https 必須 */
  pushUrl: string;
  /** チャレンジ完了後に購入者を戻すURL。https 必須 (mpi-none 時は SSL 必須と明記) */
  redirectionUri: string;
  /** MPI サービスの動作区分。既定は補足資料§1 の推奨に基づき通常認証 mpi-company
   *  (Y/A で与信・カード会社リスク負担)。アクワイアラ要請があれば mpi-complete に切替 */
  serviceOptionType?: string;
  /** カード保有者名 (ブランドルール必須・半角2〜45桁)。トークン取得時に設定済みなら省略可 */
  cardholderName?: string;
  /** カード保有者メール (RFC5322)。email か電話のどちらかが必須 (注2) */
  cardholderEmail?: string;
  /** 消費者IPアドレス (ブランドルール必須・注3)。MAP の自動収集ON時は省略可 */
  customerIp?: string;
  /** true=与信+売上 / false=与信のみ。省略時は VT 既定の "false" (与信のみ) */
  withCapture?: boolean;
  /** 本人認証タイムアウト (分・1〜999)。ECサイトのセッションより数分短く (ガイド推奨) */
  verifyTimeoutMin?: number;
  httpAccept?: string;
  httpUserAgent?: string;
};

export type MpiStartResult = VtResult & {
  /** ACS 認証画面へ 302 遷移させる URL (認可応答から3分有効・ガイド 4.3.1) */
  authStartUrl?: string;
  /** もしくは加工せずそのままブラウザへ返す HTML (編集厳禁・ガイド 4.3.1) */
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
    serviceOptionType: input.serviceOptionType ?? process.env.VT_3DS_SERVICE_OPTION ?? "mpi-company",
    redirectionUri: input.redirectionUri,
    pushUrl: input.pushUrl,
    // ブラウザ復帰時にも mpiMstatus/vResultCode/vAuthInfo 等の詳細を受け取る (4.4.1 の "1"=POST連携)
    verifyResultLink: "1",
    // 3DS2.0 の必須値。"02"=ブラウザベース。未設定だと authStartUrl が返らない (ガイド明記)
    deviceChannel: "02",
    jpo: "10",                       // 一括 (未指定でも"10"適用だが registerAndCharge と揃えて明示)
    payNowIdParam,
  };
  if (input.withCapture !== undefined) params.withCapture = String(input.withCapture);
  if (input.verifyTimeoutMin) params.verifyTimeout = String(input.verifyTimeoutMin);
  // ブランドルール必須項目 (注1〜3)。VT はエラーにしないが認証判定に使われるため必ず設定する。
  // 値はスペースのみ等の不備を避けるため trim して空なら送らない (ガイド 4.2.2)。
  const holder = input.cardholderName?.trim();
  if (holder) params.cardholderName = holder.slice(0, 45);
  const email = input.cardholderEmail?.trim();
  if (email) params.cardholderEmail = email.slice(0, 254);
  const ip = input.customerIp?.trim();
  if (ip) params.customerIp = ip.slice(0, 45);
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

// --- 3DS 結果確認 (ガイド 4.4.2 MpiGetResult) -----------------------------------
// orderId 指定で本人認証とカード決済の結果を取得する。authHash 署名付きの
// サーバー間通信のため応答は信頼できる — 結果通知(PUSH)には改ざんチェック値が無く
// (ガイド 4-5: orderIdNNNN 連番形式・vAuthInfo なし)、ブラウザ復帰も偽装可能なので、
// 契約の有効化はどの経路で気づいた場合も必ずこの照会結果で確定させる。
export type MpiResultDetail = VtResult & {
  /** 本要求(照会コマンド)自体ではなく「本人認証」の結果 (success/failure) */
  mpiMstatus?: string;
  /** 本人認証の詳細結果コード (G011…=成功 / GExx=失敗。補足資料 4-3) */
  mpiVresultCode?: string;
  /** カード決済の結果 (success/failure/pending。mpi 失敗時と mpi-none では空) */
  cardMstatus?: string;
  /** "AuthorizeConfirm"=フリクションレス / "VerifyNotify"=チャレンジ */
  txnType?: string;
};

export async function getMpiResult(orderId: string, cfg?: VeritransConfig): Promise<MpiResultDetail> {
  const c = cfg ?? (await loadVeritransConfig());
  const params: Record<string, any> = { ...baseParams(c), orderId };
  const res = await vtCall(PAYNOWID_PATHS.mpiGetResult, params, c);
  const r = res.raw?.result ?? {};
  // 注意 (4.4.2): 応答トップの mstatus/vResultCode は「照会コマンド自体」の成否
  // (成功=G021…)。決済の成否は mpiMstatus / cardMstatus 側で判定すること。
  return {
    ...res,
    mpiMstatus: r.mpiMstatus ?? undefined,
    mpiVresultCode: r.mpiVresultCode ?? undefined,
    cardMstatus: r.cardMstatus ?? undefined,
    txnType: r.txnType ?? undefined,
  };
}
