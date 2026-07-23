import { Lock } from "lucide-react";
import { loginAction } from "../actions";
import { adminConfigured } from "@/features/admin/auth";

export const metadata = { title: "管理ログイン | Memoreal Payments" };

export default function AdminLoginPage({ searchParams }: { searchParams: { e?: string } }) {
  const configured = adminConfigured();
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-bold text-navy">登録者管理ボード</h1>
          <p className="text-xs text-muted">継続課金の登録者管理 (管理者のみ)</p>
        </header>

        {!configured ? (
          <div className="card p-5 text-sm text-bad">
            <p className="font-medium">未セットアップ</p>
            <p className="text-muted mt-1">
              環境変数 <span className="font-mono">ADMIN_PASSWORD</span> を設定してください。
            </p>
          </div>
        ) : (
          <form action={loginAction} className="card p-6 space-y-4">
            {searchParams.e && (
              <p className="text-sm text-bad">パスワードが違います。</p>
            )}
            <div>
              <div className="label mb-1">パスワード</div>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                className="input w-full"
                placeholder="••••••••"
                required
                autoFocus
              />
            </div>
            <button className="btn btn-primary w-full flex items-center justify-center gap-2">
              <Lock size={15} />ログイン
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
