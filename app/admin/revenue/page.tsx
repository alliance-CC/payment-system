import Link from "next/link";
import { Users, LogOut, Download } from "lucide-react";
import { requireAdmin } from "@/features/admin/auth";
import { loadRevenue, type RevenueUser } from "@/features/payments/revenue-query";
import { todayJst } from "@/features/payments/billing-config";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "売上予測 | Memoreal Payments" };

const yen = (n: number) => "¥" + n.toLocaleString();

function stateBadge(s: RevenueUser["monthState"]) {
  const map: Record<RevenueUser["monthState"], string> = {
    "確定": "chip-good", "課金予定": "chip-navy", "無料": "chip",
  };
  return <span className={`chip ${map[s]}`}>{s}</span>;
}

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  requireAdmin();
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : todayJst().slice(0, 7);
  const b = await loadRevenue({ month });

  return (
    <main className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="max-w-[1400px] mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-navy">売上予測ボード</h1>
            <p className="text-xs text-muted">その月の利用者・売上の「確定」と「予定」（無料期間中は¥0で表示／解約は翌月から対象外）</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={`/admin/revenue/export?month=${month}`} className="btn flex items-center gap-1"><Download size={14} />当月利用者CSV</a>
            <Link href={`/admin?month=${month}`} className="btn flex items-center gap-1"><Users size={14} />登録者ボード</Link>
            <form action={logoutAction}><button className="btn flex items-center gap-1"><LogOut size={14} />ログアウト</button></form>
          </div>
        </header>

        {/* 月 */}
        <div className="card p-4 flex flex-wrap items-center gap-4">
          <form method="get" className="flex items-end gap-2">
            <div>
              <div className="label mb-1">対象月</div>
              <input type="month" name="month" defaultValue={month} className="input" />
            </div>
            <button className="btn btn-primary">表示</button>
          </form>
        </div>

        {/* 当月サマリ */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="card p-4">
            <div className="text-xs text-muted">当月 売上予定 ({month})</div>
            <div className="text-2xl font-bold text-navy mt-1">{yen(b.monthProjected)}</div>
            <div className="text-[11px] text-muted mt-1">課金対象の月額合計（無料期間は除く）</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted">当月 売上確定 ({month})</div>
            <div className="text-2xl font-bold text-good mt-1">{yen(b.monthConfirmed)}</div>
            <div className="text-[11px] text-muted mt-1">課金成功済みの金額</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted">当月 利用者数</div>
            <div className="text-2xl font-bold text-ink mt-1">{b.usingCount} 名</div>
            <div className="text-[11px] text-muted mt-1">在籍（利用中/利用予定・無料期間含む）</div>
          </div>
          <div className="card p-4">
            <div className="text-xs text-muted">当月 課金対象</div>
            <div className="text-2xl font-bold text-navy mt-1">{b.billingCount} 名</div>
            <div className="text-[11px] text-muted mt-1">無料期間を終え課金が発生する人数</div>
          </div>
        </div>

        {/* 当月の利用者 */}
        <div className="card overflow-x-auto">
          <div className="px-3 py-2 text-sm font-semibold text-navy border-b border-border">当月の利用者 ({month})</div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">会員ID</th>
                <th className="px-3 py-2 font-medium">お客様</th>
                <th className="px-3 py-2 font-medium">プラン</th>
                <th className="px-3 py-2 font-medium">プラン月額</th>
                <th className="px-3 py-2 font-medium">利用状況</th>
                <th className="px-3 py-2 font-medium">当月課金</th>
              </tr>
            </thead>
            <tbody>
              {b.users.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted">対象の利用者がいません</td></tr>}
              {b.users.map((u) => (
                <tr key={u.accountId} className="border-b border-border/60">
                  <td className="px-3 py-2 font-mono text-xs">{u.accountId}</td>
                  <td className="px-3 py-2">{u.name ?? "-"}</td>
                  <td className="px-3 py-2">{u.planName}</td>
                  <td className="px-3 py-2">{yen(u.planAmount)}</td>
                  <td className="px-3 py-2"><span className={"chip " + (u.usageLabel === "利用中" ? "chip-good" : "chip-navy")}>{u.usageLabel}</span></td>
                  <td className="px-3 py-2">{stateBadge(u.monthState)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 年間 */}
        <div className="card overflow-x-auto">
          <div className="px-3 py-2 text-sm font-semibold text-navy border-b border-border">
            {b.year}年 月別 売上(予定 / 確定)
          </div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">月</th>
                {b.annual.map((a) => <th key={a.month} className="px-2 py-2 font-medium text-right">{parseInt(a.month.slice(5), 10)}月</th>)}
                <th className="px-3 py-2 font-medium text-right">年間合計</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="px-3 py-2 text-navy font-medium">予定</td>
                {b.annual.map((a) => <td key={a.month} className="px-2 py-2 text-right text-muted">{a.projected ? yen(a.projected) : "-"}</td>)}
                <td className="px-3 py-2 text-right font-bold text-navy">{yen(b.annualProjected)}</td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-good font-medium">確定</td>
                {b.annual.map((a) => <td key={a.month} className="px-2 py-2 text-right text-muted">{a.confirmed ? yen(a.confirmed) : "-"}</td>)}
                <td className="px-3 py-2 text-right font-bold text-good">{yen(b.annualConfirmed)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted">
          ※ 予定=その月に課金対象となる契約の月額合計（無料期間中は¥0）。確定=その月に実際に課金成功した金額。
          解約された契約は「解約月の翌月」から集計対象外です（解約月は在籍＝当月まで課金対象）。カード等の決済個人情報は表示していません。
        </p>
      </div>
    </main>
  );
}
