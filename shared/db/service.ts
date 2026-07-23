// SERVER ONLY — Supabase service_role クライアント。
// このファイルは "server-only" でクライアントバンドルへの混入を防ぐ。
// Webhook や管理ジョブ(RLS をバイパスしたい操作)からのみ使用すること。
import "server-only";

export function createSupabaseService() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
