/**
 * 日次課金 Cron が動いているかの判定 (管理ボードの警告表示用)。
 *
 * 503 も通知メールも「Cron が起動した」ことが前提なので、Vercel 側の設定ミスや
 * プラン変更で Cron が止まった場合は何も鳴らない。最後に成功した時刻を記録しておき、
 * 一定時間更新されていなければ管理画面で知らせる — これが最後の砦。
 *
 * React に依存しない純関数にしてあるのは、この規則だけをテストで固定するため。
 */
export type CronHealth =
  | { state: "never" }                    // まだ一度も成功記録が無い (導入直後)
  | { state: "ok"; hoursAgo: number }
  | { state: "stale"; hoursAgo: number }; // 動いていない可能性が高い

/** 猶予込みのしきい値。日次 (24h) に対し実行時刻のぶれを見込んで 26 時間。 */
export const CRON_STALE_HOURS = 26;

export function cronHealth(
  lastRunIso: string | null | undefined,
  now: Date = new Date(),
): CronHealth {
  const raw = String(lastRunIso ?? "").trim();
  if (!raw) return { state: "never" };
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return { state: "never" };

  // 未来の時刻 (時計ずれ) は 0 時間前として扱う — 誤って「停止中」と出さない
  const hoursAgo = Math.max(0, (now.getTime() - t) / 3_600_000);
  return hoursAgo > CRON_STALE_HOURS
    ? { state: "stale", hoursAgo }
    : { state: "ok", hoursAgo };
}

/** 「3時間前」「2日前」のような表示用の文字列 */
export function describeAgo(hoursAgo: number): string {
  if (hoursAgo < 1) return "1時間以内";
  if (hoursAgo < 24) return `約${Math.floor(hoursAgo)}時間前`;
  return `約${Math.floor(hoursAgo / 24)}日前`;
}
