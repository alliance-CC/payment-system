// 課金ポリシー設定 (§10 未確定値の置き場)。
// ⚠️ ここの既定値はすべて「仮」。確定したら env / テナント設定で上書きする (§1.2)。
//    ハードコード禁止の方針 (§10) に従い、コード側は常にこのモジュール経由で参照する。

export type BillingPolicy = {
  /** 失敗リトライの間隔 (日)。例 [1,3,7] = 翌日/3日後/7日後 (§5-② 督促)。TODO(§10): 確定値 */
  retryIntervalsDays: number[];
  /** リトライ上限回数。超過で「停止 (suspended)」(§5-②)。TODO(§10): 確定値 */
  retryMax: number;
  /** カード期限切れと判定する vResultCode プレフィックス一覧。
   *  該当時はリトライせずカード更新フローへ (§5-②)。TODO(§10): 決済結果コード一覧で確定 */
  cardExpiredCodePrefixes: string[];
  /** 登録通知メール (§1.1-5: 自社宛) の宛先。TODO(§10): 確定 */
  notifyEmail: string | null;
  /** 同意文言の規約バージョン (§1.1-2)。文言確定時に更新 (§10) */
  termsVersion: string;
  /** 1回の Cron で処理する最大契約数 (大量課金のタイムアウト対策 §5-② 注意)。TODO(§10): バッチ分割/キュー化 */
  cronBatchLimit: number;
  /** 3DS (/Authorize/mpi) を申込フローに組み込むか。仕様書照合とテスト環境確認が済むまで既定 off (§6-4) */
  use3ds: boolean;
  /** 無料期間 (申込月を含むヶ月数)。0 で無料期間なし=申込時に初回課金。
   *  例: 2 → 申込月+翌月は無料、翌々月の1日から課金開始 (§規約 会費 L67「無料期間終了後の翌月から課金」)。 */
  freeMonths: number;
  /** 解約時の停止タイミング。end_of_month=当月末まで利用可(翌月から停止・§規約) / immediate=即時停止。 */
  cancelPolicy: "end_of_month" | "immediate";
};

export function getBillingPolicy(): BillingPolicy {
  const intervals = (process.env.VT_RETRY_INTERVALS_DAYS ?? "1,3,7")
    .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    retryIntervalsDays: intervals.length ? intervals : [1, 3, 7],
    retryMax: Math.max(0, parseInt(process.env.VT_RETRY_MAX ?? "3", 10) || 3),
    cardExpiredCodePrefixes: (process.env.VT_CARD_EXPIRED_CODES ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean),
    notifyEmail: process.env.PAYMENTS_NOTIFY_EMAIL || null,
    termsVersion: process.env.PAYMENTS_TERMS_VERSION || "2026-07-01",
    cronBatchLimit: Math.max(1, parseInt(process.env.VT_CRON_BATCH_LIMIT ?? "200", 10) || 200),
    use3ds: String(process.env.VT_USE_3DS ?? "false").toLowerCase() === "true",
    // 既定 2 ヶ月無料 (申込月含む)。OEM/確定変更は PAYMENTS_FREE_MONTHS で上書き (§1.2/§10)。
    freeMonths: Math.max(0, parseInt(process.env.PAYMENTS_FREE_MONTHS ?? "2", 10) || 0),
    cancelPolicy: process.env.PAYMENTS_CANCEL_POLICY === "immediate" ? "immediate" : "end_of_month",
  };
}

