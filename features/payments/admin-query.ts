import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { getServiceStartMap, getLicenseKeyMap } from "./store";
import { loadBillingPolicy, firstChargeDate, todayJst } from "./billing-config";
import {
  filterByScope, filterByStatus, filterByQuery, isAppliedIn, type BoardScope,
} from "./admin-filter";

// 登録者管理ボードの1行 (カード等の決済個人情報は一切含めない §7)。
export type RegistrantRow = {
  accountId: string;
  planId: string;           // 現在のプランID (プラン変更のデフォルト選択に使用)
  planName: string;
  appliedAt: string;        // 申込日 (YYYY-MM-DD, JST)
  serviceStart: string;     // 利用開始日 = 加入日の翌月1日 (§規約 有効期間)
  chargeStart: string;      // 課金開始日 = 無料期間終了後の初回課金日
  canceledAt: string | null;// 解約日
  paymentMethod: string;    // card / bank
  statusLabel: "利用前" | "利用中" | "解約" | "申込未完了";
  rawStatus: string;        // active/delinquent/suspended/canceled/card_expired
  name: string | null;
  phone: string | null;
  email: string | null;
  consented: boolean;       // 利用規約 同意済み
  licenseKey: string | null;// ウイルスバスターのライセンスキー (プレミアムのみ)
  monthBilling: "正常" | "決済不備" | "確認中" | "未課金" | "課金予定" | "対象外";
  billingAlert: boolean;    // 決済不備・確認中・延滞・期限切れ等の要注意
};

export type Board = {
  month: string;            // 対象月 YYYY-MM
  scope: BoardScope;        // 一覧の表示範囲 (申込月のみ / 全案件)
  rows: RegistrantRow[];
  // 件数は「表示範囲内」の集計 (一覧の行数と一致させる)
  counts: { total: number; active: number; before: number; canceled: number; incomplete: number; alerts: number };
  totalAll: number;         // 表示範囲に関わらない全案件数 (「全案件」ボタンの表示用)
  outOfScopeAlerts: number; // 表示範囲の外にある要注意の件数 (見落とし防止の告知用)
};

