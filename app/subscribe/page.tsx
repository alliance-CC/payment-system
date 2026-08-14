import { loadVeritransConfig, toPublicConfig } from "@/features/payments/veritrans/config";
import { loadPlans, customerPlanName } from "@/features/payments/plans";
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
  searchParams: { case?: string; tenant?: string; plan?: string; v?: string };
}) {
  const tenantId = await resolveTenantIdBySlug(searchParams.tenant);
  const cfg = await loadVeritransConfig(tenantId);   // OEM: テナント別の token_api_key (§1.2)
  const pub = toPublicConfig(cfg);
  const all = await loadPlans();
  const policy = await loadBillingPolicy();

  // まもるん有無の出し分け (顧客には A/B の別を見せない):
  //   ?plan=<id>  … そのプランに固定 (LP のプラン別ボタン)
  //   ?v=a        … まもるん無し(A)のみ表示。「まもるんをご不要な方はこちら」の遷移先
  //   既定        … まもるん有り(B)のみ表示
  const wantA = searchParams.v === "a";
  const selected = searchParams.plan ? all.find((p) => p.id === searchParams.plan) : undefined;
  const visible = selected
    ? [selected]
    : all.filter((p) => (p.variant ?? "B") === (wantA ? "A" : "B"));

  // 表示名は displayName (社内表記の A/B は渡さない)
  const plans = visible.map((p) => ({ id: p.id, name: customerPlanName(p), amount: p.amount }));
  const planPreselected = !!selected;

  // まもるん無しへの導線 (まもるん有りを見ているときだけ出す)
  const keep = new URLSearchParams();
  if (searchParams.case) keep.set("case", searchParams.case);
  if (searchParams.tenant) keep.set("tenant", searchParams.tenant);
  const keepQs = keep.toString() ? `&${keep.toString()}` : "";
  const altHref = selected
    ? (selected.withoutMamoruPlanId ? `/subscribe?plan=${selected.withoutMamoruPlanId}${keepQs}` : null)
    : (!wantA ? `/subscribe?v=a${keepQs}` : null);

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
          altHref={altHref}
          termsSlug={Object.fromEntries(all.map((p) => [p.id, p.termsSlug ?? p.id]))}
        />
      </div>
    </main>
  );
}