// DB優先版 (管理画面 /admin/settings の保存値 → env → 既定)。実行時はこちらを使う。
export async function loadBillingPolicy(): Promise<BillingPolicy> {
  const base = getBillingPolicy();
  const { loadPaymentSettings } = await import("./payment-settings");
  const s = await loadPaymentSettings();
  return {
    ...base,
    ...(Array.isArray(s.retryIntervalsDays) && s.retryIntervalsDays.length ? { retryIntervalsDays: s.retryIntervalsDays } : {}),
    ...(typeof s.retryMax === "number" ? { retryMax: s.retryMax } : {}),
    ...(Array.isArray(s.cardExpiredCodes) ? { cardExpiredCodePrefixes: s.cardExpiredCodes } : {}),
    ...(s.notifyEmail !== undefined ? { notifyEmail: s.notifyEmail || null } : {}),
    ...(s.termsVersion ? { termsVersion: s.termsVersion } : {}),
    ...(typeof s.cronBatchLimit === "number" ? { cronBatchLimit: s.cronBatchLimit } : {}),
    ...(typeof s.freeMonths === "number" ? { freeMonths: Math.max(0, s.freeMonths) } : {}),
    ...(s.cancelPolicy === "immediate" || s.cancelPolicy === "end_of_month" ? { cancelPolicy: s.cancelPolicy } : {}),
  };
}

// 公開申込の既定テナント (§1.2: 弊社が最初のテナント)。
// OEM 先は申込 URL の ?tenant=<slug> で自テナントに解決する。
export const DEFAULT_TENANT_ID =
  process.env.PAYMENTS_DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";

// ---- JST 日付ヘルパー (§5-②: 課金日判定は日本時間の日次基準) ----

/** 現在の JST の日付 (YYYY-MM-DD) */
export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** date (YYYY-MM-DD) の年月部分 (YYYY-MM) */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** orderId 用の YYYYMM 表記 (§5-② 例: acct123_202608) */
export function yyyymmOf(date: string): string {
  return date.slice(0, 7).replace("-", "");
}

/** 指定日に日数を加算 (YYYY-MM-DD) */
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 対象月の翌月の anchor 日 (YYYY-MM-DD)。月末超えは月末に丸める。
 * 例: anchor=31, 対象月=2026-01 → 2026-02-28
 * TODO(§10): 課金日ポリシー (申込日基準 / 毎月固定日 / 末日扱い) 確定後に見直し
 */
export function nextChargeDateAfter(chargeMonth: string, anchorDay: number): string {
  const [y, m] = chargeMonth.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); // 翌月の末日
  const day = Math.min(Math.max(1, anchorDay), lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 継続課金の orderId を「契約行のスナップショット」から決定的に採番する (§5-②)。
 *   retryN=0 → `{accountId}_{yyyymm}` / retryN>0 → `{accountId}_{yyyymm}_r{retryN}`
 *
 * retryN には契約行の consecutive_failures を渡す。これにより並行 Cron 実行でも
 * 同じ契約スナップショットから同じ orderId が導出され、payment_charges.order_id の
 * UNIQUE 制約で必ず一方だけが課金できる (非アトミックな COUNT に依存しないため
 * 「片方が base 行を insert → 他方の COUNT が +1 → 別 orderId」という二重課金競合を防ぐ)。
 */
export function recurringOrderId(accountId: string, yyyymm: string, retryN: number): string {
  return retryN <= 0 ? `${accountId}_${yyyymm}` : `${accountId}_${yyyymm}_r${retryN}`;
}

/**
 * 無料期間 (freeMonths ヶ月・申込月を含む) 終了後の初回課金日 = 申込月 + freeMonths ヶ月の1日。
 * 例: 申込 2026-05-15, freeMonths=2 → 2026-07-01 (5・6月無料 → 7月課金開始)。
 * 会費対象期間が暦月 (1日〜末日 §規約) のため、初回以降は毎月1日課金 (anchor_day=1) とする。
 */
export function firstChargeDate(signupDate: string, freeMonths: number): string {
  const [y, m] = signupDate.split("-").map(Number);
  const idx = y * 12 + (m - 1) + Math.max(0, freeMonths);
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/**
 * date が属する月の末日 (YYYY-MM-DD)。解約時の「退会手続き当月末日24時まで利用可」
 * (§規約 有効期間 3) の利用可能期限に使う。
 */
export function endOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
