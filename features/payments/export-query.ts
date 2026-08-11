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

  const rows = data ?? [];
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
    .select("account_id, canceled_at")
    .not("canceled_at", "is", null)
    .gte("canceled_at", gte)
    .lt("canceled_at", lt)
    .order("canceled_at", { ascending: true });
  if (error) throw new Error(`payment_contracts cancel export query failed: ${error.message}`);

  return (data ?? []).map((r: any) => ({
    accountId: r.account_id ?? "",
    canceledDate: jstDate(r.canceled_at),
  }));
}
