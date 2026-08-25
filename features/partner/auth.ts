import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";
import { loadPaymentSettings } from "@/features/payments/payment-settings";

// 外部企業向けダッシュボード (/partner) の簡易認証。
//
// 管理ボード (/admin) とは別系統: Cookie もパスワードも別で、
// 管理者としてログインしても /partner には入れないし、その逆も同じ。
//
// パスワードの取得元: 課金設定 (DB) を優先し、無ければ環境変数 PARTNER_PASSWORD。
// 未設定なら誰も入れない (誤って全開放しない)。
//
// ⚠️ ログイン後の判定 (isPartnerAuthed) は DB を読まない。
//    Cookie の署名を照合するだけにしてある — ここで設定の読み込みに失敗すると
//    「ログインは通るのに一覧に入れない」という原因の分かりにくい状態になるため。
//    パスワードの照合はログイン時の1回だけ行う。
export const PARTNER_COOKIE = "pay_partner";
export const PARTNER_MAX_AGE = 60 * 60 * 8; // 8時間

/** 設定されている外部ダッシュボードのパスワード (未設定なら空文字)。 */
export async function partnerPassword(): Promise<string> {
  try {
    const s = await loadPaymentSettings();
    const fromDb = String(s.partnerPassword ?? "").trim();
    if (fromDb) return fromDb;
  } catch { /* DB不通なら env にフォールバック */ }
  return String(process.env.PARTNER_PASSWORD ?? "").trim();
}

/** セッション Cookie の署名鍵。どれも未設定なら空 (= セッションを発行しない)。 */
function sessionSecret(): string {
  return (
    process.env.PARTNER_SESSION_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    ""
  );
}

/**
 * Cookie に入れる署名トークン。パスワードそのものは保存しない。
 * 署名鍵が無い場合は空文字を返す — 固定の既定値で署名すると、
 * ソースを知る者が Cookie を偽造できてしまうため、鍵が無いときは誰も通さない。
 */
export function partnerSessionToken(): string {
  const secret = sessionSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update("pay-partner-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** ログイン時のパスワード照合。保存側と同じく前後の空白は無視する
 *  (コピー&ペーストで空白や改行が付くだけで弾かれないように)。 */
export async function verifyPartnerPassword(input: string): Promise<boolean> {
  const pw = await partnerPassword();
  if (!pw) return false;                       // 未設定なら不許可
  return safeEqual(String(input ?? "").trim(), pw);
}

/** ログイン済みか。Cookie の署名照合のみ (DBアクセス無し)。 */
export function isPartnerAuthed(): boolean {
  const token = partnerSessionToken();
  if (!token) return false;                    // 署名鍵が無ければ誰も通さない
  const c = cookies().get(PARTNER_COOKIE)?.value;
  return !!c && safeEqual(c, token);
}

/** ログインを受け付けられる状態か (パスワードと署名鍵が両方そろっている)。 */
export async function partnerLoginReady(): Promise<boolean> {
  return !!sessionSecret() && !!(await partnerPassword());
}

/** 保護ページの先頭で呼ぶ。未認証なら /partner/login へ。 */
export function requirePartner(): void {
  if (!isPartnerAuthed()) redirect("/partner/login");
}

/** パスワードが設定済みか (管理画面の案内・ログイン失敗理由の切り分け用)。 */
export async function partnerConfigured(): Promise<boolean> {
  return !!(await partnerPassword());
}
