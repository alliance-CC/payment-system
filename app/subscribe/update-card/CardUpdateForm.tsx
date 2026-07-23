"use client";
// カード更新フォーム (§6-7)。期限切れ等で顧客に再登録してもらう (洗替なし §0)。
// 新カードもブラウザ→VeriTrans 直送でトークン化し、サーバーへはトークンのみ送る (§7)。
import { useState } from "react";
import { CreditCard, Loader2, CheckCircle2, AlertCircle, Lock } from "lucide-react";
import { tokenizeCard } from "../tokenize";

export default function CardUpdateForm({
  tokenApiKey, tokenUrl, configured, initialAccountId,
}: {
  tokenApiKey: string;
  tokenUrl: string;
  configured: boolean;
  initialAccountId?: string;
}) {
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [phone, setPhone] = useState("");
  const [number, setNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tok = await tokenizeCard(tokenUrl, tokenApiKey, { number, expMonth, expYear, cvc });
      if (!tok.ok) { setError(tok.error); return; }

      const res = await fetch("/api/payments/veritrans/update-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, phone, token: tok.token, tokenKey: tok.tokenKey }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const msg = json?.error === "contract-not-found" ? "会員IDが見つかりません"
          : json?.error === "verification-failed" ? "ご本人確認ができませんでした (電話番号をご確認ください)"
          : `カードの更新に失敗しました${json?.vResultCode ? ` (コード: ${json.vResultCode})` : ""}`;
        setError(msg);
        return;
      }
      setDone(true);
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
        <h2 className="text-lg font-semibold">カード情報を更新しました</h2>
        <p className="text-sm text-muted">未払い分がある場合は翌営業日以降に自動で再決済されます。</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="card p-6 flex items-start gap-3 text-sm">
        <AlertCircle size={18} className="text-bad shrink-0 mt-0.5" />
        <p className="text-muted">決済設定が未完了のため、現在カード更新はご利用いただけません。</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <div>
        <div className="label">会員ID *</div>
        <input className="input w-full font-mono" value={accountId}
          onChange={(e) => setAccountId(e.target.value)} placeholder="MRxxxxxxxxxxxx" required />
      </div>
      <div>
        <div className="label">お申し込み時の電話番号 *</div>
        <input className="input w-full" inputMode="tel" value={phone}
          onChange={(e) => setPhone(e.target.value)} placeholder="09012345678" required />
      </div>

      <div>
        <div className="label flex items-center gap-1"><CreditCard size={13} />新しいカード番号</div>
        <input className="input w-full font-mono" inputMode="numeric" autoComplete="cc-number"
          placeholder="4111 1111 1111 1111" value={number}
          onChange={(e) => setNumber(e.target.value)} required />
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

      {error && (
        <div className="flex items-start gap-2 text-sm text-bad">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      <button className="btn btn-primary w-full flex items-center justify-center gap-2" disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={15} />}
        {busy ? "処理中…" : "カード情報を更新する"}
      </button>

      <p className="text-[11px] text-muted flex items-center gap-1 justify-center">
        <Lock size={11} />カード情報は当社サーバーを経由せず決済代行会社へ直接送信されます
      </p>
    </form>
  );
}
