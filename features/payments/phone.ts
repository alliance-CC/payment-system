// 電話番号の表記統一 (ハイフン区切り)。
//
// 申込フォームはハイフン有無どちらでも入力できるため、外部へ出す値
// (連携スプレッドシート・CSV) はここで必ずハイフン付きに揃える。
// 副次的に、ハイフンが入ることで Excel が数値と解釈しなくなり、
// 先頭の 0 が落ちる問題も起きなくなる。
//
// 判定できない桁数・形式のものは、勝手に区切らず元の値をそのまま返す
// (誤った区切りで先方へ渡すより、入力どおりのほうが安全)。

/** 携帯・IP電話のプレフィックス (11桁: 3-4-4 区切り) */
const MOBILE_PREFIX = /^(070|080|090|050|060)/;

export function formatPhoneJp(raw: string | null | undefined): string {
  const src = String(raw ?? "").trim();
  if (!src) return "";

  // 全角数字・全角ハイフンを半角へ寄せてから数字だけを取り出す
  const normalized = src
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐－―ー−]/g, "-");
  const d = normalized.replace(/[^0-9]/g, "");
  if (!d) return src;                     // 数字が無い = 電話番号ではない

  // 国番号 +81 / 81 始まりは国内表記へ戻す (81-90-... → 090-...)
  const local = d.startsWith("81") && d.length >= 11 ? `0${d.slice(2)}` : d;

  if (local.length === 11) {
    // 0800 はフリーダイヤル。携帯の 080 より先に判定する
    // (0800 は着信課金用に確保されており、080-0xxx の携帯番号は割り当てられない)
    if (local.startsWith("0800")) return `${local.slice(0, 4)}-${local.slice(4, 7)}-${local.slice(7)}`;
    if (MOBILE_PREFIX.test(local)) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    if (local.startsWith("0120")) return `${local.slice(0, 4)}-${local.slice(4, 7)}-${local.slice(7)}`;
    // 東京(03)・大阪(06) は市外局番2桁
    if (/^0(3|6)/.test(local)) return `${local.slice(0, 2)}-${local.slice(2, 6)}-${local.slice(6)}`;
  }

  // 上記以外 (市外局番の桁数が特定できない固定電話など) は元の入力を尊重する。
  // 既にハイフンが入っていればそのまま、無ければ数字のまま返す。
  return normalized;
}
