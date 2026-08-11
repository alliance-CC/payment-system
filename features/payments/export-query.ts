// ④ CSV 出力用のデータ取得。
//   エントリーCSV … 申込日 (payment_contracts.started_at) を軸に期間で抽出
//   解約CSV      … 解約日 (payment_contracts.canceled_at) を軸に期間で抽出
// カード等の決済個人情報は一切含めない (§7)。
import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { getServiceStartMap, getLicenseKeyMap } from "./store";

export type EntryExportRow = {
  accountId: string;
  licenseKey: string;        // ライセンスキー_ウイルスバスター (プラスは空)
  serviceStartDate: string;  // サービス開始日
  chargeStartDate: string;   // 課金開始日
  lastNameKanji: string;
  firstNameKanji: string;
  mobilePhone: string;
};

export type CancelExportRow = {
  accountId: string;
  canceledDate: string;
};

/** JST の日付範囲 [from, to] を UTC の時刻範囲に変換する。
 *  JST = UTC+9 のため、JST の from 00:00 は UTC で前日 15:00、to 23:59:59 は UTC で当日 14:59:59。 */
function jstRangeToUtc(from: string, to: string): { gte: string; lt: string } {
  const gte = new Date(`${from}T00:00:00+09:00`).toISOString();
  // to の翌日 00:00(JST) 未満 = to 当日を含む
  const toNext = new Date(`${to}T00:00:00+09:00`);
  toNext.setUTCDate(toNext.getUTCDate() + 1);
  return { gte, lt: toNext.toISOString() };
}

// timestamptz(UTC) → JST の日付 (YYYY-MM-DD)
function jstDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// 氏名 `姓 名` を分割 (billing.splitName と同一規則。server-only 依存を避けここにも持つ)
function splitName(full: string | null): { last: string; first: string } {
  const s = (full ?? "").trim().replace(/[　]/g, " ");
  const i = s.indexOf(" ");
  if (i < 0) return { last: s, first: "" };
  return { last: s.slice(0, i).trim(), first: s.slice(i + 1).trim() };
}

/**
 * 「申込が成立しなかった契約」の id 集合を返す (CSV から除外するため)。
 *
 * 3DS では認証前に契約行を先に作るため、認証失敗・離脱でも契約が残る
 * (status=canceled / suspended)。これを出力すると、実際には加入していない人が
 * エントリーCSVに載り、解約していない人が解約CSVに載ってしまう。
 *
 * 判定: 初回課金(kind='initial')の記録があり、その ok が true でないもの。
 *   ・3DS成立      … initial ok=true      → 出力する
 *   ・3DS失敗/放置 … initial ok=false/null → 除外する
 *   ・無料期間の従来フロー … initial 行自体が無い → 出力する (成立している)
 */
async function loadIncompleteContractIds(ids: string[]): Promise<Set<string>> {
  const skip = new Set<string>();
  if (!ids.length) return skip;
  const svc = createSupabaseService();
  const { data, error } = await svc
    .from("payment_charges")
    .select("contract_id, ok")
    .eq("kind", "initial")
    .in("contract_id", ids);
  if (error) return skip;              // 判定できない場合は除外しない (取りこぼしを作らない)
  const hasSuccess = new Set<string>();
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const cid = String((r as any).contract_id);
    seen.add(cid);
    if ((r as any).ok === true) hasSuccess.add(cid);
  }
  for (const cid of seen) if (!hasSuccess.has(cid)) skip.add(cid);
  return skip;
}

/** ④-1 エントリーCSV: 申込日が [from, to] の案件 (申込日の昇順) */
export async function loadEntryExport(from: string, to: string): Promise<EntryExportRow[]> {
  const svc = createSupabaseService();
  const { gte, lt } = jstRangeToUtc(from, to);
  const { data, error } = await svc
    .from("payment_contracts")
    .select("id, account_id, contact_name, contact_phone, next_charge_date, started_at")
    .gte("started_at", gte)
    .lt("started_at", lt)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`payment_contracts export query failed: ${error.message}`);

  const all = data ?? [];
  const allIds = all.map((r: any) => r.id);
  // 認証失敗・離脱で残った未成立の契約は出力しない
  const skip = await loadIncompleteContractIds(allIds);
  const rows = all.filter((r: any) => !skip.has(r.id));

  const ids = rows.map((r: any) => r.id);
  // 利用開始日(p001)・ライセンスキー(p002) は列が無い環境でも落とさない (空で出力)
  const [ssMap, lkMap] = await Promise.all([getServiceStartMap(ids), getLicenseKeyMap(ids)]);

  return rows.map((r: any) => {
    const { last, first } = splitName(r.contact_name);
    return {
      accountId: r.account_id ?? "",
      licenseKey: lkMap.get(r.id) ?? "",
      serviceStartDate: ssMap.get(r.id) ?? "",
      chargeStartDate: r.next_charge_date ?? "",
      lastNameKanji: last,
      firstNameKanji: first,
      mobilePhone: r.contact_phone ?? "",
    };
  });
}

/** ④-2 解約CSV: 解約日が [from, to] の案件 (解約日の昇順) */
export async function loadCancelExport(from: string, to: string): Promise<CancelExportRow[]> {
  const svc = createSupabaseService();
  const { gte, lt } = jstRangeToUtc(from, to);
  const { data, error } = await svc
    .from("payment_contracts")
    .select("id, account_id, canceled_at")
    .not("canceled_at", "is", null)
    .gte("canceled_at", gte)
    .lt("canceled_at", lt)
    .order("canceled_at", { ascending: true });
  if (error) throw new Error(`payment_contracts cancel export query failed: ${error.message}`);

  const all = data ?? [];
  // 3DS認証失敗・離脱の契約も canceled_at が入るが、これは「解約」ではないため除外する
  const skip = await loadIncompleteContractIds(all.map((r: any) => r.id));

  return all
    .filter((r: any) => !skip.has(r.id))
    .map((r: any) => ({
      accountId: r.account_id ?? "",
      canceledDate: jstDate(r.canceled_at),
    }));
}
