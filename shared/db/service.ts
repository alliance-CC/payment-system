// SERVER ONLY — Supabase service_role クライアント。
// このファイルは "server-only" でクライアントバンドルへの混入を防ぐ。
// Webhook や管理ジョブ(RLS をバイパスしたい操作)からのみ使用すること。
import "server-only";

/**
 * ⚠️ DB読み取りを Next.js のデータキャッシュに載せない。
 *
 * supabase-js はグローバルの fetch を使う。Next.js はその fetch を差し替えていて、
 * 同じURLのGETを既定でキャッシュする。その結果:
 *   ・DBが落ちていても「前回の結果」が返る (エラーにならない)
 *   ・日次課金が古い契約一覧で動き、その間に課金日を迎えた契約を取りこぼす
 * どちらも実際に検証環境で再現した (Cronが DB 不通のまま「0件・正常」を返した)。
 *
 * 決済・管理の読み書きは常に最新でなければならないので、毎回 no-store で投げる。
 */
function noStoreFetch(input: any, init?: any) {
  return fetch(input, { ...(init ?? {}), cache: "no-store" });
}

export function createSupabaseService() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: noStoreFetch },
    }
  );
}
