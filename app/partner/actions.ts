"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  verifyPartnerPassword, partnerConfigured, partnerSessionToken,
  PARTNER_COOKIE, PARTNER_MAX_AGE,
} from "@/features/partner/auth";

export async function partnerLoginAction(formData: FormData): Promise<void> {
  const input = String(formData.get("password") ?? "");

  if (!(await verifyPartnerPassword(input))) {
    // 「パスワードが違う」のか「そもそも未設定」なのかを分けて返す。
    // 同じ表示にしていると、設定漏れなのか入力ミスなのか切り分けられない。
    const configured = await partnerConfigured();
    redirect(`/partner/login?e=${configured ? "1" : "2"}`);
  }

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
