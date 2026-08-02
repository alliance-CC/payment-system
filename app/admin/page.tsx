import Link from "next/link";
import { LogOut, AlertTriangle, RefreshCw, Settings, Search, Download, TrendingUp } from "lucide-react";
import { requireAdmin } from "@/features/admin/auth";
import { loadBoard, type RegistrantRow } from "@/features/payments/admin-query";
import { loadPlans } from "@/features/payments/plans";
import { todayJst } from "@/features/payments/billing-config";
import { cancelAction, deleteAction, changePlanAction, testChargeAction, logoutAction } from "./actions";
import CancelButton from "./CancelButton";
import DeleteButton from "./DeleteButton";
import ChangePlanButton from "./ChangePlanButton";
import TestChargeButton from "./TestChargeButton";
import CopyButton from "./CopyButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "登録者管理 | Memoreal Payments" };

const STATUS_TABS = [
  { key: "all", label: "すべて" },
  { key: "利用前", label: "利用前" },
  { key: "利用中", label: "利用中" },
  { key: "解約", label: "解約" },
  { key: "alert", label: "要注意" },
] as const;

function billingBadge(v: RegistrantRow["monthBilling"]) {
  const map: Record<string, string> = {
    "正常": "chip-good",
    "決済不備": "chip-bad",
    "確認中": "chip-gold",
    "未課金": "chip-bad",
    "対象外": "chip",
  };
  return <span className={`chip ${map[v] ?? "chip"}`}>{v}</span>;
}

function statusBadge(v: RegistrantRow["statusLabel"]) {
  const map: Record<string, string> = { "利用前": "chip-navy", "利用中": "chip-good", "解約": "chip" };
  return <span className={`chip ${map[v] ?? "chip"}`}>{v}</span>;
}

