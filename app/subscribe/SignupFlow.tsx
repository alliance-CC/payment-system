"use client";
// 継続課金の申込フロー (§1.1 確定・短縮版):
//   (プラン=LPから確定) → 1. お客様情報(氏名・電話・メール・利用開始日・規約同意)
//                        → 2. カード入力 → 完了
//   カード番号は tokenize.ts でブラウザ→VeriTrans 直送 (サーバー非通過 §2/§7)。
import { useState } from "react";
import {
  CreditCard, Loader2, CheckCircle2, AlertCircle, Lock,
  ChevronRight, ChevronLeft, ExternalLink,
} from "lucide-react";
import { tokenizeCard } from "./tokenize";

type Plan = { id: string; name: string; amount: number };
type StepKey = "plan" | "info" | "pay";
const STEP_LABEL: Record<StepKey, string> = { plan: "プラン", info: "お客様情報", pay: "お支払い" };

// カード番号を数字のみ・4桁ごとにスペース区切りへ整形 (最大19桁)。送信時に tokenize 側で除去。
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
  plans, tokenApiKey, tokenUrl, configured, termsVersion, caseId, tenantSlug, initialPlanId, use3ds,
}: {
  plans: Plan[];
  tokenApiKey: string;
  tokenUrl: string;
  configured: boolean;
  termsVersion: string;
  caseId?: string;
  tenantSlug?: string;
  /** LP の申込ボタンから ?plan= で渡されたプラン。有効ならプラン選択を省略。 */
  initialPlanId?: string;
  /** 3Dセキュア2.0 (VT_USE_3DS)。有効時はカード名義を収集し、申込後に認証画面へ遷移する */
  use3ds?: boolean;
}) {
  const planLocked = !!(initialPlanId && plans.some((p) => p.id === initialPlanId));
  // プラン確定時は「お客様情報 → お支払い」の2ステップ、未確定時は先頭に「プラン」。
  const steps: StepKey[] = planLocked ? ["info", "pay"] : ["plan", "info", "pay"];
  const [idx, setIdx] = useState(0);
  const cur = steps[idx];

  const [planId, setPlanId] = useState(planLocked ? initialPlanId! : (plans[0]?.id ?? ""));
  const [agreed, setAgreed] = useState(false);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const fullName = `${lastName.trim()} ${firstName.trim()}`.trim();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceStart, setServiceStart] = useState(defaultServiceStart());
  const [number, setNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  // カード名義 (半角ローマ字)。3DS ではブランドルール必須のため use3ds 時のみ収集
  const [cardholder, setCardholder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ accountId: string; nextChargeDate: string } | null>(null);

  const plan = plans.find((p) => p.id === planId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    let navigating = false;   // 3DS 認証画面へ遷移中は busy 表示を維持する
    try {
      // 1. カードトークン化 (ブラウザ → VeriTrans 直送 §2)
      const tok = await tokenizeCard(tokenUrl, tokenApiKey, { number, expMonth, expYear, cvc });
      if (!tok.ok) { setError(tok.error); return; }

      // 2. 申込 (サーバーが 会員登録+カード登録+CRM反映+通知 を実行 §1.1-5,6)
      // 3DS 有効時はカード名義 (半角ローマ字・バックスラッシュ不可) も送る
      const holder = cardholder.replace(/[^\x20-\x7e]/g, "").replace(/\\/g, "").trim();
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
          cardholderName: use3ds ? holder : null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const code = json?.vResultCode ? ` (コード: ${json.vResultCode})` : "";
        const msg = json?.error === "already-subscribed"
          ? "この案件は既にお申し込み済みです"
          : json?.error === "charge-pending"
          ? "決済結果の確認に時間がかかっています。恐れ入りますが、再度お申し込みはせず、お電話にてお問い合わせください"
          : json?.error === "3ds-in-progress"
          ? "本人認証の結果を確認中です。15分ほど待ってから再度お試しください"
          : json?.error === "cardholder-name-required"
          ? "カード名義（ローマ字）をご入力ください"
          : json?.error === "too-many-requests"
          ? "アクセスが集中しています。しばらく待ってから再度お試しください"
          : json?.error === "email-required"
          ? "メールアドレスをご入力ください"
          : `お申し込みに失敗しました${code}`;
        setError(json?.vtDetail ? `${msg}\n詳細: ${json.vtDetail}` : msg);
        return;
      }
      // 3DS: カード会社の本人認証画面へ遷移 (完了後 /subscribe/complete に戻る)
      if (json.mode === "3ds") {
        if (json.redirect) {
          navigating = true;
          window.location.href = json.redirect;   // 認証開始URL (ガイド 4.3.1)
          return;                                  // busy のまま遷移を待つ
        }
        if (json.contents) {
          // resResponseContents: 加工せずそのまま描画すると自動遷移する (編集厳禁)
          navigating = true;
          document.open();
          document.write(json.contents);
          document.close();
          return;
        }
        setError("認証画面への遷移に失敗しました。時間をおいて再度お試しください");
        return;
      }
      setDone({ accountId: json.accountId, nextChargeDate: json.nextChargeDate });
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      if (!navigating) setBusy(false);
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

  const infoValid =
    lastName.trim() !== "" && firstName.trim() !== "" &&
    phone.trim() !== "" && isEmail(email) && !!serviceStart && agreed;
  const canNext = cur === "plan" ? !!plan : cur === "info" ? infoValid : true;
  const isLast = idx === steps.length - 1;
  // 規約は「新しいタブ」で開く。申込フォームは元のタブにそのまま残り、
  // 規約タブを閉じれば入力内容を保ったまま戻れる (window.openで開くとタブ側で閉じられる)。
  const termsHref = `/legal/terms/${planId}?from=subscribe`;
  const openTerms = (e: React.MouseEvent) => { e.preventDefault(); window.open(termsHref, "_blank"); };
  // 両プランに含まれる「ネットライフサポート」規約
  const netlifeHref = `/legal/terms/netlife?from=subscribe`;
  const openNetlife = (e: React.MouseEvent) => { e.preventDefault(); window.open(netlifeHref, "_blank"); };

  return (
    <>
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

        {/* ステップインジケータ */}
        <ol className="flex items-center gap-1 text-[11px] text-muted">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span className={
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold " +
                (i === idx ? "bg-navy text-white" : i < idx ? "bg-good/15 text-good" : "bg-bg text-muted")
              }>{i + 1}</span>
              <span className={i === idx ? "text-ink font-medium" : ""}>{STEP_LABEL[s]}</span>
              {i < steps.length - 1 && <ChevronRight size={11} className="text-muted/50" />}
            </li>
          ))}
        </ol>

        {/* プラン選択 (LP 未経由の直アクセス時のみ) */}
        {cur === "plan" && (
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

        {/* お客様情報: 氏名・電話・メール・利用開始日・規約同意 */}
        {cur === "info" && (
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

            {/* 規約リンク（申込プランの利用規約＋ネットライフサポート）＋同意チェック */}
            <div className="pt-1 space-y-1.5">
              <a href={termsHref} target="_blank" rel="noopener" onClick={openTerms}
                 className="flex items-center gap-1 text-[13px] text-accent underline font-medium">
                「{plan?.name ?? "本プラン"}」の利用規約を確認する（別タブで開きます）<ExternalLink size={12} />
              </a>
              <a href={netlifeHref} target="_blank" rel="noopener" onClick={openNetlife}
                 className="flex items-center gap-1 text-[13px] text-accent underline font-medium">
                「ネットライフサポート」の利用規約を確認する（別タブで開きます）<ExternalLink size={12} />
              </a>
              <label className="flex items-start gap-2 text-sm cursor-pointer mt-2">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                <span>上記いずれの利用規約の内容も確認し、同意します</span>
              </label>
            </div>
          </div>
        )}

        {/* カード入力 (クレジットカードのみ) */}
        {cur === "pay" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <CreditCard size={15} className="text-navy" />お支払いはクレジットカードです
            </div>
            {/* 国際ブランドのロゴ掲示 (カード会社 加盟店規約により支払画面での掲示が必須) */}
            <div>
              <div className="text-[11px] text-muted mb-1">ご利用いただけるカードブランド</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { src: "/brand/visa.png", alt: "Visa" },
                  { src: "/brand/mastercard.png", alt: "Mastercard" },
                  { src: "/brand/jcb.gif", alt: "JCB" },
                  { src: "/brand/amex.jpg", alt: "American Express" },
                  { src: "/brand/diners.gif", alt: "Diners Club" },
                ].map((b) => (
                  <span key={b.alt} className="inline-flex items-center justify-center bg-white border border-border rounded px-1.5 h-8">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.src} alt={b.alt} className="h-5 w-auto" />
                  </span>
                ))}
              </div>
            </div>
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
            {use3ds && (
              <div>
                <div className="label">カード名義（ローマ字） *</div>
                <input className="input w-full font-mono uppercase" autoComplete="cc-name"
                  placeholder="TARO YAMADA" value={cardholder} maxLength={45}
                  pattern="[ -~]{2,45}" title="カード券面のとおり半角ローマ字でご入力ください"
                  onChange={(e) => setCardholder(e.target.value)} required />
                <p className="text-[10px] text-muted mt-1">カード券面に記載のとおりにご入力ください（本人認証に使用します）</p>
              </div>
            )}
            {plan && (
              <div className="text-xs text-muted bg-bg rounded-lg p-2.5">
                お申し込み内容: <b className="text-ink">{plan.name}</b> — 月額 ¥{plan.amount.toLocaleString()}（税込）。利用開始月＋翌月は無料、以降は毎月自動で継続課金されます（解約はいつでも可能）。
              </div>
            )}
            {use3ds && (
              <p className="text-[11px] text-muted">
                「申し込む」の後、カード会社の本人認証（3Dセキュア）画面へ移動する場合があります。認証完了後にこのサイトへ自動的に戻ります。
              </p>
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
          {idx > 0 && (
            <button type="button" onClick={() => { setError(null); setIdx(idx - 1); }}
              className="btn flex items-center gap-1"><ChevronLeft size={14} />戻る</button>
          )}
          {!isLast ? (
            <button type="button" disabled={!canNext}
              onClick={() => setIdx(idx + 1)}
              className="btn btn-primary flex-1 flex items-center justify-center gap-1 disabled:opacity-40">
              次へ<ChevronRight size={14} />
            </button>
          ) : (
            <button className="btn btn-primary flex-1 flex items-center justify-center gap-2" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
              {busy ? "処理中…" : "申し込む"}
            </button>
          )}
        </div>

        <p className="text-[11px] text-muted flex items-center gap-1 justify-center">
          <Lock size={11} />カード情報は当社サーバーを経由せず決済代行会社へ直接送信されます
        </p>
      </form>

      {/* 特定商取引法に基づく表記 (申込フォーム外・念のため) */}
      <p className="text-[11px] text-muted text-center mt-3">
        <a href="https://lifeap.co.jp/tokutei/" target="_blank" rel="noopener noreferrer" className="text-accent underline">
          特定商取引法に基づく表記
        </a>
      </p>
    </>
  );
}
