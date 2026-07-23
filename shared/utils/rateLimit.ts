// 簡易レート制限 (固定ウィンドウ・インスタンス内メモリ)。
//
// ⚠️ サーバーレス環境ではインスタンスごとに独立したカウンタになるため
// 厳密な上限保証は無い (=多インスタンス時は上限が実質×インスタンス数)。
// 公開決済 API の bot/連打対策の一次防壁として使う (§10)。
// 厳密な制限が必要になったら Upstash 等の共有ストアに置き換えること。

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

export function rateLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    // 期限切れバケットの掃除 (肥大化防止。呼び出し頻度は低いので全走査で十分)
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > opts.limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** リクエストからクライアント IP を推定 (Vercel/一般的なプロキシの x-forwarded-for 先頭) */
export function clientIpOf(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
