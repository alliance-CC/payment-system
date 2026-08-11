"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword, sessionToken, requireAdmin, ADMIN_COOKIE, ADMIN_MAX_AGE } from "@/features/admin/auth";
import { cancelSubscription } from "@/features/payments/billing";
import { hardDeleteContractByAccountId, getContractByAccountId, updateContractRow } from "@/features/payments/store";
import { loadPlan } from "@/features/payments/plans";
import { chargeByAccount, deleteAccount } from "@/features/payments/veritrans/paynowid";
import { loadVeritransConfig } from "@/features/payments/veritrans/config";
import { savePaymentSettings, loadPaymentSettings, type PaymentSettings } from "@/features/payments/payment-settings";

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

// 顧客ごとのプラン変更。契約の plan_id/plan_name/amount を書き換えるだけ。
//   継続課金は課金時に contracts.amount を参照するため、VeriTrans側の作り直しは不要。
//   反映: 無料期間中=初回課金が新料金 / 課金開始後=翌月分から新料金 (当月・過去分は変えない)。
export async function changePlanAction(formData: FormData): Promise<void> {
  requireAdmin();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const planId = String(formData.get("planId") ?? "").trim();
  const month = String(formData.get("month") ?? "");
  const to = (s: string) => `/admin?${month ? `month=${encodeURIComponent(month)}&` : ""}plan=${s}`;

  if (!accountId || !planId) redirect(to("err"));
  const contract = await getContractByAccountId(accountId);
  if (!contract) redirect(to("notfound"));
  if (contract.status === "canceled") redirect(to("canceled"));
  if (contract.plan_id === planId) redirect(to("same"));
  const plan = await loadPlan(planId);
  if (!plan) redirect(to("noplan"));

  try {
    await updateContractRow(contract.id, { plan_id: plan.id, plan_name: plan.name, amount: plan.amount });
  } catch {
    redirect(to("err"));
  }
  redirect(to("ok"));
}

// 動作テスト課金 (検証用)。登録済みカードに単発の都度決済を実行し、
//   「会員登録+カード登録が“後から課金できる形”で成立しているか」を実機確認する。
//   ・本番環境(VT_PRODUCTION=true)では実行不可(実際に課金してしまうため)。
//   ・請求スケジュールとは別の一意orderIdを使い、payment_charges には記録しない。
export async function testChargeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const month = String(formData.get("month") ?? "");
  const to = (s: string, extra = "") => `/admin?${month ? `month=${encodeURIComponent(month)}&` : ""}testcharge=${s}${extra}`;

  if (String(process.env.VT_PRODUCTION ?? "").toLowerCase() === "true") redirect(to("prod"));
  if (!accountId) redirect(to("err"));
  const contract = await getContractByAccountId(accountId);
  if (!contract) redirect(to("notfound"));
  const cfg = await loadVeritransConfig(contract.tenant_id);
  if (!cfg.merchantCcid || !cfg.merchantKey) redirect(to("noconfig"));

  const orderId = `${accountId}_verify_${Date.now()}`;
  let ok = false, code = "";
  try {
    const r = await chargeByAccount(
      { accountId, orderId, amount: contract.amount, freeKey: contract.customer_id ?? undefined },
      cfg,
    );
    ok = !!r.ok;
    code = r.vResultCode ?? (r.transportError ? "TRANSPORT" : "");
  } catch (e: any) {
    ok = false;
    code = String(e?.message ?? e).slice(0, 40);
  }
  redirect(to(ok ? "ok" : "fail", code ? `&code=${encodeURIComponent(code)}` : ""));
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

  // ③ 決済代行側の後始末: DBから消すだけだと VeriTrans に会員とカードが残り続ける。
  //    案件を消す=その顧客の登録を無かったことにする、なので会員データも削除する。
  //    失敗しても DB 削除は続行する (VT 側は管理画面から手動削除できる)。
  const contract = await getContractByAccountId(accountId);
  if (contract) {
    const cfg = await loadVeritransConfig(contract.tenant_id);
    const vt = await deleteAccount(accountId, cfg).catch(() => null);
    if (!vt?.ok) {
      console.error("[admin/delete] VeriTrans account delete failed (DB削除は継続):",
        accountId, vt?.vResultCode ?? "no-response");
    }
  }

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
    chargeDay: Math.min(28, Math.max(1, num("chargeDay", 1))),
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
    // ①②③ 連携スプレッドシート。在庫集計(licenseStock)は Cron が書き込むため
    // ここでは編集せず既存値を引き継ぐ (管理画面の保存で消さない)。
    signupSheetId: String(formData.get("signupSheetId") ?? "").trim() || null,
    licenseStock: (await loadPaymentSettings()).licenseStock ?? null,
  };
  const res = await savePaymentSettings(settings);
  if (res.ok) redirect("/admin/settings?saved=1");
  redirect(`/admin/settings?saved=0&err=${encodeURIComponent(res.error ?? "unknown")}`);
}
