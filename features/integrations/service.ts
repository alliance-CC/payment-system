// 外部連携の設定取得ヘルパー。
// DB (integrations テーブル) の値を正とし、未登録時のみ env をフォールバックに使う。
import { createSupabaseService } from "@/shared/db/server";
import { isDemo } from "@/shared/demo/data";
import type { Provider } from "./providers";

export type Integration = {
  provider: Provider;
  config: Record<string, any>;
  secret: Record<string, any>;
  source: "db" | "env" | "none";
};

const ENV_FALLBACK: Partial<Record<Provider, () => { config: any; secret: any }>> = {
  bluebean: () => ({
    config: { base_url: process.env.BLUEBEAN_API_BASE ?? "" },
    secret: {
      token: process.env.BLUEBEAN_API_TOKEN ?? "",
      webhook_secret: process.env.BLUEBEAN_WEBHOOK_SECRET ?? "",
    },
  }),
  twilio: () => ({
    config: { from_number: process.env.TWILIO_FROM_NUMBER ?? "" },
    secret: {
      account_sid: process.env.TWILIO_ACCOUNT_SID ?? "",
      auth_token:  process.env.TWILIO_AUTH_TOKEN  ?? "",
    },
  }),
  google_sheets: () => ({
    config: { spreadsheet_id: process.env.GOOGLE_SHEETS_TARGET_SPREADSHEET_ID ?? "" },
    secret: {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "",
      private_key:  process.env.GOOGLE_SHEETS_PRIVATE_KEY  ?? "",
    },
  }),
  veritrans: () => ({
    config: {
      production: process.env.VT_PRODUCTION ?? "false",   // "true" で本番 /paynow
      token_api_key: process.env.VT_TOKEN_API_KEY ?? "",  // ブラウザ /4gtoken 用(公開可)
    },
    secret: {
      merchant_ccid: process.env.VT_MERCHANT_CCID ?? "",
      merchant_key:  process.env.VT_MERCHANT_KEY  ?? "",  // authHash 用秘密鍵(サーバーのみ)
    },
  }),
  llm:    () => ({ config: { model: process.env.LLM_MODEL ?? "" }, secret: { api_key: process.env.LLM_API_KEY ?? "" } }),
  smtp:   () => ({
    config: { host: process.env.SMTP_HOST ?? "", port: process.env.SMTP_PORT ?? "587", from: process.env.SMTP_FROM ?? "" },
    secret: { user: process.env.SMTP_USER ?? "", pass: process.env.SMTP_PASS ?? "" },
  }),
};

// テナント別の連携設定を解決する。
//   1. DB (integrations) の自テナント行 — tenantId 必須。他テナントの行は参照しない
//   2. env フォールバック — デプロイ全体のシステム既定 (単一テナント運用の互換)
// tenantId が渡されない文脈 (テナント不明の webhook 等) では DB を見ずに
// env のみ参照する。クロステナントでのキー流用を構造的に防ぐため。
export async function getIntegration(
  provider: Provider,
  opts?: { tenantId?: string | null; label?: string },
): Promise<Integration> {
  const tenantId = opts?.tenantId ?? null;
  if (!isDemo() && tenantId) {
    const sb = createSupabaseService();
    let q: any = sb.from("integrations")
      .select("config, secret, is_active")
      .eq("provider", provider)
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    if (opts?.label) q = q.eq("label", opts.label);
    // ⚠️ DB エラー (statement timeout・接続断・RLS 一時失敗) を env フォールバックで
    // 握りつぶすと、自テナントの設定があるのにデプロイ既定 (別テナント/別加盟店) の
    // 資格情報を使ってしまう。決済 (veritrans) では顧客カードが別加盟店口座に課金され
    // 資金が誤経路化する致命的事故になるため、エラー時は絶対にフォールバックせず throw する。
    // 「行が無い (data=null・error=null)」だけが env フォールバックの正規経路
    // (= 既定テナント / 未設定テナント)。
    const { data, error } = await q.maybeSingle();
    if (error) {
      throw new Error(`getIntegration(${provider}) tenant lookup failed: ${error.message ?? error}`);
    }
    if (data) {
      return { provider, config: data.config ?? {}, secret: data.secret ?? {}, source: "db" };
    }
  }
  const fb = ENV_FALLBACK[provider]?.();
  if (fb && (Object.values(fb.config).some(Boolean) || Object.values(fb.secret).some(Boolean))) {
    return { provider, config: fb.config, secret: fb.secret, source: "env" };
  }
  return { provider, config: {}, secret: {}, source: "none" };
}

// タイミング攻撃に強い文字列比較(Webhook 検証用)
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 秘匿フィールドのマスキング表示
export function maskSecret(value: any): string {
  if (value == null || value === "") return "";
  const s = String(value);
  if (s.length <= 6) return "•".repeat(s.length);
  return s.slice(0, 2) + "•".repeat(Math.min(s.length - 4, 12)) + s.slice(-2);
}
