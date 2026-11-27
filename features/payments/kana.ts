// お客様のフリガナ (セイ・メイ)。申込画面・申込API・管理画面で同じ決まりを使う
// (片方だけ直して、画面では通るのに保存で弾かれる、を防ぐ)。
//
// 担当者 2026-11-27：プラス・プレミアムとも、先方 (nuworks) へ入れるのにセイ・メイが要る。
// 申込画面で聞き、全角カタカナにそろえて保存する。

/**
 * 全角カタカナにそろえる。
 *   ・半角カナ・全角英数などは NFKC で全角にする (ｾｲ → セイ)
 *   ・ひらがなはカタカナにする (やまだ → ヤマダ)
 *   ・空白は取り除く (セイ・メイは別々の欄で聞くので、1つの欄の中に空白は要らない)
 */
export function toKatakana(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[ぁ-ゖゝゞ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s　]+/g, "");
}

/** カタカナ (長音・中黒を含む) だけでできているか。空は false。 */
export function isKatakana(s: string): boolean {
  return /^[ァ-ヺー・ヽヾ]+$/.test(s);
}

/** 1つの欄の値を、保存できる形にする。カタカナにできなければ null。 */
export function normalizeKanaPart(raw: unknown): string | null {
  const s = toKatakana(String(raw ?? ""));
  return s && isKatakana(s) && s.length <= 50 ? s : null;
}

/** セイ・メイを、保存する1つの文字列にする (氏名の contact_name と同じく、半角空白で区切る)。 */
export function joinKana(last: string, first: string): string {
  return `${last} ${first}`.trim();
}

/** 保存した文字列 → セイ・メイ。未保存は両方空。 */
export function splitKana(saved: string | null | undefined): { last: string; first: string } {
  const s = String(saved ?? "").trim();
  if (!s) return { last: "", first: "" };
  const i = s.indexOf(" ");
  if (i < 0) return { last: s, first: "" };
  return { last: s.slice(0, i).trim(), first: s.slice(i + 1).trim() };
}
