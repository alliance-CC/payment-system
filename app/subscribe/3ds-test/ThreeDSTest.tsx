"use client";
// 3Dセキュア 疎通テスト画面 (検証用)。テストカードをトークン化 → /3ds-probe を呼び、
// VeriTransの生レスポンスを表示する。カード番号はブラウザ→VeriTrans直送(サーバー非通過)。
import { useState } from "react";
import { tokenizeCard } from "../tokenize";

function formatCardNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
}

export default function ThreeDSTest({
  tokenApiKey, tokenUrl, configured,
}: { tokenApiKey: string; tokenUrl: string; configured: boolean }) {
  const [number, setNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const tok = await tokenizeCard(tokenUrl, tokenApiKey, { number, expMonth, expYear, cvc });
      if (!tok.ok) { setError("カードのトークン化に失敗しました: " + tok.error); return; }
      const res = await fetch("/api/payments/veritrans/3ds-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok.token }),
      });
      const json = await res.json().catch(() => ({ error: "レスポンスの解析に失敗しました" }));
      if (json?.challengeHtml) {
        // 本人認証画面を起動する。このページを認証画面に差し替え、認証後は
        // /subscribe/3ds-return に戻って結果が表示される (そこをコピーして共有)。
        document.open();
        document.write(json.challengeHtml as string);
        document.close();
        return;
      }
      // 認証不要(フリクションレス)やエラーはそのまま表示
      setResult(JSON.stringify(json, null, 2));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="card p-4 text-sm text-bad">
        VeriTransの設定(CCID/鍵/トークンキー)が未設定です。検証環境の環境変数を設定してください。
      </div>
    );
  }

  return (
    <form onSubmit={run} className="card p-6 space-y-4">
      <div>
        <div className="label">テストカード番号</div>
        <input className="input w-full font-mono" inputMode="numeric" placeholder="4111 1111 1111 1111"
          value={number} onChange={(e) => setNumber(formatCardNumber(e.target.value))} maxLength={23} required />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><div className="label">月(MM)</div>
          <input className="input w-full" inputMode="numeric" placeholder="12" maxLength={2}
            value={expMonth} onChange={(e) => setExpMonth(e.target.value)} required /></div>
        <div><div className="label">年(YYYY)</div>
          <input className="input w-full" inputMode="numeric" placeholder="2030" maxLength={4}
            value={expYear} onChange={(e) => setExpYear(e.target.value)} required /></div>
        <div><div className="label">CVC</div>
          <input className="input w-full" inputMode="numeric" placeholder="123" maxLength={4}
            value={cvc} onChange={(e) => setCvc(e.target.value)} required /></div>
      </div>
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "実行中…" : "3DS疎通テストを実行"}
      </button>

      {error && <p className="text-sm text-bad whitespace-pre-line">{error}</p>}
      {result && (
        <div>
          <div className="label mb-1">VeriTransの応答（この内容をそのまま開発者へ共有してください）</div>
          <textarea readOnly value={result} rows={16}
            className="input w-full font-mono text-[11px] leading-relaxed" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
