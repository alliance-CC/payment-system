"use client";
import { useState } from "react";
import { savePartnerPasswordAction } from "../actions";
import { Copy, Check, RefreshCw, Eye, EyeOff, Save, AlertTriangle } from "lucide-react";

// 外部企業向けダッシュボードの「渡す情報」パネル。
// URL とパスワードをそのままコピーして先方へ共有できるようにする。
// パスワードは課金設定フォームの一部として保存される (name="partnerPassword")。

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <input readOnly value={value} className={"input w-full " + (mono ? "font-mono text-xs" : "")} />
        <button
          type="button"
          className="btn text-xs py-1 flex items-center gap-1 shrink-0"
          disabled={!value}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch { /* クリップボード不可の環境は無視 */ }
          }}
        >
          {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
          {copied ? "コピー済" : "コピー"}
        </button>
      </div>
    </div>
  );
}

/** 英数字から曖昧な文字 (0/O/1/l/I) を除いた、読み上げ・転記しやすい文字集合 */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(len = 20): string {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

export default function PartnerAccessPanel({
  dashboardUrl,
  initialPassword,
}: {
  dashboardUrl: string;
  initialPassword: string;
}) {
  const [password, setPassword] = useState(initialPassword);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const weak = password.length > 0 && password.length < 12;
  // 保存済みの値と違う = まだ保存されていない。
  // 「発行してコピーしたのに保存を忘れた」状態だと、渡したパスワードでは入れないため明示する。
  const dirty = password !== initialPassword;

  return (
    <div className="space-y-3">
      <CopyField label="ダッシュボードURL" value={dashboardUrl} />

      <div>
        <div className="label mb-1 flex items-center gap-2">
          ログインパスワード
          <span className={"chip " + (initialPassword ? "chip-good" : "chip-gold")}>
            {initialPassword ? `保存済み（${initialPassword.length}文字）` : "未設定"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            name="partnerPassword"
            type={visible ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            placeholder="未設定（この場合ダッシュボードは閉鎖されます）"
            className="input w-full font-mono text-xs"
          />
          <button
            type="button"
            title={visible ? "隠す" : "表示"}
            className="btn text-xs py-1 shrink-0"
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            type="button"
            className="btn text-xs py-1 flex items-center gap-1 shrink-0"
            disabled={!password}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(password);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch { /* クリップボード不可の環境は無視 */ }
            }}
          >
            {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
            {copied ? "コピー済" : "コピー"}
          </button>
          <button
            type="button"
            className="btn text-xs py-1 flex items-center gap-1 shrink-0"
            onClick={() => { setPassword(generatePassword()); setVisible(true); }}
          >
            <RefreshCw size={12} />発行
          </button>
        </div>
        {/* 保存しないと反映されないことが分かるようにする。
            画面下の「保存」まで行かなくても、この場で確定できる。 */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button
            type="submit"
            formAction={savePartnerPasswordAction}
            formNoValidate
            className={"btn text-xs py-1 flex items-center gap-1 " + (dirty ? "btn-primary" : "")}
          >
            <Save size={12} />このパスワードを保存
          </button>
          {dirty && (
            <span className="text-[11px] text-bad flex items-center gap-1">
              <AlertTriangle size={12} />未保存です。保存するまで、このパスワードではログインできません。
            </span>
          )}
        </div>

        {weak && (
          <p className="text-[11px] text-bad mt-1">
            短すぎます。「発行」で強いパスワードを作ることをおすすめします。
          </p>
        )}
        <p className="text-[11px] text-muted mt-1">
          変更すると、外部企業が今ログイン中のセッションは無効になります（再ログインが必要）。
          空欄で保存するとダッシュボードは閉鎖されます。
        </p>
      </div>
    </div>
  );
}
