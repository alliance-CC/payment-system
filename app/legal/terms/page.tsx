// 利用規約ページ。支給された規約本文 (terms-content.ts) をそのまま表示する。
//   ・「（見出し）」だけの行 → 見出し
//   ・「A | B | C」の連続行 → 表
//   ・「第◯章」等の章題 → 大見出し
//   ※ 申込画面 (/subscribe) から別タブで開き、確認後に同意チェックする導線。
import { TERMS_TEXT } from "./terms-content";

export const metadata = { title: "利用規約 — ネットライフサポート" };

type Block =
  | { t: "chapter"; text: string }
  | { t: "heading"; text: string }
  | { t: "para"; text: string }
  | { t: "table"; rows: string[][] };

function parse(text: string): Block[] {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  const blocks: Block[] = [];
  let tableRows: string[][] | null = null;
  const flush = () => { if (tableRows && tableRows.length) blocks.push({ t: "table", rows: tableRows }); tableRows = null; };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.includes(" | ")) {
      const cells = line.split("|").map((c) => c.trim()).filter((_, i, a) => !(i === a.length - 1 && a[i] === ""));
      (tableRows ??= []).push(cells);
      continue;
    }
    flush();
    if (/^(第[０-９0-9一二三四五六七八九十]+章|総則|サービス利用規約)/.test(line) && line.length < 30) {
      blocks.push({ t: "chapter", text: line });
    } else if (/^（.+）$/.test(line)) {
      blocks.push({ t: "heading", text: line });
    } else {
      blocks.push({ t: "para", text: line });
    }
  }
  flush();
  return blocks;
}

export default function TermsPage() {
  const blocks = parse(TERMS_TEXT);
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-3">
      <h1 className="text-2xl font-bold text-navy mb-2">利用規約</h1>
      {blocks.map((b, i) => {
        if (b.t === "chapter")
          return <h2 key={i} className="text-lg font-bold text-navy mt-6 pt-2 border-t border-border">{b.text}</h2>;
        if (b.t === "heading")
          return <h3 key={i} className="text-sm font-semibold text-navy mt-4">{b.text}</h3>;
        if (b.t === "table")
          return (
            <div key={i} className="overflow-x-auto my-2">
              <table className="w-full text-xs border border-border">
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri} className={ri === 0 ? "bg-bg/60 font-medium" : ""}>
                      {r.map((c, ci) => (
                        <td key={ci} className="border border-border p-2 whitespace-pre-line align-top">{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return <p key={i} className="text-[13px] leading-relaxed text-ink">{b.text}</p>;
      })}
    </main>
  );
}
