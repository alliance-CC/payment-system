// 3Dセキュア 疎通テストページ (検証用)。課金の本流には一切影響しない独立ページ。
//   検証環境でテストカードを入力→VeriTransの3DS応答を表示し、本実装のフィールドを確定する。
import { loadVeritransConfig, toPublicConfig } from "@/features/payments/veritrans/config";
import ThreeDSTest from "./ThreeDSTest";

export const dynamic = "force-dynamic";
export const metadata = { title: "3Dセキュア 疎通テスト" };

export default async function ThreeDSTestPage() {
  const cfg = await loadVeritransConfig();
  const pub = toPublicConfig(cfg);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <header>
          <h1 className="text-xl font-bold text-navy">3Dセキュア 疎通テスト（検証用）</h1>
          <p className="text-xs text-muted mt-1">
            テストカードで「実行」を押すと<b>本人認証の画面に進みます</b>。認証を完了すると
            <b>結果ページ（3ds-return）</b>に戻るので、そこに表示された内容をそのまま開発者に共有してください。
            課金や契約作成は行いません。検証環境のみ動作します。
          </p>
        </header>
        {cfg.production ? (
          <div className="card p-4 text-sm text-bad">
            本番環境では動作しません。検証環境（VT_PRODUCTION=false）でお試しください。
          </div>
        ) : (
          <ThreeDSTest tokenApiKey={pub.tokenApiKey} tokenUrl={pub.tokenUrl} configured={pub.configured} />
        )}
      </div>
    </main>
  );
}
