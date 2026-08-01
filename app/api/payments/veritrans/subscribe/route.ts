import { NextResponse } from "next/server";
import { registerSubscription, start3dsSubscription } from "@/features/payments/billing";
import { loadBillingPolicy } from "@/features/payments/billing-config";
import { createSupabaseService } from "@/shared/db/service";
import { rateLimit, clientIpOf } from "@/shared/utils/rateLimit";

// 継続課金の申込 (§1.1 フル: 同意 → 氏名/電話 → 支払方法 → 登録 → CRM → 通知)。
//   - オープン申込 (§0) のため認証は課さない。IP 単位のレート制限で連打/bot の
//     一次防壁とする (§10。厳密化が必要なら共有ストア型に置き換え)。
//   - 金額はサーバー側でプラン定義から決定 (§7: クライアントを信用しない)。
//   - カード番号は非通過 (§2)。ブラウザで /4gtoken 化したトークンのみ受け取る。
//   - OEM (§1.2): ?tenant=<slug> で申込先テナントを解決。無指定は既定テナント。
export async function POST(req: Request) {
  const rl = rateLimit(`subscribe:${clientIpOf(req)}`, { limit: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "too-many-requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }
  const body = await req.json().catch(() => ({}));
  const { planId, name, phone, email, token, tokenKey, caseId, consentAccepted, tenantSlug, serviceStartDate, cardholderName } = body ?? {};

  if (!consentAccepted) {
    return NextResponse.json({ error: "consent-required" }, { status: 400 });
  }
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "token-required" }, { status: 400 });
  }
  const nameStr = String(name ?? "").trim();
  const phoneStr = String(phone ?? "").trim();
  if (!nameStr || !phoneStr) {
    return NextResponse.json({ error: "name-and-phone-required" }, { status: 400 });
  }
  // メールは必須 (登録完了メールの送信先 §②)
  const emailStr = String(email ?? "").trim();
  if (!emailStr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailStr)) {
    return NextResponse.json({ error: "email-required" }, { status: 400 });
  }

  // OEM: テナント slug → id 解決 (公開ページなので service role で slug のみ検索)
  let tenantId: string | null = null;
  if (tenantSlug && typeof tenantSlug === "string") {
    const service = createSupabaseService();
    const { data } = await service.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
    if (!data?.id) return NextResponse.json({ error: "unknown-tenant" }, { status: 400 });
    tenantId = data.id as string;
  }

  const policy = await loadBillingPolicy();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  const subscribeInput = {
    tenantId,
    planId: String(planId ?? ""),
    name: nameStr.slice(0, 100),
    phone: phoneStr.slice(0, 30),
    email: emailStr.slice(0, 200),
    paymentMethod: "card" as const,
    token,
    tokenKey: tokenKey ? String(tokenKey) : null,
    caseId: caseId ? String(caseId).slice(0, 100) : null,
    serviceStartDate: serviceStartDate ? String(serviceStartDate).slice(0, 10) : null,
    consent: {
      termsVersion: policy.termsVersion,
      ip,
      userAgent: req.headers.get("user-agent"),
    },
  };

  // 3DS (§6-4): 有効時は同期完結せず、ACS 認証画面への遷移情報を返す。
  // 契約の有効化は認証完了後 (mpi-result / mpi-return → finalizeMpiOrder)。
  if (policy.use3ds) {
    // カード名義 (半角ローマ字) はブランドルール必須 (3DS ガイド 4.2.2)
    const holder = String(cardholderName ?? "").trim();
    if (holder.length < 2) {
      return NextResponse.json({ error: "cardholder-name-required" }, { status: 400 });
    }
    const started = await start3dsSubscription({
      ...subscribeInput,
      cardholderName: holder.slice(0, 45),
    });
    if (!started.ok) {
      const status = started.error === "charge-failed" ? 402
        : started.error === "veritrans-not-configured" || started.error === "app-url-not-configured" ? 503
        : 400;
      return NextResponse.json(started, { status });
    }
    return NextResponse.json({
      ok: true, mode: "3ds",
      accountId: started.accountId, orderId: started.orderId,
      redirect: started.redirect ?? null,
      contents: started.contents ?? null,
    });
  }

  const result = await registerSubscription(subscribeInput);

  if (!result.ok) {
    const status = result.error === "charge-failed" ? 402
      : result.error === "veritrans-not-configured" ? 503
      : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
