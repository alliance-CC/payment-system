"use client";

// 案件の完全削除ボタン (取り消し不可)。誤操作防止のため会員IDの入力確認を必須にする。
// 入力が一致したときだけ hidden の confirm にセットして送信し、サーバー側でも再検証する。
export default function DeleteButton({ accountId }: { accountId: string }) {
  return (
    <button
      type="submit"
      title="この案件をデータベースから完全に削除します（取り消せません）"
      className="text-xs py-1 px-2 rounded border border-bad/40 text-bad hover:bg-bad/10 transition-colors"
      onClick={(e) => {
        const form = e.currentTarget.form;
        const t = window.prompt(
          `⚠️ 危険な操作：完全削除\n\n` +
          `この案件（会員ID: ${accountId}）をデータベースから完全に削除します。\n` +
          `この操作は取り消せません。\n\n` +
          `実行するには、確認のため会員IDを正確に入力してください：`,
        );
        if (t === null) { e.preventDefault(); return; }                 // キャンセル
        if (t.trim() !== accountId) {
          e.preventDefault();
          window.alert("会員IDが一致しないため中止しました。");
          return;
        }
        const hidden = form?.elements.namedItem("confirm") as HTMLInputElement | null;
        if (hidden) hidden.value = t.trim();
      }}
    >
      削除
    </button>
  );
}
