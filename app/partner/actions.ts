"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  verifyPartnerPassword, partnerLoginReady, partnerSessionToken,
  PARTNER_COOKIE, PARTNER_MAX_AGE,
} from "@/features/partner/auth";

export async function partnerLoginAction(formData: FormData): Promise<void> {
  const input = String(formData.get("password") ?? "");

  // パスワード or 署名鍵が未設定なら、正しい入力でも通さない (中途半端に入れない)
  if (!(await partnerLoginReady())) redirect("/partner/login?e=2");

  // 「パスワードが違う」のか「そもそも未設定」なのかを分けて返す。
  // 同じ表示にしていると、設定漏れなのか入力ミスなのか切り分けられない。
  if (!(await verifyPartnerPassword(input))) redirect("/partner/login?e=1");

  cookies().set(PARTNER_COOKIE, partnerSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PARTNER_MAX_AGE,
  });
  redirect("/partner");
}

export async function partnerLogoutAction(): Promise<void> {
  cookies().delete(PARTNER_COOKIE);
  redirect("/partner/login");
}