// timestamptz(UTC) → JST の日付 (YYYY-MM-DD)
function jstDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function loadBoard(
  opts: { month: string; status?: string; q?: string; scope?: BoardScope },
): Promise<Board> {
  const svc = createSupabaseService();
  const policy = await loadBillingPolicy();
  const today = todayJst();
  const month = opts.month;

  const { data: contracts, error } = await svc
    .from("payment_contracts")
    .select("id, account_id, plan_name, plan_id, payment_method, status, started_at, next_charge_date, canceled_at, contact_name, contact_phone, contact_email")
    .order("started_at", { ascending: false });
  if (error) throw new Error(`payment_contracts query failed: ${error.message}`);

  const rowsRaw = contracts ?? [];
  const ids = rowsRaw.map((c: any) => c.id);

  // 利用開始日 (選択値。列 p001 未適用なら空 → 申込日から推定)
  const ssMap = await getServiceStartMap(ids);
  // ② 付与済みライセンスキー (列 p002 未適用なら空 → 表示は「—」)
  const lkMap = await getLicenseKeyMap(ids);

  // 同意記録の有無 (account_id 単位)
  const { data: consents } = await svc.from("payment_consents").select("account_id");
  const consentSet = new Set((consents ?? []).map((c: any) => c.account_id));

  // 申込が完了していない契約: 初回登録取引 (kind=initial) が未確定 (ok=null) のまま
  // 残っている = 3DS 認証画面での離脱・結果不明などで決済登録まで到達していない。
  // 対象月に関係なく判定する (申込月を過ぎても未完了は未完了のため)。
  const pendingInitial = new Set<string>();
  if (ids.length) {
    const { data: pend } = await svc
      .from("payment_charges")
      .select("contract_id")
      .is("ok", null)
      .eq("kind", "initial")
      .in("contract_id", ids);
    for (const p of pend ?? []) pendingInitial.add((p as any).contract_id);
  }

  // 対象月の課金結果 (contract_id 単位に集約)
  const chargesByContract = new Map<string, { ok: boolean | null }[]>();
  if (ids.length) {
    const { data: charges } = await svc
      .from("payment_charges")
      .select("contract_id, ok")
      .eq("charge_month", month)
      .in("contract_id", ids);
    for (const ch of charges ?? []) {
      const arr = chargesByContract.get((ch as any).contract_id) ?? [];
      arr.push({ ok: (ch as any).ok });
      chargesByContract.set((ch as any).contract_id, arr);
    }
  }

  const rows: RegistrantRow[] = rowsRaw.map((c: any) => {
    const applied = jstDate(c.started_at);
    // 利用開始日: 選択値があればそれ、無ければ申込日の翌月1日を推定
    const chosen = ssMap.get(c.id) || null;
    const serviceStart = chosen ?? (applied ? firstChargeDate(applied, 1) : "");
    // 課金開始日: 利用開始日 + freeMonths の1日 (無料期間0なら利用開始日)
    const chargeBasis = chosen ?? applied;
    const chargeStart = chargeBasis
      ? (policy.freeMonths > 0 ? firstChargeDate(chargeBasis, policy.freeMonths, policy.chargeDay) : chargeBasis)
      : "";
    const canceledAt = c.canceled_at ? jstDate(c.canceled_at) : null;

    // 状況ラベル。「申込未完了」は利用開始日より優先する — 決済登録が済んでいない契約を
    // 正常な「利用前」と同じ見た目にしてしまうと、課金されないまま見落とされるため。
    let statusLabel: RegistrantRow["statusLabel"];
    if (c.status === "canceled") statusLabel = "解約";
    else if (pendingInitial.has(c.id)) statusLabel = "申込未完了";
    else if (serviceStart && today < serviceStart) statusLabel = "利用前";
    else statusLabel = "利用中";

    // 対象月の課金状況
    const chs = chargesByContract.get(c.id) ?? [];
    let monthBilling: RegistrantRow["monthBilling"];
    if (chs.some((x) => x.ok === true)) monthBilling = "正常";
    else if (chs.some((x) => x.ok === false)) monthBilling = "決済不備";
    else if (chs.some((x) => x.ok === null)) monthBilling = "確認中";
    else {
      const chargeMonth = chargeStart.slice(0, 7);
      // 当月の課金予定日: 初回課金月は chargeStart、以降は当月の課金日(anchor=chargeDay)
      const dueDate = month === chargeMonth
        ? chargeStart
        : `${month}-${String(policy.chargeDay).padStart(2, "0")}`;
      if (!chargeStart || month < chargeMonth) monthBilling = "対象外";       // 無料期間/利用開始前
      else if (c.status === "canceled" && canceledAt && canceledAt.slice(0, 7) < month) monthBilling = "対象外";
      else if (today < dueDate) monthBilling = "課金予定";                     // 課金日がまだ来ていない(将来月/当月未到来)=要注意ではない
      else monthBilling = "未課金";                                           // 課金日を過ぎたのに課金記録が無い=要確認
    }

    // 申込未完了は当月課金が「対象外」になる月でも要注意のまま (放置すると課金されない)
    const billingAlert =
      ["delinquent", "suspended", "card_expired"].includes(c.status) ||
      statusLabel === "申込未完了" ||
      monthBilling === "決済不備" || monthBilling === "確認中" ||
      (monthBilling === "未課金" && c.status !== "canceled");

    return {
      accountId: c.account_id,
      planId: c.plan_id ?? "",
      planName: c.plan_name ?? c.plan_id ?? "",
      appliedAt: applied,
      serviceStart,
      chargeStart,
      canceledAt,
      paymentMethod: "クレジットカード",
      statusLabel,
      rawStatus: c.status,
      name: c.contact_name,
      phone: c.contact_phone,
      email: c.contact_email,
      consented: consentSet.has(c.account_id),
      licenseKey: lkMap.get(c.id) ?? null,
      monthBilling,
      billingAlert,
    };
  });

  // 表示範囲: 既定は「対象月に申し込んだ案件のみ」。"all" で全案件。
  const scope: BoardScope = opts.scope ?? "month";
  const scoped = filterByScope(rows, scope, month);

  // 一覧はさらにステータスタブ・検索で絞る (件数は絞る前=表示範囲の全体で数える)
  const filtered = filterByQuery(filterByStatus(scoped, opts.status), opts.q);

  const counts = {
    total: scoped.length,
    active: scoped.filter((r) => r.statusLabel === "利用中").length,
    before: scoped.filter((r) => r.statusLabel === "利用前").length,
    canceled: scoped.filter((r) => r.statusLabel === "解約").length,
    incomplete: scoped.filter((r) => r.statusLabel === "申込未完了").length,
    alerts: scoped.filter((r) => r.billingAlert).length,
  };

  // 申込月で絞ると他月の要注意案件が画面から消えるため、件数だけは必ず伝える
  // (決済不備の放置を、絞り込みのせいで見落とさないようにするための保険)。
  const outOfScopeAlerts = scope === "all"
    ? 0
    : rows.filter((r) => r.billingAlert && !isAppliedIn(r.appliedAt, month)).length;

  return { month, scope, rows: filtered, counts, totalAll: rows.length, outOfScopeAlerts };
}
