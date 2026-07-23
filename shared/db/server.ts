// サーバー用 Supabase クライアント(ユーザーCookie を引き継ぎ RLS 経由でアクセス)。
//
// service_role クライアントは ./service.ts に分離(server-only バリア)。
// 旧 API 互換のため createSupabaseService をここから再 export する。
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createSupabaseServer() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return store.get(name)?.value; },
        set(name: string, value: string, options: CookieOptions) {
          try { store.set({ name, value, ...options }); } catch {}
        },
        remove(name: string, options: CookieOptions) {
          try { store.set({ name, value: "", ...options }); } catch {}
        },
      },
    }
  );
}

export { createSupabaseService } from "./service";