export default async function AdminBoardPage({
  searchParams,
}: {
  searchParams: { month?: string; status?: string; q?: string; del?: string; plan?: string; testcharge?: string; code?: string };
}) {
  requireAdmin();
  const isProd = String(process.env.VT_PRODUCTION ?? "").toLowerCase() === "true";

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : todayJst().slice(0, 7);
  const status = searchParams.status ?? "all";
  const q = searchParams.q ?? "";
  const del = searchParams.del ?? "";
  const delMsg: Record<string, { text: string; ok: boolean }> = {
    ok: { text: "案件を完全に削除しました。", ok: true },
    err: { text: "削除に失敗しました。時間をおいて再度お試しください。", ok: false },
    "not-found": { text: "対象の案件が見つかりませんでした。", ok: false },
    mismatch: { text: "会員IDが一致しなかったため削除を中止しました。", ok: false },
    blocked: { text: "本番環境では削除がロックされています（環境変数 PAYMENTS_ALLOW_DELETE=true が必要）。", ok: false },
  };
  const planRes = searchParams.plan ?? "";
  const planMsg: Record<string, { text: string; ok: boolean }> = {
    ok: { text: "プランを変更しました（無料期間中は初回課金から、課金開始後は翌月分から新料金）。", ok: true },
    same: { text: "現在と同じプランのため変更しませんでした。", ok: false },
    canceled: { text: "解約済みの案件はプラン変更できません。", ok: false },
    noplan: { text: "選択したプランが見つかりませんでした。", ok: false },
    notfound: { text: "対象の案件が見つかりませんでした。", ok: false },
    err: { text: "プラン変更に失敗しました。時間をおいて再度お試しください。", ok: false },
  };
  const testRes = searchParams.testcharge ?? "";
  const testCode = searchParams.code ?? "";
  const testMsg: Record<string, { text: string; ok: boolean }> = {
    ok: { text: "動作テスト課金：成功。カードは正しく登録され、後から引き落とし可能です（本番の毎月課金も動作します）。", ok: true },
    fail: { text: `動作テスト課金：失敗しました${testCode ? `（コード: ${testCode}）` : ""}。カード登録やVeriTrans設定をご確認ください。`, ok: false },
    prod: { text: "本番環境では動作テスト課金は実行できません（実際に課金してしまうため）。検証環境でお試しください。", ok: false },
    notfound: { text: "対象の案件が見つかりませんでした。", ok: false },
    noconfig: { text: "VeriTransの設定（CCID/鍵）が未設定です。", ok: false },
    err: { text: "動作テスト課金に失敗しました。", ok: false },
  };
  const [{ rows, counts }, plans] = await Promise.all([
    loadBoard({ month, status, q }),
    loadPlans(),
  ]);
  const exportQs = new URLSearchParams({ month, status, q }).toString();

  return (
    <main className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        {/* ヘッダー */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-navy">登録者管理ボード</h1>
            <p className="text-xs text-muted">継続課金の登録者一覧・当月の利用/課金状況</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/admin/revenue?month=${month}`} className="btn btn-primary flex items-center gap-1">
              <TrendingUp size={14} />売上予測ボード
            </Link>
            <a href={`/admin/export?${exportQs}`} className="btn flex items-center gap-1" title="現在の絞り込み（状況タブ・検索）を反映して出力します">
              <Download size={14} />CSV出力（絞り込み反映）
            </a>
            <Link href={`/admin?month=${month}&status=${status}&q=${encodeURIComponent(q)}`} className="btn flex items-center gap-1">
              <RefreshCw size={14} />更新
            </Link>
            <Link href="/admin/settings" className="btn flex items-center gap-1">
              <Settings size={14} />課金設定
            </Link>
            <form action={logoutAction}>
              <button className="btn flex items-center gap-1"><LogOut size={14} />ログアウト</button>
            </form>
          </div>
        </header>

        {/* 削除結果の通知 */}
        {del && delMsg[del] && (
          <div className={"card p-3 text-sm " + (delMsg[del].ok ? "text-good" : "text-bad")}>
            {delMsg[del].text}
          </div>
        )}
        {/* プラン変更結果の通知 */}
        {planRes && planMsg[planRes] && (
          <div className={"card p-3 text-sm " + (planMsg[planRes].ok ? "text-good" : "text-bad")}>
            {planMsg[planRes].text}
          </div>
        )}
        {/* 動作テスト課金の結果通知 */}
        {testRes && testMsg[testRes] && (
          <div className={"card p-3 text-sm " + (testMsg[testRes].ok ? "text-good" : "text-bad")}>
            {testMsg[testRes].text}
          </div>
        )}

        {/* サマリ + 月選択 */}
        <div className="card p-4 flex flex-wrap items-center gap-4">
          <form method="get" className="flex items-end gap-2 flex-wrap">
            <div>
              <div className="label mb-1">対象月</div>
              <input type="month" name="month" defaultValue={month} className="input" />
            </div>
            <div>
              <div className="label mb-1 flex items-center gap-1"><Search size={11} />会員ID / お客様名 / 電話番号</div>
              <input type="search" name="q" defaultValue={q} placeholder="MR… / 氏名 / 電話番号" className="input w-52" />
            </div>
            <input type="hidden" name="status" value={status} />
            <button className="btn btn-primary">表示</button>
          </form>
          <div className="flex flex-wrap gap-3 text-sm ml-auto">
            <span className="text-muted">合計 <b className="text-ink">{counts.total}</b></span>
            <span className="text-muted">利用中 <b className="text-good">{counts.active}</b></span>
            <span className="text-muted">利用前 <b className="text-navy">{counts.before}</b></span>
            <span className="text-muted">解約 <b className="text-ink">{counts.canceled}</b></span>
            <span className="text-muted flex items-center gap-1">
              <AlertTriangle size={13} className="text-bad" />要注意 <b className="text-bad">{counts.alerts}</b>
            </span>
          </div>
        </div>

        {/* ステータスタブ */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin?month=${month}&status=${t.key}&q=${encodeURIComponent(q)}`}
              className={"chip " + (status === t.key ? "chip-navy" : "hover:border-navy/40")}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* 一覧 */}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">申込日</th>
                <th className="px-3 py-2 font-medium">会員ID</th>
                <th className="px-3 py-2 font-medium">プラン</th>
                <th className="px-3 py-2 font-medium">利用開始</th>
                <th className="px-3 py-2 font-medium">課金開始</th>
                <th className="px-3 py-2 font-medium">状況</th>
                <th className="px-3 py-2 font-medium">当月課金 ({month})</th>
                <th className="px-3 py-2 font-medium">お客様</th>
                <th className="px-3 py-2 font-medium">支払方法</th>
                <th className="px-3 py-2 font-medium">規約</th>
                <th className="px-3 py-2 font-medium">解約日</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-muted">該当する登録者がいません</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.accountId} className={"border-b border-border/60 " + (r.billingAlert ? "bg-bad/5" : "")}>
                  <td className="px-3 py-2 text-muted">{r.appliedAt}</td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {r.accountId} <CopyButton value={r.accountId} />
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.planName}</div>
                    {r.rawStatus !== "canceled" && (
                      <form action={changePlanAction} className="flex items-center gap-1 mt-1">
                        <input type="hidden" name="accountId" value={r.accountId} />
                        <input type="hidden" name="month" value={month} />
                        <select name="planId" defaultValue={r.planId} className="input text-xs py-0.5 px-1 w-auto">
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <ChangePlanButton currentPlanId={r.planId} />
                      </form>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{r.serviceStart}</td>
                  <td className="px-3 py-2 text-muted">{r.chargeStart}</td>
                  <td className="px-3 py-2">{statusBadge(r.statusLabel)}</td>
                  <td className="px-3 py-2">{billingBadge(r.monthBilling)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name ?? "-"}</div>
                    <div className="text-[11px] text-muted">{r.phone ?? "-"}{r.email ? ` / ${r.email}` : ""}</div>
                  </td>
                  <td className="px-3 py-2 text-muted">{r.paymentMethod}</td>
                  <td className="px-3 py-2">{r.consented ? <span className="chip chip-good">同意済</span> : <span className="chip chip-bad">未同意</span>}</td>
                  <td className="px-3 py-2 text-muted">{r.canceledAt ?? "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {r.rawStatus !== "canceled" && (
                        <form action={cancelAction}>
                          <input type="hidden" name="accountId" value={r.accountId} />
                          <input type="hidden" name="month" value={month} />
                          <CancelButton name={r.name} />
                        </form>
                      )}
                      {!isProd && (
                        <form action={testChargeAction}>
                          <input type="hidden" name="accountId" value={r.accountId} />
                          <input type="hidden" name="month" value={month} />
                          <TestChargeButton />
                        </form>
                      )}
                      <form action={deleteAction}>
                        <input type="hidden" name="accountId" value={r.accountId} />
                        <input type="hidden" name="month" value={month} />
                        <input type="hidden" name="confirm" value="" />
                        <DeleteButton accountId={r.accountId} />
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted">
          ※ カード番号・有効期限・セキュリティコード等の決済個人情報はこの画面・DB・ログのいずれにも保持していません (ブラウザ→決済代行会社へ直接送信)。
        </p>
        <p className="text-[11px] text-muted">
          ※「削除」は案件をDBから完全に削除し取り消せません（会員IDの入力確認が必要）。テスト案件の整理用です。本番環境では環境変数 <code className="font-mono">PAYMENTS_ALLOW_DELETE=true</code> を設定しない限りロックされます。解約は「解約」をご利用ください。
        </p>
      </div>
    </main>
  );
}
