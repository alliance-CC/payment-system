"use client";
// 継続課金の申込フロー (§1.1 確定):
//   1. プラン選択 → 2. 同意 → 3. 氏名・電話(+メール任意) → 4. 支払方法 → 5. カード入力 → 完了
// カード番号は tokenize.ts でブラウザ→VeriTrans 直送 (サーバー非通過 §2/§7)。
import { useState } from "react";
import {
  CreditCard, Loader2, CheckCircle2, AlertCircle, Lock,
  Landmark, ChevronRight, ChevronLeft,
} from "lucide-react";
import { tokenizeCard } from "./tokenize";

type Plan = { id: string; name: string; amount: number };

const STEPS = ["プラン", "同意", "お客様情報", "お支払い"] as const;

// カード番号を数字のみ・4桁ごとにスペース区切りへ整形 (最大19桁)。
// 送信時は tokenize.ts 側でスペースを除去する
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

// 既定のご利用開始日 = 申込月の翌月1日 (JST)。
function defaultServiceStart(): string {
  const now = new Date(Date.now() + 9 * 3600_000);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}
function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

export default function SignupFlow({
  plans, tokenApiKey, tokenUrl, configured, termsVersion, caseId, tenantSlug, initialPlanId,
}: {
  plans: Plan[];
  tokenApiKey: string;
  tokenUrl: string;
  configured: boolean;
  termsVersion: string;
  caseId?: string;
  tenantSlug?: string;
  /** LP の申込ボタンから ?plan= で渡されたプラン。有効ならプラン選択を省略して同意から開始 */
  initialPlanId?: string;
}) {
  // LP でプランを選んで来た場合 (?plan=plus 等) はプラン選択ステップを飛ばす
  const planLocked = !!(initialPlanId && plans.some((p) => p.id === initialPlanId));
  const [step, setStep] = useState(planLocked ? 1 : 0);
  const [planId, setPlanId] = useState(
    planLocked ? initialPlanId! : (plans[0]?.id ?? ""),
  );
  const [agreed, setAgreed] = useState(false);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const fullName = `${lastName.trim()} ${firstName.trim()}`.trim();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceStart, setServiceStart] = useState(defaultServiceStart());
  const [method, setMethod] = useState<"card" | "bank">("card");
  const [number, setNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ accountId: string; nextChargeDate: string } | null>(null);

  const plan = plans.find((p) => p.id === planId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // 1. カードトークン化 (ブラウザ → VeriTrans 直送 §2)
      const tok = await tokenizeCard(tokenUrl, tokenApiKey, { number, expMonth, expYear, cvc });
      if (!tok.ok) { setError(tok.error); return; }

      // 2. 申込 (サーバーが 会員登録+初回課金+CRM反映+通知 を実行 §1.1-5,6)
      const res = await fetch("/api/payments/veritrans/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId, name: fullName, phone, email,
          serviceStartDate: serviceStart,
          token: tok.token, tokenKey: tok.tokenKey,
          consentAccepted: agreed,
          caseId: caseId || null,
          tenantSlug: tenantSlug || null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const code = json?.vResultCode ? ` (コード: ${json.vResultCode})` : "";
        const msg = json?.error === "already-subscribed"
          ? "この案件は既にお申し込み済みです"
          : json?.error === "charge-pending"
          ? "決済結果の確認に時間がかかっています。恐れ入りますが、再度お申し込みはせず、お電話にてお問い合わせください"
          : json?.error === "too-many-requests"
          ? "アクセスが集中しています。しばらく待ってから再度お試しください"
          : json?.error === "email-required"
          ? "メールアドレスをご入力ください"
          : `お申し込みに失敗しました${code}`;
        // 検証時の原因特定用: VeriTrans の詳細メッセージがあれば併記
        setError(json?.vtDetail ? `${msg}\n詳細: ${json.vtDetail}` : msg);
        return;
      }
      setDone({ accountId: json.accountId, nextChargeDate: json.nextChargeDate });
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 size={40} className="text-good" />
        <h2 className="text-lg font-semibold">お申し込みが完了しました</h2>
        <p className="text-sm text-muted">会員ID: <span className="font-mono">{done.accountId}</span></p>
        <p className="text-xs text-muted">次回のお引き落とし日: {done.nextChargeDate}</p>
        <p className="text-[11px] text-muted">会員IDはお問い合わせ時に必要です。お控えください。</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="card p-6 flex items-start gap-3 text-sm">
        <AlertCircle size={18} className="text-bad shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">決済設定が未完了です</p>
          <p className="text-muted mt-1">
            VeriTrans の CCID / Merchant Key / Token API Key を環境変数または /admin/integrations で設定してください。
          </p>
        </div>
      </div>
    );
  }

  const canNext =
    step === 0 ? !!plan :
    step === 1 ? agreed :
    step === 2 ? lastName.trim() !== "" && firstName.trim() !== "" && phone.trim() !== "" && isEmail(email) && !!serviceStart :
    true;

  // プラン確定 (LP 由来) 時は プラン選択ステップ(0) を隠す。最小ステップは 1
  const minStep = planLocked ? 1 : 0;
  const visibleSteps = planLocked ? STEPS.slice(1) : STEPS;

  return (
    <form onSubmit={submit} className="card p-6 space-y-5">
      {/* プラン確定バナー (LP で選択済みのとき) */}
      {planLocked && plan && (
        <div className="flex items-center justify-between rounded-xl border border-navy/30 bg-navy/5 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 size={15} className="text-navy" />
            <span className="font-medium">{plan.name}</span>
          </div>
          <span className="text-sm font-semibold">月額 ¥{plan.amount.toLocaleString()}</span>
        </div>
      )}

      {/* ステップインジケータ (プラン確定時は「同意」から表示) */}
      <ol className="flex items-center gap-1 text-[11px] text-muted">
        {visibleSteps.map((s, vi) => {
          const i = vi + minStep;
          return (
            <li key={s} className="flex items-center gap-1">
              <span className={
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold " +
                (i === step ? "bg-navy text-white" : i < step ? "bg-good/15 text-good" : "bg-bg text-muted")
              }>{vi + 1}</span>
              <span className={i === step ? "text-ink font-medium" : ""}>{s}</span>
              {vi < visibleSteps.length - 1 && <ChevronRight size={11} className="text-muted/50" />}
            </li>
          );
        })}
      </ol>

      {/* 1. プラン選択 (§1.1-1) */}
      {step === 0 && (
        <div className="space-y-2">
          {plans.map((p) => (
            <label key={p.id} className={
              "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors " +
              (planId === p.id ? "border-navy bg-navy/5" : "border-border hover:border-navy/40")
            }>
              <input type="radio" name="plan" value={p.id} checked={planId === p.id}
                onChange={() => setPlanId(p.id)} className="accent-current" />
              <span className="flex-1 text-sm font-medium">{p.name}</span>
              <span className="text-sm font-semibold">月額 ¥{p.amount.toLocaleString()}</span>
            </label>
          ))}
        </div>
      )}

      {/* 2. 同意 (§1.1-2)。規約は別ページ (LP内) で確認してもらい、戻ってチェックする導線 */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="card bg-bg/50 p-4 space-y-3 text-sm">
            <p>お申し込みの前に、下記の内容を必ずご確認ください。</p>
            <div className="flex flex-col gap-2">
              <a href="/legal/terms" target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 text-accent underline font-medium">
                利用規約を確認する（別ウィンドウで開きます）
              </a>
              <a href="/legal/tokusho" target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 text-accent underline font-medium">
                特定商取引法に基づく表記を確認する
              </a>
            </div>
            <p className="text-[11px] text-muted">
              本サービスは毎月の継続課金（自動課金）です。解約のお申し出があるまで課金は継続され、
              解約はいつでも可能です（規約バージョン: {termsVersion}）。
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>利用規約および特定商取引法に基づく表記の内容を確認し、同意します</span>
          </label>
        </div>
      )}

      {/* 3. 氏名・電話・メール(必須)・ご利用開始日 (§①②) */}
      {step === 2 && (
        <div className="space-y-3">
          <div>
            <div className="label">お名前 *</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input w-full" value={lastName} onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name" placeholder="姓（山田）" required />
              <input className="input w-full" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name" placeholder="名（太郎）" required />
            </div>
          </div>
          <div>
            <div className="label">電話番号 *</div>
            <input className="input w-full" inputMode="tel" autoComplete="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="09012345678" required />
          </div>
          <div>
            <div className="label">メールアドレス *</div>
            <input className="input w-full" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="taro@example.com" required />
            <p className="text-[10px] text-muted mt-1">登録完了メール・各種ご案内をお送りします</p>
          </div>
          <div>
            <div className="label">ご利用開始日 *</div>
            <input className="input w-full" type="date" value={serviceStart}
              onChange={(e) => setServiceStart(e.target.value)} required />
            <p className="text-[10px] text-muted mt-1">
              ご利用開始月とその翌月は無料。翌々月（3ヶ月目）から月額のお支払いが始まります。
            </p>
          </div>
        </div>
      )}

      {/* 4. 支払方法 (§1.1-4 / §2.1) + カード入力 */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMethod("card")} className={
              "p-3 rounded-xl border text-sm flex items-center gap-2 justify-center transition-colors " +
              (method === "card" ? "border-navy bg-navy/5 font-medium" : "border-border text-muted")
            }>
              <CreditCard size={15} />クレジットカード
            </button>
            {/* 口座振替はカードと別サービス・別フロー。仕様確定後に別系統で追加 (§2.1) */}
            <button type="button" disabled className="p-3 rounded-xl border border-border text-sm flex items-center gap-2 justify-center text-muted/50 cursor-not-allowed">
              <Landmark size={15} />口座振替 (準備中)
            </button>
          </div>

          {method === "card" && (
            <>
              <div>
                <div className="label flex items-center gap-1"><CreditCard size={13} />カード番号</div>
                <input className="input w-full font-mono" inputMode="numeric" autoComplete="cc-number"
                  placeholder="4111 1111 1111 1111" value={number}
                  onChange={(e) => setNumber(formatCardNumber(e.target.value))}
                  maxLength={23} required />
                {(() => {
                  const digits = number.replace(/\D/g, "");
                  return digits.length > 0 && digits.length < 14
                    ? <p className="text-[11px] text-bad mt-1">カード番号は通常14〜16桁です (現在 {digits.length} 桁)</p>
                    : null;
                })()}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="label">月</div>
                  <input className="input w-full" inputMode="numeric" placeholder="MM" maxLength={2}
                    value={expMonth} onChange={(e) => setExpMonth(e.target.value)} required />
                </div>
                <div>
                  <div className="label">年</div>
                  <input className="input w-full" inputMode="numeric" placeholder="YYYY" maxLength={4}
                    value={expYear} onChange={(e) => setExpYear(e.target.value)} required />
                </div>
                <div>
                  <div className="label">セキュリティコード</div>
                  <input className="input w-full" inputMode="numeric" autoComplete="cc-csc" placeholder="123"
                    maxLength={4} value={cvc} onChange={(e) => setCvc(e.target.value)} required />
                </div>
              </div>
            </>
          )}

          {plan && (
            <div className="text-xs text-muted bg-bg rounded-lg p-2.5">
              お申し込み内容: <b className="text-ink">{plan.name}</b> — 月額 ¥{plan.amount.toLocaleString()} (本日初回課金)
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-bad">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /><span className="whitespace-pre-line break-all">{error}</span>
        </div>
      )}

      {/* ナビゲーション */}
      <div className="flex items-center gap-2">
        {step > minStep && (
          <button type="button" onClick={() => { setError(null); setStep(step - 1); }}
            className="btn flex items-center gap-1"><ChevronLeft size={14} />戻る</button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" disabled={!canNext}
            onClick={() => setStep(step + 1)}
            className="btn btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-40">
            次へ<ChevronRight size={14} />
          </button>
        ) : (
          <button className="btn btn-primary flex-1 flex items-center justify-center gap-2" disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
            {busy ? "処理中…" : "同意して申し込む"}
          </button>
        )}
      </div>

      <p className="text-[11px] text-muted flex items-center gap-1 justify-center">
        <Lock size={11} />カード情報は当社サーバーを経由せず決済代行会社へ直接送信されます
      </p>
    </form>
  );
}
