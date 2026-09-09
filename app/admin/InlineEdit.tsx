"use client";
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";

/**
 * 一覧の1項目を「編集ボタン → 入力 → 保存」で書き換えるための表示切替。
 *
 * 親は <form action={サーバーアクション}> で、この中に入力欄と保存ボタンが入る。
 * 編集していないあいだは入力欄自体を出さないので、うっかり送信されることがない。
 */
export default function InlineEdit({
  value,
  name,
  type = "text",
  placeholder,
  label,
  width = "w-28",
  mono = false,
}: {
  /** 現在の値 (空なら「未入力」と薄く表示) */
  value: string;
  /** サーバーアクションが受け取る項目名 */
  name: string;
  type?: "text" | "date";
  placeholder?: string;
  /** スクリーンリーダー用のラベル (例: 「MR001 のSAF案件番号」) */
  label: string;
  width?: string;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span className={(value ? (mono ? "font-mono text-xs" : "") : "text-muted") + " whitespace-nowrap"}>
          {value || "未入力"}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={`${label}を編集`}
          aria-label={`${label}を編集`}
          className="text-muted hover:text-navy transition-colors shrink-0"
        >
          <Pencil size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type={type}
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        autoFocus
        className={`input text-xs py-0.5 px-1.5 ${width} ${mono ? "font-mono" : ""}`}
      />
      <button type="submit" title="保存" aria-label={`${label}を保存`}
        className="text-good hover:opacity-70 transition-opacity shrink-0">
        <Check size={14} />
      </button>
      <button type="button" onClick={() => setEditing(false)} title="取消" aria-label="編集を取り消す"
        className="text-muted hover:text-bad transition-colors shrink-0">
        <X size={13} />
      </button>
    </div>
  );
}
