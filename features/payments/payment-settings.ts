import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import type { Plan } from "./plans";

// 管理画面(/admin/settings)で編集する課金設定。integrations テーブルの
// provider='payment_settings' の1行(config jsonb)に保存する(専用テーブル不要)。
// カード等の決済個人情報は一切保存しない (§7)。
export type PaymentSettings = {
  plans: Plan[];                         // プラン(ID・名称・月額・周期)
  freeMonths: number;                    // 無料期間(申込月含むヶ月数)
  chargeDay: number;                     // 毎月の課金日(1〜28)

  retryIntervalsDays: number[];          // 失敗リトライ間隔(日)
  retryMax: number;                      // リトライ上限
  cardExpiredCodes: string[];            // カード期限切れ判定コード(プレフィックス)
  cronBatchLimit: number;                // 1回のCronの最大処理数
  notifyEmail: string | null;            // 申込通知先メール(自社宛)
  termsVersion: string;                  // 規約バージョン
  cancelPolicy: "end_of_month" | "immediate"; // 解約: 当月末まで利用可(翌月停止) / 即時停止
  // 利用者への登録完了メール(件名/本文)。プレースホルダ {name}{accountId}{planName}{amount}{serviceStartDate}{chargeStartDate}
  welcomeEmail?: { subject: string; body: string };
};

const PROVIDER = "payment_settings";

// 登録完了メールの既定テンプレート (管理画面で上書き可)。プレースホルダは
// {name}{accountId}{planName}{amount}{serviceStartDate}{chargeStartDate}。
export const DEFAULT_WELCOME_SUBJECT =
  "【{planName}】お申し込みありがとうございます (会員ID: {accountId})";
export const DEFAULT_WELCOME_BODY = [
  "{name} 様",
  "",
  "この度は「{planName}」にお申し込みいただき、誠にありがとうございます。",
  "お申し込みが完了しました。",
  "",
  "■ 会員ID: {accountId}",
  "■ プラン: {planName}（月額 {amount} 円 / 税込）",
  "■ 利用開始日: {serviceStartDate}",
  "■ 課金開始日: {chargeStartDate}（それまでは無料期間です）",
  "",
  "会員IDはお問い合わせの際に必要です。大切に保管ください。",
  "",
  "――――――――――――――",
  "本メールにお心当たりのない場合は破棄してください。",
].join("\n");

// integrations.tenant_id は NOT NULL (0036)。既定テナントに固定して読み書きする。
const DEFAULT_TENANT_ID = process.env.PAYMENTS_DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";

function dbReady(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** 保存済みの設定(部分)を読む。未設定/DB不通なら {} (呼び出し側が env/既定へフォールバック)。 */
export async function loadPaymentSettings(): Promise<Partial<PaymentSettings>> {
  if (!dbReady()) return {};
  try {
    const svc = createSupabaseService();
    const { data } = await svc
      .from("integrations")
      .select("config")
      .eq("provider", PROVIDER)
      .eq("tenant_id", DEFAULT_TENANT_ID)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    return ((data?.config as Partial<PaymentSettings>) ?? {}) || {};
  } catch {
    return {}; // 設定が読めなくても申込/課金は env/既定で継続する(可用性優先)
  }
}

/** 設定を保存(単一行 upsert)。管理画面の保存アクションから呼ぶ。 */
export async function savePaymentSettings(cfg: PaymentSettings): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL が未設定です" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定です (Vercel の環境変数に追加してください)" };
  try {
    const svc = createSupabaseService();
    const { data: existing, error: selErr } = await svc
      .from("integrations").select("id")
      .eq("provider", PROVIDER).eq("tenant_id", DEFAULT_TENANT_ID)
      .limit(1).maybeSingle();
    if (selErr) return { ok: false, error: `read: ${selErr.message}` };
    if (existing?.id) {
      const { error } = await svc.from("integrations")
        .update({ config: cfg, is_active: true, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await svc.from("integrations")
        .insert({ provider: PROVIDER, label: "default", tenant_id: DEFAULT_TENANT_ID, config: cfg });
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
