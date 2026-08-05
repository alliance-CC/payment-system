// 単独の規約文書(プラン切替なし)を見やすく表示する共通ビュー。
//   ネットライフサポート等、提供元・引受保険会社が別のOEMサービス規約に使う。
//   目次(部→条アンカー)・部ごと大見出し・条ごと小見出し＋本文。列挙はインデント。
// 文言は支給された原文(terms-data.ts)を保持し、改変しない。
import Link from "next/link";
import { Info } from "lucide-react";
import type { DocTerms } from "./terms-data";
import CloseTabButton from "./CloseTabButton";

// 列挙・箇条書き始まりの行はぶら下げインデントで見やすくする
const ENUM = /^(（?[0-9０-９]+）|\([0-9０-９]+\)|[①-⑳]|[０-９1-9][．.]|[（(][ア-ンア-ヶ][）)]|★|・)/;

export type DocContact = { role: string; name: string; lines: string[] };

export default function DocTermsView({
  terms, fromSubscribe, lead, contacts,
}: {
  terms: DocTerms;
  fromSubscribe?: boolean;
  lead?: string;
  contacts: DocContact[];
}) {
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
      <h1 className="text-2xl md:text-3xl font-bold text-navy mt-2">{terms.serviceName} 利用規約</h1>
      {lead && <p className="text-[13px] text-muted mt-2">{lead}</p>}

      {/* リード文（前文） */}
      {terms.intro.length > 0 && (
        <div className="card p-4 mt-6 text-[13px] leading-relaxed text-ink space-y-2">
          {terms.intro.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      )}

      {/* 当社注記: 各社規約(単体販売前提)と当社パッケージの適用関係を整理する。
          規約本文とは別物であることが一目でわかるよう配色を変えて掲示する。 */}
      {terms.note && (
        <div className="mt-6 rounded-xl border-2 border-navy/25 bg-navy/[0.04] p-4">
          <div className="flex items-start gap-2">
            <Info size={16} className="text-navy shrink-0 mt-0.5" />
            <div className="font-semibold text-navy text-[13px]">{terms.note.heading}</div>
          </div>
          <ul className="mt-2 space-y-1.5 pl-1">
            {terms.note.paras.map((p, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink flex gap-2">
                <span className="text-navy/50 shrink-0">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted mt-2.5 pl-1">
            ※ 以下に掲載する規約本文は、提供元が定めた内容をそのまま掲載しています。
          </p>
        </div>
      )}

      {/* 目次 */}
      <nav className="card p-4 mt-6 text-sm">
        <div className="font-semibold text-navy mb-2">目次</div>
        <div className="space-y-3">
          {terms.parts.map((part, pi) => (
            <div key={pi}>
              <a href={`#part-${pi}`} className="font-medium text-ink hover:text-accent">{part.heading}</a>
              {part.articles.length > 0 && (
                <ul className="mt-1 ml-3 grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
                  {part.articles.map((a, ai) => (
                    <li key={ai}>
                      <a href={`#a-${pi}-${ai}`} className="text-[12px] text-muted hover:text-accent">{a.heading}</a>
                    </li>
                  ))}
                </ul>
              )}
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
              <p key={i} className={"text-[13px] leading-relaxed text-ink mb-3 " + (ENUM.test(p) ? "pl-4" : "")}>{p}</p>
            ))}
            {part.articles.map((a, ai) => (
              <article key={ai} id={`a-${pi}-${ai}`} className="mb-6 scroll-mt-20">
                <h3 className="font-bold text-ink mb-2">{a.heading}</h3>
                <div className="space-y-1.5">
                  {a.paras.map((p, i) => (
                    <p key={i} className={"text-[13px] leading-relaxed text-ink " + (ENUM.test(p) ? "pl-4" : "")}>{p}</p>
                  ))}
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>

      {/* 事業者・提供元・保険会社情報 */}
      <div className="card p-4 mt-8 text-[13px] text-ink">
        <div className="font-semibold text-navy mb-0.5">お問い合わせ・事業者情報</div>
        <p className="text-[11px] text-muted mb-2.5">
          お問い合わせ内容により窓口が異なります。下記のうち該当する窓口までご連絡ください。
        </p>
        <div className="space-y-3">
          {contacts.map((c, i) => (
            <div key={i}>
              <div className="text-[11px] text-muted">{c.role}</div>
              <div className="font-medium">{c.name}</div>
              {c.lines.map((l, j) => <div key={j} className="text-[12px] text-muted">{l}</div>)}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-3">
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
