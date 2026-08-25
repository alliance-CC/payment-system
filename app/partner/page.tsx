import Link from "next/link";
import { LogOut, RefreshCw } from "lucide-react";
import { requirePartner } from "@/features/partner/auth";
import { loadPartnerBoard, filterByContractMonth } from "@/features/payments/partner-query";
import { partnerLogoutAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "ご契約者情報ダッシュボード",
  robots: { index: false, follow: false },
};

/** YYYY-MM → "2026年08月" */
function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${y}年${mo}月`;
}

export default async function PartnerDashboardPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  requirePartner();

  const view = await loadPartnerBoard();

  // 既定は最新の月。month=all を指定すると全期間。
  // データが1件も無いときは対象月が決まらないので、全期間として扱う
  // (どのタブも選択されていない中途半端な表示にしない)。
  const requested = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : "";
  const month = searchParams.month === "all" ? "" : requested || view.months[0] || "";
  const showAll = !month;

  const rows = filterByContractMonth(view.rows, month);
  const canceled = rows.filter((r) => r.withdrawalDate).length;

  const href = (m: string) => `/partner?month=${m}`;

  return (
    <main className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-navy">ご契約者情報ダッシュボード</h1>
            <p className="text-xs text-muted">ご登録が完了したご契約者さまの一覧（月別）</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={href(month || "all")} className="btn flex items-center gap-1">
              <RefreshCw size={14} />更新
            </Link>
            <form action={partnerLogoutAction}>
              <button className="btn flex items-center gap-1"><LogOut size={14} />ログアウト</button>
            </form>
          </div>
        </header>

        {view.notReady ? (
          <div className="card p-6 text-center text-sm text-muted">
            ただいま準備中です。しばらくしてからご確認ください。
          </div>
        ) : (
          <>
            {/* 月別タブ */}
            <div className="card p-3 space-y-2">
              <div className="label">対象月（ご契約日）</div>
              <div className="flex flex-wrap gap-1.5">
                <Link
                  href={href("all")}
                  className={"chip " + (showAll ? "chip-navy" : "hover:border-navy/40")}
                >
                  全期間（{view.rows.length}）
                </Link>
                {view.months.map((m) => (
                  <Link
                    key={m}
                    href={href(m)}
                    className={"chip " + (!showAll && m === month ? "chip-navy" : "hover:border-navy/40")}
                  >
                    {monthLabel(m)}
                  </Link>
                ))}
              </div>
            </div>

            {/* 件数サマリ */}
            <div className="card p-3 flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted">{showAll ? "全期間" : monthLabel(month)}</span>
              <span className="text-muted ml-auto">件数 <b className="text-ink">{rows.length}</b></span>
              <span className="text-muted">うち退会 <b className="text-ink">{canceled}</b></span>
            </div>

            {/* 明細 */}
            <div className="card overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-border">
                    <th className="px-3 py-2 font-medium">お客様名</th>
                    <th className="px-3 py-2 font-medium">ご契約日</th>
                    <th className="px-3 py-2 font-medium">ご利用開始日</th>
                    <th className="px-3 py-2 font-medium">退会日</th>
                    <th className="px-3 py-2 font-medium">ご加入サービス名</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted">
                        この期間のご契約はありません
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => (
                    <tr key={`${r.customerName}-${r.contractDate}-${i}`} className="border-b border-border/60">
                      <td className="px-3 py-2 font-medium">{r.customerName || "-"}</td>
                      <td className="px-3 py-2 text-muted">{r.contractDate || "-"}</td>
                      <td className="px-3 py-2 text-muted">{r.serviceStartDate || "-"}</td>
                      <td className="px-3 py-2 text-muted">
                        {r.withdrawalDate
                          ? <span className="chip">{r.withdrawalDate}</span>
                          : <span className="text-muted">-</span>}
                      </td>
                      <td className="px-3 py-2">{r.serviceName || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted">
          ※ 本ページは関係者限定です。記載の個人情報の取扱いにはご注意ください。
        </p>
      </div>
    </main>
  );
}
