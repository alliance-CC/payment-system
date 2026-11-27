// プランの区分 (プラス / プレミアム)。
//
// 先方 (nuworks) の入れ先 (コンテンツパッケージ) はプラスとプレミアムで別になっている。
// エントリーCSV・解約CSV をこの区分で分けて出す (管理ボードのダウンロードとエンカンAIの口の両方)。
// A/B はまもるんの有無の違いなので、同じ区分に入る (plusA → プラス / premiumA → プレミアム)。
//
// server-only を import しない (テストと、クライアントの部品からも使うため)。

export type PlanKind = "plus" | "premium";

export const PLAN_KINDS: readonly PlanKind[] = ["plus", "premium"];

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  plus: "プラス",
  premium: "プレミアム",
};

/**
 * 契約のプランがどちらの区分か。分からなければ null。
 *
 * ・まず id で決める (plus / plusA / premium / premiumA)。
 *   プラン変更は plan_id と plan_name を一緒に書き換えるが、id を正とする。
 * ・id で決まらないとき (管理画面で足した別の id など) だけ、名称に「プレミアム」「プラス」があるかで見る。
 *   ライセンスキーの判定 (planIncludesVirusBuster) と同じく、名称は「プレミアム」を先に見る。
 */
export function planKind(planId?: string | null, planName?: string | null): PlanKind | null {
  const id = (planId ?? "").trim().toLowerCase();
  if (id.startsWith("premium")) return "premium";
  if (id.startsWith("plus")) return "plus";
  const name = planName ?? "";
  if (name.includes("プレミアム")) return "premium";
  if (name.includes("プラス")) return "plus";
  return null;
}

/**
 * URL の `plan` の値を読む。
 *   ・無い/空            → null (区分で分けない = これまでどおり全件)
 *   ・plus / premium     → その区分
 *   ・それ以外           → "invalid" (呼び出し側で 400 にする。黙って全件を返さない)
 */
export function parsePlanKind(raw: string | null | undefined): PlanKind | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return (PLAN_KINDS as readonly string[]).includes(s) ? (s as PlanKind) : "invalid";
}

/** 区分で絞る。kind が null なら絞らない (全件)。区分の分からない行は、区分を指定したときはどちらにも入らない。 */
export function filterByPlanKind<T extends { planKind: PlanKind | null }>(rows: T[], kind: PlanKind | null): T[] {
  if (!kind) return rows;
  return rows.filter((r) => r.planKind === kind);
}

/** 区分の分からない行 (どちらの CSV にも入らない行)。黙って落とさず、呼び出し側で名指しするため。 */
export function rowsWithoutPlanKind<T extends { planKind: PlanKind | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.planKind === null);
}
