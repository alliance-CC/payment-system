"use client";

// 申込フローから別タブで開かれた規約ページ用の「戻る」ボタン。
// このタブを閉じると、元の申込タブ(入力内容そのまま)に戻る。
// window.open で開かれているため window.close() で自タブを閉じられる。
export default function CloseTabButton() {
  return (
    <button
      type="button"
      onClick={() => window.close()}
      className="inline-flex items-center gap-1 text-sm font-medium text-white bg-navy rounded-full px-3 py-1.5 hover:bg-navy/90"
    >
      ← お申し込みに戻る
    </button>
  );
}
