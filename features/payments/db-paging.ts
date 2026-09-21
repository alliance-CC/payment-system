/**
 * Supabase (PostgREST) の行数上限を越えて全件を読むための共通処理。
 *
 * Supabase は1リクエストで最大 1000 行しか返さない (max-rows)。上限を超えた分は
 * エラーにならず黙って切り捨てられるため、案件が 1000 件を超えた時点で
 * 管理ボード・売上予測・CSV から静かに消える (課金は続くのに画面から見えない)。
 * .range() で続きを取りに行くこと。
 *
 * ⚠️ range で分割して読むので、並び順が一意に定まらないとページの境目で
 *    重複・取りこぼしが起きる。呼び出し側は必ず最後に id 等の一意なキーで
 *    並べ替えること (このファイルの各呼び出し箇所はそうしている)。
 */

/** 1ページの取得件数。Supabase の既定 max-rows と同じ。 */
export const PAGE_SIZE = 1000;

/** ページ取得の上限 (暴走防止)。20万件相当。
 *  バックエンドがページングを無視した場合に無限ループで固まるのを防ぐ。 */
export const MAX_PAGES = 200;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * range を進めながら全件読む。
 * エラーは握りつぶさず投げる — 途中までのデータを全件のように見せないため。
 */
export async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;   // 最後のページ
  }
  // ここに来るのは異常 (ページングが効いていない等)。件数は返すが必ず記録に残す。
  console.error(`[payments] ${label}: ページ取得が上限 ${MAX_PAGES} に達しました`);
  return out;
}

/** .in() に渡す ID の分割数。URL 長の上限対策 (UUID 36文字 × 200 ≒ 7KB)。 */
export const ID_CHUNK = 200;

/** 配列を size 件ずつに分ける */
export function chunk<T>(arr: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * ID の集合で引く問い合わせを、URL 長と行数上限の両方に対応して全件取る。
 * 1件の契約に複数行 (課金履歴など) がぶら下がる場合もあるため、
 * 分割した各かたまりの中でもページングする。
 */
export async function fetchAllByIds<T>(
  ids: string[],
  run: (idsChunk: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunk(ids)) {
    const rows = await fetchAllPages<T>((from, to) => run(part, from, to), label);
    out.push(...rows);
  }
  return out;
}
