"use client";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { shouldCloseEditor } from "./inline-edit-state";

/**
 * 一覧の1項目を「編集ボタン → 入力 → 保存」で書き換えるための表示切替。
 *
 * 親は <form action={サーバーアクション}> で、この中に入力欄と保存ボタンが入る。
 * 編集していないあいだは入力欄自体を出さないので、うっかり送信されることがない。
 *
 * ⚠️ 表示モードと編集モードのルートには別々の key を付けている (外さないこと)。
 *    key が無いと React は同じ位置の <button> を使い回すため、「編集(type=button)」の
 *    DOM ノードがそのまま「保存(type=submit)」に書き換わる。その結果、鉛筆を押した
 *    そのクリックが、ブラウザが既定動作を実行する時点では submit ボタンへのクリックに
 *    なっていて、入力する前にフォームが送信されてしまう
 *    (= 編集ボタンを押しただけで元の値のまま保存され、画面が変わらないように見える)。
 *
 * 保存の進行は親フォームの useFormStatus() で見る。送信中は「保存中」を出し、
 * 完了したら入力欄を閉じて新しい値を表示する。
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
  // 同じ <form> の中なので、この行の保存だけを見ている (他の行の保存には反応しない)
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (shouldCloseEditor(wasPending.current, pending)) setEditing(false);
    wasPending.current = pending;
  }, [pending]);

  if (!editing) {
    return (
      <div key="view" className="flex items-center gap-1">
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
    <div key="edit" className="flex items-center gap-1">
      <input
        type={type}
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        aria-label={label}
        // disabled にすると送信対象から外れてしまうため readOnly で止める
        readOnly={pending}
        autoFocus
        className={`input text-xs py-0.5 px-1.5 ${width} ${mono ? "font-mono" : ""}`}
      />
      <button
        type="submit" disabled={pending}
        title={pending ? "保存中" : "保存"} aria-label={`${label}を保存`}
        className="text-good hover:opacity-70 transition-opacity shrink-0 disabled:opacity-50"
      >
        {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </button>
      <button
        type="button" onClick={() => setEditing(false)} disabled={pending}
        title="取消" aria-label="編集を取り消す"
        className="text-muted hover:text-bad transition-colors shrink-0 disabled:opacity-50"
      >
        <X size={13} />
      </button>
    </div>
  );
}
