import { loadVeritransConfig, toPublicConfig } from "@/features/payments/veritrans/config";
import { loadPlans } from "@/features/payments/plans";
import { loadBillingPolicy } from "@/features/payments/billing-config";
import { resolveTenantIdBySlug } from "@/features/payments/tenant";
import SignupFlow from "./SignupFlow";

export const metadata = { title: "お申し込み" };

// 継続課金 申込ページ (公開・オープン申込 §0)。LP の「申し込む」ボタンの遷移先 (§1.2)。
//   短縮フロー: (プラン=LP確定) → お客様情報(氏名・カナ・電話・メール・利用開始日・規約同意) → カード入力 → 完了
//   URL パラメータ:
//     ?case=<案件ID>   … 申込リンクに案件IDを埋めて照合精度を上げる (§5)
//     ?tenant=<slug>   … OEM 先テナントの申込 (§1.2)。無指定は既定テナント
export default async function SubscribePage({
  searchParams,
}: {
  searchParams: { case?: string; tenant?: string; plan?: string };
}) {
  const tenantId = await resolveTenantIdBySlug(searchParams.tenant);
  const cfg = await loadVeritransConfig(tenantId);   // OEM: テナント別の token_api_key (§1.2)
  const pub = toPublicConfig(cfg);
  const plans = (await loadPlans()).map((p) => ({ id: p.id, name: p.name, amount: p.amount }));
  const policy = await loadBillingPolicy();
  // LP でプランを選んで来た場合は見出しを「お手続き」に (プラン選択を促す文言を出さない)
  const planPreselected = !!(searchParams.plan && plans.some((p) => p.id === searchParams.plan));

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-navy">お申し込み</h1>
          <p className="text-sm text-muted mt-1">
            {planPreselected ? "以下の内容でお手続きください" : "プランを選んでお手続きください"}
          </p>
          {!cfg.production && (
            <p className="text-[11px] text-warn mt-1">検証環境 (実際の請求は発生しません)</p>
          )}
        </header>

        <SignupFlow
          plans={plans}
          tokenApiKey={pub.tokenApiKey}
          tokenUrl={pub.tokenUrl}
          configured={pub.configured}
          termsVersion={policy.termsVersion}
          caseId={searchParams.case}
          tenantSlug={searchParams.tenant}
          initialPlanId={searchParams.plan}
          use3ds={policy.use3ds}
        />
      </div>
    </main>
  );
}
