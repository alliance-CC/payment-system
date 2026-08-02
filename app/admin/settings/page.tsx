import Link from "next/link";
import { Save, ArrowLeft, Plus } from "lucide-react";
import { requireAdmin } from "@/features/admin/auth";
import { loadPlans } from "@/features/payments/plans";
import { loadBillingPolicy } from "@/features/payments/billing-config";
import { loadPaymentSettings, DEFAULT_WELCOME_SUBJECT, DEFAULT_WELCOME_BODY } from "@/features/payments/payment-settings";
import { saveSettingsAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "課金設定 | Memoreal Payments" };

export default async function SettingsPage({ searchParams }: { searchParams: { saved?: string; err?: string } }) {
  requireAdmin();
  const plans = await loadPlans();
  const policy = await loadBillingPolicy();
  const raw = await loadPaymentSettings();
  const welcomeSubject = raw.welcomeEmail?.subject || DEFAULT_WELCOME_SUBJECT;
  const welcomeBody = raw.welcomeEmail?.body || DEFAULT_WELCOME_BODY;
  // 追加入力用の空行を3つ確保
  const rows = [...plans, ...Array(3).fill(null)].slice(0, Math.max(plans.length + 2, 4));

  return (
    <main className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-navy">課金設定</h1>
            <p className="text-xs text-muted">プラン・金額・無料期間・継続課金・解約ポリシー(管理者が編集)</p>
          </div>
          <Link href="/admin" className="btn flex items-center gap-1"><ArrowLeft size={14} />一覧へ</Link>
        </header>

        {searchParams.saved === "1" && <div className="card p-3 text-sm text-good">保存しました。以降の申込・課金に反映されます。</div>}
        {searchParams.saved === "0" && (
          <div className="card p-3 text-sm text-bad">
            保存に失敗しました。
            {searchParams.err ? <span className="block mt-1 font-mono text-xs break-all">理由: {searchParams.err}</span> : null}
          </div>
        )}

        <form action={saveSettingsAction} className="space-y-4">
          {/* プラン・金額 */}
          <section className="card p-4 space-y-3">
            <h2 className="font-semibold text-navy text-sm">プラン・金額</h2>
            <p className="text-[11px] text-muted">ID は LP の申込ボタン <span className="font-mono">?plan=ID</span> と一致させてください。空のIDの行は無視されます。</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted">
                    <th className="py-1 pr-2 font-medium">プランID</th>
                    <th className="py-1 pr-2 font-medium">表示名</th>
                    <th className="py-1 pr-2 font-medium">月額(円)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2"><input name="plan_id" defaultValue={p?.id ?? ""} placeholder="plus" className="input font-mono" /></td>
                      <td className="py-1 pr-2"><input name="plan_name" defaultValue={p?.name ?? ""} placeholder="暮らし安心プラス" className="input" /></td>
                      <td className="py-1 pr-2"><input name="plan_amount" type="number" min={0} defaultValue={p?.amount ?? ""} placeholder="1320" className="input w-28" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted flex items-center gap-1"><Plus size={11} />行が足りなければ保存後にまた空行が出ます。</p>
          </section>

          {/* 継続課金 */}
          <section className="card p-4 grid sm:grid-cols-2 gap-4">
            <h2 className="font-semibold text-navy text-sm sm:col-span-2">継続課金</h2>
            <label className="block">
              <div className="label mb-1">無料期間(申込月含む・ヶ月)</div>
              <input name="freeMonths" type="number" min={0} defaultValue={policy.freeMonths} className="input" />
              <p className="text-[10px] text-muted mt-1">2 = 利用開始月+翌月無料 → 翌々月から課金開始</p>
            </label>
            <label className="block">
              <div className="label mb-1">課金日(毎月・1〜28)</div>
              <input name="chargeDay" type="number" min={1} max={28} defaultValue={policy.chargeDay} className="input" />
              <p className="text-[10px] text-muted mt-1">毎月この日に引き落とし。以降の新規申込に適用（既存契約は現在の課金日を維持）</p>
            </label>
            <label className="block">
              <div className="label mb-1">解約ポリシー</div>
              <select name="cancelPolicy" defaultValue={policy.cancelPolicy} className="input">
                <option value="end_of_month">当月末まで利用可(翌月から停止)</option>
                <option value="immediate">即時停止</option>
              </select>
              <p className="text-[10px] text-muted mt-1">解約月の翌月から停止(規約準拠)が既定</p>
            </label>
            <label className="block">
              <div className="label mb-1">失敗リトライ間隔(日・カンマ区切り)</div>
              <input name="retryIntervalsDays" defaultValue={policy.retryIntervalsDays.join(",")} placeholder="1,3,7" className="input" />
            </label>
            <label className="block">
              <div className="label mb-1">リトライ上限(超過で停止)</div>
              <input name="retryMax" type="number" min={0} defaultValue={policy.retryMax} className="input" />
            </label>
            <label className="block">
              <div className="label mb-1">カード期限切れ判定コード(カンマ区切り)</div>
              <input name="cardExpiredCodes" defaultValue={policy.cardExpiredCodePrefixes.join(",")} placeholder="(検証環境で採取)" className="input" />
            </label>
            <label className="block">
              <div className="label mb-1">Cron 1回の最大処理数</div>
              <input name="cronBatchLimit" type="number" min={1} defaultValue={policy.cronBatchLimit} className="input" />
            </label>
          </section>

          {/* 通知・規約 */}
          <section className="card p-4 grid sm:grid-cols-2 gap-4">
            <h2 className="font-semibold text-navy text-sm sm:col-span-2">通知・規約</h2>
            <label className="block">
              <div className="label mb-1">申込通知先メール</div>
              <input name="notifyEmail" type="email" defaultValue={policy.notifyEmail ?? ""} placeholder="alliance@lifeap.co" className="input" />
              <p className="text-[10px] text-muted mt-1">送信には SMTP 設定が必要</p>
            </label>
            <label className="block">
              <div className="label mb-1">規約バージョン</div>
              <input name="termsVersion" defaultValue={policy.termsVersion} className="input" />
            </label>
          </section>

          {/* 登録完了メール (利用者宛) */}
          <section className="card p-4 space-y-3">
            <h2 className="font-semibold text-navy text-sm">登録完了メール(利用者へ送信)</h2>
            <p className="text-[11px] text-muted">
              申込完了直後に利用者のメールへ送ります(差出人は SMTP_FROM = 弊社アドレス)。使えるプレースホルダ:
              <span className="font-mono"> {"{name} {accountId} {planName} {amount} {serviceStartDate} {chargeStartDate}"}</span>
            </p>
            <label className="block">
              <div className="label mb-1">件名</div>
              <input name="welcome_subject" defaultValue={welcomeSubject} className="input w-full" />
            </label>
            <label className="block">
              <div className="label mb-1">本文</div>
              <textarea name="welcome_body" defaultValue={welcomeBody} rows={12} className="input w-full font-mono text-xs leading-relaxed" />
            </label>
          </section>

          <div className="flex justify-end">
            <button className="btn btn-primary flex items-center gap-2"><Save size={15} />保存</button>
          </div>
          <p className="text-[11px] text-muted">※ カード等の決済個人情報はこの設定にも一切含まれません。金額は次回課金分から反映されます。</p>
        </form>
      </div>
    </main>
  );
}
