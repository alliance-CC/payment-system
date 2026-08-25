// 外部企業向けダッシュボード (/partner) のデータ取得。
//
// 出す対象: 管理ボードで「エントリー済み」にした案件だけ (entered_at が入っているもの)。
//   まだエントリーしていない案件・申込未完了・エントリーせずに解約になった案件は出さない。
//
// 出す項目は5つだけ (お客様名 / ご契約日 / ご利用開始日 / 退会日 / ご加入サービス名)。
// 会員ID・電話番号・メール・ライセンスキー・金額・課金状況などは一切含めない。
// カード等の決済個人情報はそもそもシステムのどこにも保持していない (§7)。
import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { getServiceStartMap } from "./store";
import { firstChargeDate } from "./billing-config";

export type PartnerRow = {
  customerName: string;     // お客様名
  contractDate: string;     // ご契約日 (= 申込日)
  serviceStartDate: string; // ご利用開始日
  withdrawalDate: string;   // 退会日 (未解約は空)
  serviceName: string;      // ご加入サービス名
};

export type PartnerBoard = {
  /** エントリー済みの全明細 (ご契約日の昇順)。月の絞り込みは呼び出し側で行う */
  rows: PartnerRow[];
  /** データが存在する月の一覧 (新しい順)。月別タブの生成に使う */
  months: string[];
  /**
   * entered_at 列がまだ作られていない (p004 未適用)。
   * この場合ダッシュボードは空になるため、画面側で「準備中」と案内する。
   */
  notReady: boolean;
};

// timestamptz(UTC) → JST の日付 (YYYY-MM-DD)
function jstDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** ご契約日が対象月のものだけに絞る (month が空なら全期間)。 */
export function filterByContractMonth(rows: PartnerRow[], month: string): PartnerRow[] {
  if (!month) return rows;
  return rows.filter((r) => r.contractDate.slice(0, 7) === month);
}

/** エントリー済みの案件をすべて取得する (月別タブも作れるよう絞り込みはしない)。
 *
 *  取得に失敗した場合はエラーを投げずに notReady で返す。
 *  外部企業の画面をエラーページにしない (原因も分からないまま問い合わせが来るため)。 */
export async function loadPartnerBoard(): Promise<PartnerBoard> {
  const notReady: PartnerBoard = { rows: [], months: [], notReady: true };

  let data: any[] | null = null;
  try {
    const svc = createSupabaseService();     // 環境変数が未設定だとここで throw する
    const res = await svc
      .from("payment_contracts")
      .select("id, plan_name, plan_id, started_at, canceled_at, contact_name, entered_at")
      .not("entered_at", "is", null)
      .order("started_at", { ascending: true });
    if (res.error) {
      // entered_at 列が無い (p004 未適用) 等
      console.error("[partner] query failed:", res.error.message);
      return notReady;
    }
    data = res.data;
  } catch (e: any) {
    console.error("[partner] query threw:", String(e?.message ?? e));
    return notReady;
  }

  const all = data ?? [];
  const ssMap = await getServiceStartMap(all.map((r: any) => r.id)).catch(() => new Map());

  const rows: PartnerRow[] = all.map((r: any) => {
    const contractDate = jstDate(r.started_at);
    // 利用開始日は管理ボード・連携シートと同じ規則で求める
    // (選択値が無い場合はご契約日の翌月1日)
    const chosen = ssMap.get(r.id) || null;
    return {
      contractDate,
      customerName: r.contact_name ?? "",
      serviceStartDate: chosen ?? (contractDate ? firstChargeDate(contractDate, 1) : ""),
      withdrawalDate: jstDate(r.canceled_at),
      serviceName: r.plan_name ?? r.plan_id ?? "",
    };
  });

  // 月別タブ用: ご契約日の月を新しい順に
  const months = Array.from(
    new Set(rows.map((r) => r.contractDate.slice(0, 7)).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));

  return { rows, months, notReady: false };
}
