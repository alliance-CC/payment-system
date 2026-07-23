"use client";
// ブラウザ → VeriTrans /4gtoken のカードトークン化 (§2/§3)。
// カード番号・セキュリティコードは VeriTrans へ直送し、自社サーバーへは送らない (§7)。
//
// 2026-07-11 MDK トークン開発ガイド (docs/credit/token_guide.html) と照合済み:
//   - リクエスト: { token_api_key, card_number, card_expire ("MM/YY"), security_code, lang }
//     (cardholder_name は任意)
//   - レスポンス: { token, token_expire_date, req_card_number, status, code, message }
//     ※ token_key フィールドは存在しない (旧実装の想定を訂正)
//   - トークンはワンタイム・有効期限15分
//   - 結果コードは「MDKトークン結果コード一覧」(docs/mdk_guide/token_list.html)

export type CardInput = {
  number: string;
  expMonth: string;   // "MM"
  expYear: string;    // "YYYY" または "YY"
  cvc: string;
};

export type TokenizeResult =
  | { ok: true; token: string; tokenKey?: string }
  | { ok: false; error: string };

export async function tokenizeCard(
  tokenUrl: string,
  tokenApiKey: string,
  card: CardInput,
): Promise<TokenizeResult> {
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token_api_key: tokenApiKey,
        card_number: card.number.replace(/\s/g, ""),
        // 公式仕様は "MM/YY" (例 "01/20")。西暦4桁入力は下2桁に丸める
        card_expire: `${card.expMonth.padStart(2, "0")}/${card.expYear.slice(-2)}`,
        security_code: card.cvc,
        lang: "ja",
      }),
    });
    const json = await res.json().catch(() => null);
    if (json?.status !== "success" || !json?.token) {
      return { ok: false, error: `トークン化に失敗しました (${json?.message ?? json?.code ?? "不明"})` };
    }
    return { ok: true, token: json.token };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
