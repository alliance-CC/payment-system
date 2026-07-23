// 特定商取引法に基づく表記。
//   継続課金 (サブスク) の申込ページから参照される。
//   価格・支払方法・提供時期・解約条件など「システムで確定している事実」は自動で埋め、
//   事業者名・所在地・責任者・連絡先など事業者固有の情報は環境変数 (設定値) から読む。
//   ※ 法的文面は創作せず、未設定項目は「(設定してください)」と明示する。
import { getPlans } from "@/features/payments/plans";

export const metadata = { title: "特定商取引法に基づく表記" };

const PLACEHOLDER = "（設定してください）";
function env(name: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : PLACEHOLDER;
}

export default function TokushoPage() {
  const plans = getPlans();
  const priceText = plans.length
    ? plans.map(p => `${p.name}: 月額 ¥${p.amount.toLocaleString()}（税込）`).join(" / ")
    : PLACEHOLDER;

  const rows: Array<[string, string]> = [
    ["販売事業者名", env("LEGAL_SELLER_NAME")],
    ["運営統括責任者", env("LEGAL_MANAGER_NAME")],
    ["所在地", env("LEGAL_ADDRESS")],
    ["電話番号", env("LEGAL_PHONE")],
    ["メールアドレス", env("LEGAL_EMAIL")],
    ["販売URL", env("LEGAL_SITE_URL")],
    ["販売価格", priceText],
    ["商品代金以外の必要料金", "決済に伴う費用は当社が負担します（通信費等はお客様のご負担となります）。"],
    ["支払方法", "クレジットカード（毎月の継続課金／自動決済）"],
    ["支払時期", "初回はお申し込み時、以降は毎月同日（契約開始日を基準）に自動決済されます。"],
    ["サービスの提供時期", "お申し込み・初回決済の完了後、直ちにご利用いただけます。"],
    ["解約・返金について",
      "解約のお申し出があるまで毎月自動で継続課金されます。解約はいつでも可能で、解約後は次回以降の課金を停止します。" +
      "サービスの性質上、決済済みの月分の返金は原則行いません（詳細は利用規約に従います）。"],
    ["動作環境", env("LEGAL_REQUIREMENTS")],
  ];

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-bold text-navy">特定商取引法に基づく表記</h1>
      <p className="text-sm text-muted">
        本ページは継続課金（サブスクリプション）サービスに関する表記です。
      </p>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-b border-border last:border-0 align-top">
                <th className="text-left bg-bg/60 p-3 w-40 font-medium whitespace-nowrap">{k}</th>
                <td className="p-3 text-ink whitespace-pre-line">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">
        「{PLACEHOLDER}」の項目は事業者情報の設定（環境変数）が未登録です。運営者が設定してください。
      </p>
    </main>
  );
}
