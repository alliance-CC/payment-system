"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  verifyPartnerPassword, partnerPassword, partnerSessionToken,
  PARTNER_COOKIE, PARTNER_MAX_AGE,
} from "@/features/partner/auth";

export async function partnerLoginAction(formData: FormData): Promise<void> {
  const pw = String(formData.get("password") ?? "");
  if (!(await verifyPartnerPassword(pw))) redirect("/partner/login?e=1");

  cookies().set(PARTNER_COOKIE, partnerSessionToken(await partnerPassword()), {
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
