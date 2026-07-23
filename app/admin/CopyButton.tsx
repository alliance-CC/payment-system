"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

// 会員ID などをクリップボードにコピーするボタン。
export default function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="コピー"
      className="inline-flex items-center gap-1 align-middle text-muted hover:text-navy transition-colors"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* クリップボード不可の環境は無視 */
        }
      }}
    >
      {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
    </button>
  );
}
