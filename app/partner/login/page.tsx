import { Lock } from "lucide-react";
import { partnerLoginAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "ご契約者情報ダッシュボード",
  // 外部公開URLのため検索エンジンには載せない
  robots: { index: false, follow: false },
};

export default function PartnerLoginPage({ searchParams }: { searchParams: { e?: string } }) {
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-bold text-navy">ご契約者情報ダッシュボード</h1>
          <p className="text-xs text-muted">ご提供先さま専用ページ</p>
        </header>

        <form action={partnerLoginAction} className="card p-6 space-y-4">
          {searchParams.e === "1" && <p className="text-sm text-bad">パスワードが違います。</p>}
          {/* 未設定のときは入力ミスと切り分けられるようにする
              (パスワード自体の手掛かりにはならないため公開画面に出してよい) */}
          {searchParams.e === "2" && (
            <p className="text-sm text-bad">
              ただいまご利用いただけません。担当者までお問い合わせください。
            </p>
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

        <p className="text-[11px] text-muted text-center">
          パスワードが分からない場合は、担当者までお問い合わせください。
        </p>
      </div>
    </main>
  );
}
