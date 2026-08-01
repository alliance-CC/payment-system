import "server-only";
import { createSupabaseService } from "@/shared/db/service";

// 3DS疎通テスト専用の一時保存 (検証用)。既存 integrations テーブルに provider 名で退避し、
// 認証完了後に /3ds-return で内容を確認できるようにする。マイグレーション不要。
// ※ カード番号等は含まれない(VeriTransの通知にはPANは無い)。本流の課金処理とは無関係。
const TENANT = process.env.PAYMENTS_DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001";

export type ThreeDSDebug = { raw: string; contentType: string | null; at: string };

export async function save3dsDebug(kind: "push" | "return", raw: string, contentType?: string | null): Promise<void> {
  try {
    const svc = createSupabaseService();
    const provider = `_3ds_debug_${kind}`;
    const config: ThreeDSDebug = { raw: (raw ?? "").slice(0, 8000), contentType: contentType ?? null, at: new Date().toISOString() };
    const { data: existing } = await svc
      .from("integrations").select("id").eq("provider", provider).eq("tenant_id", TENANT).limit(1).maybeSingle();
    if (existing?.id) {
      await svc.from("integrations").update({ config, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await svc.from("integrations").insert({ provider, label: "3ds-debug", tenant_id: TENANT, config });
    }
  } catch { /* デバッグ用途。失敗しても本流に影響なし */ }
}

export async function read3dsDebug(kind: "push" | "return"): Promise<ThreeDSDebug | null> {
  try {
    const svc = createSupabaseService();
    const { data } = await svc
      .from("integrations").select("config").eq("provider", `_3ds_debug_${kind}`).eq("tenant_id", TENANT).limit(1).maybeSingle();
    return ((data?.config as ThreeDSDebug) ?? null) || null;
  } catch { return null; }
}
