// 公開申込ページのテナント解決 (§1.2 OEM)。
// ?tenant=<slug> を tenants.id に解決する。無指定・不明時は null (= 既定テナント扱い)。
import "server-only";
import { createSupabaseService } from "@/shared/db/service";

export async function resolveTenantIdBySlug(slug?: string | null): Promise<string | null> {
  if (!slug) return null;
  try {
    const service = createSupabaseService();
    const { data } = await service.from("tenants").select("id").eq("slug", slug).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}
