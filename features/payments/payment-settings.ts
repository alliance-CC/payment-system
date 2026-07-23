import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import type { Plan } from "./plans";

// 管理画面(/admin/settings)で編集する課金設定。integrations テーブルの
// provider='payment_settings' の1行(config jsonb)に保存する(専用テーブル不要)。
// カード等の決済個人情報は一切保存しない (§7)。
export type PaymentSettings = {
  plans: Plan[];                         // プラン(ID・名称・月額・周期)
  freeMonths: number;                    // 無料期間(申込月含むヶ月数)
  retryIntervalsDays: number[];          // 失敗リトライ間隔(日)
  retryMax: number;                      // リトライ上限
  cardExpiredCodes: string[];            // カード期限切れ判定コード(プレフィックス)
  cronBatchLimit: number;                // 1回のCronの最大処理数
  notifyEmail: string | null;            // 申込通知先メール
  termsVersion: string;                  // 規約バージョン
  cancelPolicy: "end_of_month" | "immediate"; // 解約: 当月末まで利用可(翌月停止) / 即時停止
};

const PROVIDER = "payment_settings";

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
  if (!dbReady()) return { ok: false, error: "supabase-not-configured" };
  try {
    const svc = createSupabaseService();
    const { data: existing } = await svc
      .from("integrations").select("id").eq("provider", PROVIDER).limit(1).maybeSingle();
    if (existing?.id) {
      const { error } = await svc.from("integrations")
        .update({ config: cfg, is_active: true, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await svc.from("integrations")
        .insert({ provider: PROVIDER, label: "default", config: cfg });
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
