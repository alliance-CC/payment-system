// 利用規約トップ。ご契約プランごとに規約を分けて掲載。
//   申込フロー(/subscribe)・LP からプラン別ページ(/legal/terms/plus|premium)へ導線。
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata = { title: "利用規約 — 株式会社ライフアップ" };

const PLANS = [
  { id: "plus", name: "暮らし安心プラス", desc: "近隣トラブル解決支援まもるん ／ ネットライフサポート", price: "月額 ¥1,320（税込）" },
  { id: "premium", name: "暮らし安心プレミアム", desc: "プラスの内容 ＋ データ復旧 ／ セキュリティ", price: "月額 ¥1,870（税込）" },
];

export default function TermsIndexPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10 md:py-14">
      <h1 className="text-2xl md:text-3xl font-bold text-navy">利用規約</h1>
      <p className="text-sm text-muted mt-2">
        ご契約（またはお申し込み予定）のプランに応じた利用規約をご確認ください。
      </p>

      <div className="grid gap-3 mt-6">
        {PLANS.map((p) => (
          <Link
            key={p.id}
            href={`/legal/terms/${p.id}`}
            className="card p-4 flex items-center justify-between gap-3 hover:border-navy/40 transition-colors"
          >
            <div>
              <div className="font-semibold text-navy">{p.name}の方はこちら</div>
              <div className="text-[12px] text-muted mt-0.5">{p.desc}</div>
              <div className="text-[12px] text-ink mt-1">{p.price}</div>
            </div>
            <ArrowRight size={18} className="text-accent shrink-0" />
          </Link>
        ))}
      </div>

      <div className="grid gap-3 mt-4">
        <Link
          href="/legal/terms/netlife"
          className="card p-4 flex items-center justify-between gap-3 hover:border-navy/40 transition-colors"
        >
          <div>
            <div className="font-semibold text-navy">ネットライフサポート 利用規約</div>
            <div className="text-[12px] text-muted mt-0.5">両プランに含まれるネット詐欺相談サービス＋ネット詐欺保険の規約（提供元：日本ＰＣサービス株式会社）</div>
          </div>
          <ArrowRight size={18} className="text-accent shrink-0" />
        </Link>
        <Link
          href="/legal/terms/virusbuster"
          className="card p-4 flex items-center justify-between gap-3 hover:border-navy/40 transition-colors"
        >
          <div>
            <div className="font-semibold text-navy">ウイルスバスター 利用規約</div>
            <div className="text-[12px] text-muted mt-0.5">プレミアムに含まれるセキュリティの規約（提供元：トレンドマイクロ株式会社）</div>
          </div>
          <ArrowRight size={18} className="text-accent shrink-0" />
        </Link>
      </div>

      <div className="mt-8 text-sm">
        <a href="https://lifeap.co.jp/tokutei/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">特定商取引法に基づく表記</a>
      </div>

      <div className="card p-4 mt-6 text-[13px] text-ink">
        <div className="font-semibold text-navy mb-1.5">事業者情報</div>
        <p>株式会社ライフアップ</p>
        <p className="text-muted">電話 <a href="tel:0367099237" className="text-accent hover:underline">03-6709-9237</a>（受付 11:00〜20:00／年末年始除く）</p>
      </div>
    </main>
  );
}
