import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import { loadPaymentSettings } from "@/features/payments/payment-settings";

// 外部企業向けダッシュボード (/partner) の簡易認証。
//
// 管理ボード (/admin) とは完全に別系統:
//   ・Cookie が別 (管理者としてログインしても /partner には入れないし、その逆も同じ)
//   ・パスワードが別 (課金設定で発行し、外部企業へ渡す)
//   ・見せる項目も別 (お客様名/ご契約日/ご利用開始日/退会日/ご加入サービス名 のみ)
//
// パスワードの取得元: 課金設定 (DB) を優先し、無ければ環境変数 PARTNER_PASSWORD。
// 未設定なら誰も入れない (誤って全開放しない)。
//
// セッショントークンはパスワード自体を鍵にして導出する。
// → パスワードを変更すると、発行済みのセッションはすべて無効になる (取引先の入替え時に確実)。
export const PARTNER_COOKIE = "pay_partner";
export const PARTNER_MAX_AGE = 60 * 60 * 8; // 8時間

/** 設定されている外部ダッシュボードのパスワード (未設定なら空文字)。 */
export async function partnerPassword(): Promise<string> {
  const fromEnv = String(process.env.PARTNER_PASSWORD ?? "").trim();
  try {
    const s = await loadPaymentSettings();
    const fromDb = String(s.partnerPassword ?? "").trim();
    if (fromDb) return fromDb;
  } catch { /* DB不通なら env にフォールバック */ }
  return fromEnv;
}

/** ログイン成功時に Cookie へ入れる署名トークン (パスワードそのものは保存しない)。 */
export function partnerSessionToken(password: string): string {
  return createHmac("sha256", password || "memoreal-partner")
    .update("pay-partner-session-v1")
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function verifyPartnerPassword(input: string): Promise<boolean> {
  const pw = await partnerPassword();
  if (!pw) return false;                       // 未設定なら不許可
  // 保存時に trim しているので照合側も trim する。
  // コピー&ペーストで前後に空白や改行が付くことがあり、それだけで弾かれると
  // 「パスワードが違います」の原因が外部企業側からは分からないため。
  return safeEqual(String(input ?? "").trim(), pw);
}

export async function isPartnerAuthed(): Promise<boolean> {
  const pw = await partnerPassword();
  if (!pw) return false;
  const c = cookies().get(PARTNER_COOKIE)?.value;
  return !!c && safeEqual(c, partnerSessionToken(pw));
}

/** 保護ページ/アクションの先頭で呼ぶ。未認証なら /partner/login へ。 */
export async function requirePartner(): Promise<void> {
  if (!(await isPartnerAuthed())) redirect("/partner/login");
}

/** パスワードが設定済みか (管理画面のセットアップ案内用。公開画面では出さない)。 */
export async function partnerConfigured(): Promise<boolean> {
  return !!(await partnerPassword());
}
