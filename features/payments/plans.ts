// 継続課金プラン定義 (§1.2「プラン定義(id→金額・周期)」/ §10 未確定)。
//
// ⚠️ §10: 金額・課金サイクル・課金日ポリシー・初回課金タイミングは「確認中」。
//    確定するまでハードコードせず、設定 (env / DB) から読む前提。以下は仮の型と
//    フォールバック。実運用値は tenant ごとの設定に持たせること (OEM 方針 §1.2)。
export type BillingCycle = "monthly"; // TODO(§10): 他サイクルが必要か確認

/** まもるんの有無による社内区分。顧客には出さない (顧客表記は displayName)。
 *   A … まもるん無し (安価)
 *   B … まもるん有り (従来プラン。既存契約はすべて B) */
export type PlanVariant = "A" | "B";

export type Plan = {
  id: string;
  /** 社内表記 (例: 暮らし安心プラスB)。管理画面・CSV・連携シートで使う */
  name: string;
  /** 円。TODO(§10): 確定金額に差し替え */
  amount: number;
  cycle: BillingCycle;
  /** 顧客向け表記 (例: 暮らし安心プラス)。申込画面はこちらのみ表示する。未設定なら name */
  displayName?: string;
  /** 社内区分 (まもるん有無) */
  variant?: PlanVariant;
  /** まもるん無し版のプランID (B のみ設定)。「まもるんをご不要な方はこちら」の遷移先 */
  withoutMamoruPlanId?: string;
  /** 利用規約ページのスラッグ (A/B は同一の規約を参照する) */
  termsSlug?: string;
};

/** 顧客に見せる名称 (A/B の別は出さない) */
export function customerPlanName(p: { name: string; displayName?: string }): string {
  return p.displayName || p.name;
}

// TODO(§10): 本番プランは DB(integrations/tenant 設定) から取得する。
// 検証用の仮プラン。VT_PLANS_JSON 環境変数があればそれを優先。
function loadPlansFromEnv(): Plan[] | null {
  const raw = process.env.VT_PLANS_JSON;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr as Plan[];
  } catch { /* ignore */ }
  return null;
}

// 既定テナント (lifeap「暮らし安心」) の既定プラン。
// 実運用の金額変更は管理画面 (/admin/settings → DB) で行う。
//   B (まもるん有り。既存の獲得済み契約はすべてこちら)
//     plus     … ネットライフサポート + まもるん
//     premium  … 上記 + データ復旧 + セキュリティ
//   A (まもるん無し)
//     plusA / premiumA … 上記からまもるんを除いたもの
// ※ B の id は既存の LP リンク (?plan=plus) と既存契約の plan_id をそのまま使うため変更しない。
const FALLBACK_PLANS: Plan[] = [
  { id: "plus",     name: "暮らし安心プラスB",     amount: 1320, cycle: "monthly" },
  { id: "premium",  name: "暮らし安心プレミアムB", amount: 1870, cycle: "monthly" },
  { id: "plusA",    name: "暮らし安心プラスA",     amount: 990,  cycle: "monthly" },
  { id: "premiumA", name: "暮らし安心プレミアムA", amount: 1430, cycle: "monthly" },
];

// コード側で定義するプランの付帯情報 (id をキーに loadPlans の結果へ補完する)。
// 金額・名称は管理画面(DB)で編集できるが、A/B 区分と顧客向け表記はここを正とする。
const PLAN_META: Record<string, {
  displayName: string; variant: PlanVariant; withoutMamoruPlanId?: string; termsSlug: string;
}> = {
  plus:     { displayName: "暮らし安心プラス",     variant: "B", withoutMamoruPlanId: "plusA",    termsSlug: "plus" },
  premium:  { displayName: "暮らし安心プレミアム", variant: "B", withoutMamoruPlanId: "premiumA", termsSlug: "premium" },
  plusA:    { displayName: "暮らし安心プラス",     variant: "A", termsSlug: "plus" },
  premiumA: { displayName: "暮らし安心プレミアム", variant: "A", termsSlug: "premium" },
};

/** DB/env 由来のプランへコード側の付帯情報を補完する。
 *  社内表記に A/B が付いていない既存設定には接尾辞を補う (既存はすべて B)。 */
function withMeta(p: Plan): Plan {
  const m = PLAN_META[p.id];
  if (!m) return p;
  return {
    ...p,
    name: /[AB]$/.test(p.name) ? p.name : `${p.name}${m.variant}`,
    displayName: p.displayName || m.displayName,
    variant: p.variant ?? m.variant,
    withoutMamoruPlanId: p.withoutMamoruPlanId ?? m.withoutMamoruPlanId,
    termsSlug: p.termsSlug ?? m.termsSlug,
  };
}

/** 設定に無いコード定義プランを補い、表示順を揃える。
 *  (新プラン追加時に管理画面での手作業を不要にするため) */
function mergeWithFallback(list: Plan[]): Plan[] {
  const seen = new Set(list.map((p) => p.id));
  const order = FALLBACK_PLANS.map((p) => p.id);
  return [...list, ...FALLBACK_PLANS.filter((p) => !seen.has(p.id))]
    .map(withMeta)
    .sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}

// 同期版 (env → 既定): DB を読まない文脈やフォールバック用。
export function getPlans(): Plan[] {
  return mergeWithFallback(loadPlansFromEnv() ?? FALLBACK_PLANS);
}

export function getPlan(id: string): Plan | undefined {
  return getPlans().find((p) => p.id === id);
}

// DB優先版 (DB設定 → env → 既定)。申込/管理表示など実行時はこちらを使う。
export async function loadPlans(): Promise<Plan[]> {
  const { loadPaymentSettings } = await import("./payment-settings");
  const s = await loadPaymentSettings();
  if (Array.isArray(s.plans) && s.plans.length > 0) return mergeWithFallback(s.plans);
  return getPlans();
}

export async function loadPlan(id: string): Promise<Plan | undefined> {
  return (await loadPlans()).find((p) => p.id === id);
}
