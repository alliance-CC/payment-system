"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword, sessionToken, requireAdmin, ADMIN_COOKIE, ADMIN_MAX_AGE } from "@/features/admin/auth";
import { cancelSubscription } from "@/features/payments/billing";
import { hardDeleteContractByAccountId } from "@/features/payments/store";
import { savePaymentSettings, type PaymentSettings } from "@/features/payments/payment-settings";

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

// 案件の完全削除 (テスト案件のクリーンアップ用)。DBから物理削除・取り消し不可。
//   二重の歯止め: ①確認入力(会員ID一致) ②本番環境では PAYMENTS_ALLOW_DELETE=true が必須。
export async function deleteAction(formData: FormData): Promise<void> {
  requireAdmin();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();
  const month = String(formData.get("month") ?? "");
  const to = (status: string) => `/admin?${month ? `month=${encodeURIComponent(month)}&` : ""}del=${status}`;

  // ① 確認: 入力された会員IDが対象と一致しない削除は実行しない
  if (!accountId || confirm !== accountId) redirect(to("mismatch"));

  // ② 本番ガード: 本番環境 (VT_PRODUCTION=true) では PAYMENTS_ALLOW_DELETE=true が無い限り削除不可
  const isProd = String(process.env.VT_PRODUCTION ?? "").toLowerCase() === "true";
  const allowDelete = String(process.env.PAYMENTS_ALLOW_DELETE ?? "").toLowerCase() === "true";
  if (isProd && !allowDelete) redirect(to("blocked"));

  const res = await hardDeleteContractByAccountId(accountId);
  redirect(to(res.ok ? "ok" : "err"));
}

// 課金設定の保存 (金額/プラン・無料期間・継続課金・解約ポリシー)。DB(integrations)へ。
export async function saveSettingsAction(formData: FormData): Promise<void> {
  requireAdmin();
  const ids = formData.getAll("plan_id").map(String);
  const names = formData.getAll("plan_name").map(String);
  const amounts = formData.getAll("plan_amount").map(String);
  const plans = ids
    .map((id, i) => ({
      id: id.trim(),
      name: (names[i] ?? "").trim(),
      amount: Math.max(0, parseInt(amounts[i] ?? "0", 10) || 0),
      cycle: "monthly" as const,
    }))
    .filter((p) => p.id && p.name);

  const num = (k: string, d: number) => {
    const v = parseInt(String(formData.get(k) ?? ""), 10);
    return Number.isFinite(v) ? v : d;
  };
  const list = (k: string) =>
    String(formData.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const settings: PaymentSettings = {
    plans,
    freeMonths: Math.max(0, num("freeMonths", 2)),
    retryIntervalsDays: list("retryIntervalsDays").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0),
    retryMax: Math.max(0, num("retryMax", 3)),
    cardExpiredCodes: list("cardExpiredCodes"),
    cronBatchLimit: Math.max(1, num("cronBatchLimit", 200)),
    notifyEmail: String(formData.get("notifyEmail") ?? "").trim() || null,
    termsVersion: String(formData.get("termsVersion") ?? "").trim() || "2026-07-01",
    cancelPolicy: String(formData.get("cancelPolicy")) === "immediate" ? "immediate" : "end_of_month",
    welcomeEmail: {
      subject: String(formData.get("welcome_subject") ?? "").trim(),
      body: String(formData.get("welcome_body") ?? "").trim(),
    },
  };
  const res = await savePaymentSettings(settings);
  if (res.ok) redirect("/admin/settings?saved=1");
  redirect(`/admin/settings?saved=0&err=${encodeURIComponent(res.error ?? "unknown")}`);
}
