// ④ CSV 出力用のデータ取得。
//   エントリーCSV     … 申込日 (payment_contracts.started_at) を軸に期間で抽出
//   解約CSV          … 解約日 (payment_contracts.canceled_at) を軸に期間で抽出
//   データローダ用CSV … 申込日を軸に期間で抽出。SAF案件番号が入っているものだけ
// カード等の決済個人情報は一切含めない (§7)。
import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import {
  getServiceStartMap, getLicenseKeyMap, getSafCaseNoMap, getIncompleteContractIds,
} from "./store";
import { formatPhoneJp } from "./phone";
import { loadBillingPolicy, firstChargeDate, chargeStartDateFrom } from "./billing-config";

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

export type DataLoaderExportRow = {
  safCaseNo: string;      // SAF案件番号
  serviceName: string;    // 付帯名 (暮らし安心プラス / 暮らし安心プレミアム)
  chargeStartDate: string;// 課金開始日
  canceledDate: string;   // 解約日 (未解約は空)
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

// 「申込が成立しなかった契約」(3DS 離脱・認証失敗) は CSV から除外する
// — 実際には加入していない人がエントリーCSVに載り、解約していない人が解約CSVに
// 載ってしまうため。判定は連携シートの退会日の埋め直しと共通 (store に集約)。

/** ④-1 エントリーCSV: 申込日が [from, to] の案件 (申込日の昇順) */
export async function loadEntryExport(from: string, to: string): Promise<EntryExportRow[]> {
  const svc = createSupabaseService();
  const { gte, lt } = jstRangeToUtc(from, to);
  const { data, error } = await svc
    .from("payment_contracts")
    .select("id, account_id, contact_name, contact_phone, next_charge_date, started_at, canceled_at")
    // 解約済みは新規エントリーとして渡さない。解約は解約CSV(解約日軸)の担当。
    // これを入れないと、申込月を後から出力し直したときに解約者まで新規として並ぶ。
    .is("canceled_at", null)
    .gte("started_at", gte)
    .lt("started_at", lt)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`payment_contracts export query failed: ${error.message}`);

  const all = data ?? [];
  const allIds = all.map((r: any) => r.id);
  // 認証失敗・離脱で残った未成立の契約は出力しない
  const skip = await getIncompleteContractIds(allIds);
  const rows = all.filter((r: any) => !skip.has(r.id));

  const ids = rows.map((r: any) => r.id);
  // 利用開始日(p001)・ライセンスキー(p002) は列が無い環境でも落とさない (空で出力)
  const [ssMap, lkMap, policy] = await Promise.all([
    getServiceStartMap(ids), getLicenseKeyMap(ids), loadBillingPolicy(),
  ]);

  return rows.map((r: any) => {
    const { last, first } = splitName(r.contact_name);
    const applied = jstDate(r.started_at);
    // 利用開始日: 選択値があればそれ、無ければ申込日の翌月1日 (管理ボードと同じ規則)
    const serviceStart = ssMap.get(r.id) || (applied ? firstChargeDate(applied, 1) : "");
    return {
      accountId: r.account_id ?? "",
      licenseKey: lkMap.get(r.id) ?? "",
      serviceStartDate: ssMap.get(r.id) ?? "",
      // next_charge_date は課金のたびに翌月へ進むため使わない。
      // 課金済みの案件を再出力したときに「課金開始日」がずれてしまう。
      chargeStartDate: chargeStartDateFrom(serviceStart, policy.freeMonths, policy.chargeDay),
      lastNameKanji: last,
      firstNameKanji: first,
      mobilePhone: formatPhoneJp(r.contact_phone),   // 先方へはハイフン付きで統一
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
  const skip = await getIncompleteContractIds(all.map((r: any) => r.id));

  return all
    .filter((r: any) => !skip.has(r.id))
    .map((r: any) => ({
      accountId: r.account_id ?? "",
      canceledDate: jstDate(r.canceled_at),
    }));
}

/**
 * ⑤ データローダ用CSV: 申込日が [from, to] の案件 (申込日の昇順)。
 *
 * ・SAF案件番号が入力済みの案件だけを出す
 *   — 番号が無い行はデータローダの取込キーが無く、入れても使えないため。
 * ・解約済みも含める (解約日を渡すための出力なので、除外すると用をなさない)。
 * ・申込未完了 (3DS離脱等) は出さない。
 */
export async function loadDataLoaderExport(from: string, to: string): Promise<DataLoaderExportRow[]> {
  const svc = createSupabaseService();
  const { gte, lt } = jstRangeToUtc(from, to);
  const { data, error } = await svc
    .from("payment_contracts")
    .select("id, plan_name, plan_id, started_at, canceled_at")
    .gte("started_at", gte)
    .lt("started_at", lt)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`payment_contracts dataloader export query failed: ${error.message}`);

  const all = data ?? [];
  const skip = await getIncompleteContractIds(all.map((r: any) => r.id));
  const rows = all.filter((r: any) => !skip.has(r.id));

  const ids = rows.map((r: any) => r.id);
  const [ssMap, safMap, policy] = await Promise.all([
    getServiceStartMap(ids), getSafCaseNoMap(ids), loadBillingPolicy(),
  ]);

  return rows
    .map((r: any): DataLoaderExportRow => {
      const applied = jstDate(r.started_at);
      // 利用開始日・課金開始日は管理ボード / エントリーCSV と同じ規則で求める
      const serviceStart = ssMap.get(r.id) || (applied ? firstChargeDate(applied, 1) : "");
      return {
        safCaseNo: (safMap.get(r.id) ?? "").trim(),
        serviceName: r.plan_name ?? r.plan_id ?? "",
        chargeStartDate: chargeStartDateFrom(serviceStart, policy.freeMonths, policy.chargeDay),
        canceledDate: jstDate(r.canceled_at),
      };
    })
    .filter((r: DataLoaderExportRow) => r.safCaseNo);   // SAF案件番号が未入力の案件は出さない
}
