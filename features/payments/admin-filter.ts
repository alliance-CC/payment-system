// 登録者管理ボードの絞り込み (純粋関数)。
//
// DB アクセスも server-only も含まないため単体テストできる。
// ここは「表示する行を選ぶ」だけの処理であり、課金・解約などの処理には一切関与しない。

/** 一覧の表示範囲。month = 対象月に申し込んだ案件のみ / all = 全案件 */
export type BoardScope = "month" | "all";

/** クエリ文字列から表示範囲を読む (既定は「申込月のみ」)。 */
export function parseScope(v: string | null | undefined): BoardScope {
  return v === "all" ? "all" : "month";
}

/**
 * 申込日 (YYYY-MM-DD) が対象月 (YYYY-MM) に含まれるか。
 * 申込日が記録されていない行は "含む" 扱いにする
 * — 判定できないものを隠して見落とすより、表示して気づけるほうが安全。
 */
export function isAppliedIn(appliedAt: string, month: string): boolean {
  if (!appliedAt) return true;
  return appliedAt.slice(0, 7) === month;
}

/** 表示範囲での絞り込み。all のときは何もしない。 */
export function filterByScope<T extends { appliedAt: string }>(
  rows: T[],
  scope: BoardScope,
  month: string,
): T[] {
  if (scope === "all") return rows;
  return rows.filter((r) => isAppliedIn(r.appliedAt, month));
}

/** ステータスタブでの絞り込み。"all" / 未指定は素通し、"alert" は要注意のみ。 */
export function filterByStatus<T extends { statusLabel: string; billingAlert: boolean }>(
  rows: T[],
  status: string | null | undefined,
): T[] {
  if (!status || status === "all") return rows;
  if (status === "alert") return rows.filter((r) => r.billingAlert);
  return rows.filter((r) => r.statusLabel === status);
}

/** 電話番号の照合用に数字だけを取り出す (ハイフン有無どちらで検索してもヒットさせる)。 */
function digits(v: string | null | undefined): string {
  return String(v ?? "").replace(/[^0-9]/g, "");
}

/** 会員ID / お客様名 / 電話番号 での検索。 */
export function filterByQuery<T extends { accountId: string; name: string | null; phone: string | null }>(
  rows: T[],
  q: string | null | undefined,
): T[] {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return rows;
  const needleDigits = digits(needle);
  return rows.filter(
    (r) =>
      r.accountId.toLowerCase().includes(needle) ||
      (r.name ?? "").toLowerCase().includes(needle) ||
      (r.phone ?? "").toLowerCase().includes(needle) ||
      // 「090-1234-5678」でも「09012345678」でもヒットするよう数字同士でも比較する
      (needleDigits.length > 0 && digits(r.phone).includes(needleDigits)),
  );
}
