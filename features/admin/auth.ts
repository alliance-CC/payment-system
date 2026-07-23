import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "crypto";

// 管理ボードの簡易認証 (単一の共有パスワード)。
//   ADMIN_PASSWORD         … ログインパスワード (必須。未設定なら誰も入れない=安全側)
//   ADMIN_SESSION_SECRET   … セッション署名鍵 (任意。未設定なら ADMIN_PASSWORD から導出)
// カード等の決済個人情報は一切扱わない (§7)。Cookie は署名トークンのみ。
export const ADMIN_COOKIE = "pay_admin";
export const ADMIN_MAX_AGE = 60 * 60 * 8; // 8時間

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "";
}
function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "memoreal-payments";
}

/** ログイン成功時に Cookie へ入れるセッショントークン (パスワードそのものは保存しない) */
export function sessionToken(): string {
  return createHmac("sha256", sessionSecret()).update("pay-admin-session-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyPassword(input: string): boolean {
  const pw = adminPassword();
  if (!pw) return false; // パスワード未設定なら不許可 (誤って全開放しない)
  return safeEqual(String(input ?? ""), pw);
}

export function isAuthed(): boolean {
  if (!adminPassword()) return false;
  const c = cookies().get(ADMIN_COOKIE)?.value;
  return !!c && safeEqual(c, sessionToken());
}

/** 保護ページ/アクションの先頭で呼ぶ。未認証なら /admin/login へ。 */
export function requireAdmin(): void {
  if (!isAuthed()) redirect("/admin/login");
}

/** ADMIN_PASSWORD が未設定か (セットアップ案内の表示用) */
export function adminConfigured(): boolean {
  return !!adminPassword();
}
