"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword, sessionToken, requireAdmin, ADMIN_COOKIE, ADMIN_MAX_AGE } from "@/features/admin/auth";
import { cancelSubscription } from "@/features/payments/billing";

export async function loginAction(formData: FormData): Promise<void> {
  const pw = String(formData.get("password") ?? "");
  if (!verifyPassword(pw)) redirect("/admin/login?e=1");
  cookies().set(ADMIN_COOKIE, sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_MAX_AGE,
  });
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  cookies().delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

// 解約 (管理画面から)。VeriTrans 会員削除 + 契約 canceled + 次回課金停止。
// 「退会手続き当月末日まで利用可」(§規約) は cancelSubscription が effectiveUntil を返す。
export async function cancelAction(formData: FormData): Promise<void> {
  requireAdmin();
  const accountId = String(formData.get("accountId") ?? "").trim();
  if (accountId) await cancelSubscription(accountId);
  const month = String(formData.get("month") ?? "");
  redirect(`/admin${month ? `?month=${encodeURIComponent(month)}` : ""}`);
}
