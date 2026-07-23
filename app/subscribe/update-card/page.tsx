import { loadVeritransConfig, toPublicConfig } from "@/features/payments/veritrans/config";
import { resolveTenantIdBySlug } from "@/features/payments/tenant";
import CardUpdateForm from "./CardUpdateForm";

export const metadata = { title: "カード情報の更新" };

// カード更新ページ (§6-7 / §5「カード期限切れの扱い」)。
// 期限切れ通知メール等から ?account=<会員ID> 付きで誘導する。
export default async function UpdateCardPage({
  searchParams,
}: {
  searchParams: { account?: string; tenant?: string };
}) {
  const tenantId = await resolveTenantIdBySlug(searchParams.tenant);
  const cfg = await loadVeritransConfig(tenantId);   // OEM: テナント別の token_api_key (§1.2)
  const pub = toPublicConfig(cfg);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-navy">カード情報の更新</h1>
          <p className="text-sm text-muted mt-1">
            有効期限切れなどでお支払いができなかった場合に、新しいカードをご登録ください
          </p>
        </header>

        <CardUpdateForm
          tokenApiKey={pub.tokenApiKey}
          tokenUrl={pub.tokenUrl}
          configured={pub.configured}
          initialAccountId={searchParams.account}
        />
      </div>
    </main>
  );
}
