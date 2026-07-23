// 継続課金プラン定義 (§1.2「プラン定義(id→金額・周期)」/ §10 未確定)。
//
// ⚠️ §10: 金額・課金サイクル・課金日ポリシー・初回課金タイミングは「確認中」。
//    確定するまでハードコードせず、設定 (env / DB) から読む前提。以下は仮の型と
//    フォールバック。実運用値は tenant ごとの設定に持たせること (OEM 方針 §1.2)。
export type BillingCycle = "monthly"; // TODO(§10): 他サイクルが必要か確認

export type Plan = {
  id: string;
  name: string;
  /** 円。TODO(§10): 確定金額に差し替え */
  amount: number;
  cycle: BillingCycle;
};

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

const FALLBACK_PLANS: Plan[] = [
  // 既定テナント (lifeap「暮らし安心」) の確定プラン。
  // OEM 先や金額変更は VT_PLANS_JSON (env / テナント設定) で上書きする。
  //   plus    … まもるん + あんしんネット
  //   premium … 上記 + ウイルスバスター + データ復旧
  { id: "plus",    name: "暮らし安心プラス",     amount: 1200, cycle: "monthly" },
  { id: "premium", name: "暮らし安心プレミアム", amount: 1700, cycle: "monthly" },
];

export function getPlans(): Plan[] {
  return loadPlansFromEnv() ?? FALLBACK_PLANS;
}

export function getPlan(id: string): Plan | undefined {
  return getPlans().find((p) => p.id === id);
}
