// プラン別の利用規約を「見やすく」表示する共通ビュー。
//   ・上部にプラン切替タブ / 目次(部→条アンカー)
//   ・部ごとに大見出し、条ごとに小見出し＋本文。列挙(①(1)(ア)等)はインデント。
//   ・事業者情報(株式会社ライフアップ / 03-6709-9237 / 11:00〜20:00)を明記。
// 文言は支給された確定版(terms-data.ts)を保持し、改変しない。
import Link from "next/link";
import type { PlanTerms } from "./terms-data";
import CloseTabButton from "./CloseTabButton";

// 列挙・箇条書き始まりの行はぶら下げインデントで見やすくする
const ENUM = /^(（?[0-9０-９]+）|\([0-9０-９]+\)|[①-⑳]|[０-９1-9][．.]|[（(][ア-ンア-ヶ][）)])/;

const TABS: { id: "plus" | "premium"; label: string }[] = [
  { id: "plus", label: "暮らし安心プラス" },
  { id: "premium", label: "暮らし安心プレミアム" },
];

export default function TermsView({ terms, fromSubscribe }: { terms: PlanTerms; fromSubscribe?: boolean }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 md:py-12">
      <div className="flex items-center gap-3 flex-wrap">
        {fromSubscribe && <CloseTabButton />}
        <Link href="/legal/terms" className="text-xs text-muted hover:text-ink">利用規約トップ</Link>
      </div>
      {fromSubscribe && (
        <p className="text-[11px] text-muted mt-1.5">
          ※ 確認できたら「お申し込みに戻る」を押すか、このタブを閉じてください。お申し込み画面の入力内容はそのまま残っています。
        </p>
      )}
      <h1 className="text-2xl md:text-3xl font-bold text-navy mt-2">{terms.serviceName} ご利用規約</h1>

      {/* プラン切替 */}
      <div className="flex gap-2 mt-4">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/legal/terms/${t.id}`}
            className={
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors " +
              (t.id === terms.planId
                ? "bg-navy text-white border-navy"
                : "border-border text-muted hover:text-ink hover:border-navy/40")
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* リード文 */}
      {terms.intro.length > 0 && (
        <div className="card p-4 mt-6 text-[13px] leading-relaxed text-ink space-y-2">
          {terms.intro.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}

      {/* 目次 */}
      <nav className="card p-4 mt-6 text-sm">
        <div className="font-semibold text-navy mb-2">目次</div>
        <div className="space-y-3">
          {terms.parts.map((part, pi) => (
            <div key={pi}>
              <a href={`#part-${pi}`} className="font-medium text-ink hover:text-accent">{part.heading}</a>
              <ul className="mt-1 ml-3 grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
                {part.articles.map((a, ai) => (
                  <li key={ai}>
                    <a href={`#a-${pi}-${ai}`} className="text-[12px] text-muted hover:text-accent">{a.heading}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* 本文 */}
      <div className="mt-8">
        {terms.parts.map((part, pi) => (
          <section key={pi} className="mb-10">
            <h2 id={`part-${pi}`} className="text-lg font-bold text-navy border-b border-border pb-1.5 mb-4 scroll-mt-20">
              {part.heading}
            </h2>
            {part.preamble.map((p, i) => (
              <p key={i} className="text-[13px] leading-relaxed text-ink mb-3">{p}</p>
            ))}
            {part.articles.map((a, ai) => (
              <article key={ai} id={`a-${pi}-${ai}`} className="mb-6 scroll-mt-20">
                <h3 className="font-bold text-ink mb-2">{a.heading}</h3>
                <div className="space-y-1.5">
                  {a.paras.map((p, i) => (
                    <p
                      key={i}
                      className={
                        "text-[13px] leading-relaxed text-ink " + (ENUM.test(p) ? "pl-4" : "")
                      }
                    >
                      {p}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>

      {/* 事業者情報 */}
      <div className="card p-4 mt-8 text-[13px] text-ink">
        <div className="font-semibold text-navy mb-1.5">事業者情報</div>
        <dl className="space-y-0.5">
          <div className="flex gap-2"><dt className="text-muted w-20 shrink-0">事業者名</dt><dd>株式会社ライフアップ</dd></div>
          <div className="flex gap-2"><dt className="text-muted w-20 shrink-0">電話番号</dt><dd><a href="tel:0367099237" className="text-accent hover:underline">03-6709-9237</a></dd></div>
          <div className="flex gap-2"><dt className="text-muted w-20 shrink-0">受付時間</dt><dd>11:00〜20:00（年末年始除く）</dd></div>
        </dl>
        <p className="text-[11px] text-muted mt-2">
          販売条件等の詳細は
          <a href="https://lifeap.co.jp/tokutei/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline mx-0.5">特定商取引法に基づく表記</a>
          をご覧ください。
        </p>
      </div>

      {terms.enacted && <p className="text-xs text-muted mt-4">{terms.enacted}</p>}

      {fromSubscribe && (
        <div className="mt-6">
          <CloseTabButton />
        </div>
      )}
    </main>
  );
}
