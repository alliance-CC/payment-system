import { NextResponse } from "next/server";
import { replaceCard } from "@/features/payments/billing";
import { rateLimit, clientIpOf } from "@/shared/utils/rateLimit";

// カード更新 (§6-7)。洗替サービス無し (§0) のため顧客自身の再登録で差し替える。
//   - 新カードはブラウザで /4gtoken 化 → トークンのみ受け取る (PAN 非通過 §7)。
//   - 会員ID (accountId) はカード期限切れ通知の案内 URL (?account=...) から引き継ぐ。
//   - TODO(§10): 本人確認の強化 (電話番号の一致確認・ワンタイムリンク等)。
//     顧客メール取得要否の確定後、署名付きリンクでの誘導に置き換える。
export async function POST(req: Request) {
  // 電話番号の総当たりによる本人確認突破を防ぐため、IP 単位で厳しめに制限する
  const rl = rateLimit(`update-card:${clientIpOf(req)}`, { limit: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "too-many-requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const { accountId, token, tokenKey, phone } = await req.json().catch(() => ({}));
  if (!accountId || !token || !phone) {
    return NextResponse.json({ error: "accountId-token-phone-required" }, { status: 400 });
  }

  // 本人確認 (必須): 契約に登録済みの電話番号と一致しなければ拒否。
  // 会員IDだけで他人のカードを差し替えられないようにする (§7)。
  // TODO(§10): メール取得要否の確定後、署名付きワンタイムリンクへ強化。
  const { getContractByAccountId } = await import("@/features/payments/store");
  const contract = await getContractByAccountId(String(accountId));
  const norm = (s: string) => (s ?? "").replace(/[^0-9]/g, "");
  if (!contract || !contract.contact_phone || norm(contract.contact_phone) !== norm(String(phone))) {
    // 会員IDの存在探索 (列挙) を防ぐため not-found と検証失敗は同一応答にする
    return NextResponse.json({ error: "verification-failed" }, { status: 403 });
  }

  const result = await replaceCard({
    accountId: String(accountId),
    token: String(token),
    tokenKey: tokenKey ? String(tokenKey) : null,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === "contract-not-found" ? 403 : 402 });
  }
  return NextResponse.json(result);
}
