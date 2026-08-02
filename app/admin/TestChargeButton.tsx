"use client";

// 動作テスト課金ボタン (検証環境のみ表示)。登録済みカードに1回だけ課金を試し、
// 「カードが後から引き落とせる状態で登録されているか」を確認する。
export default function TestChargeButton() {
  return (
    <button
      type="submit"
      title="登録カードに1回だけ課金を試して、引き落とし可能か確認します（検証環境）"
      className="text-xs py-1 px-2 rounded border border-good/50 text-good hover:bg-good/10 transition-colors shrink-0"
      onClick={(e) => {
        if (!window.confirm(
          "このお客様の登録カードに『動作テスト課金』を1回実行します。\n\n" +
          "検証環境のため実際の請求は発生しません（ダミー決済）。\n" +
          "カードが正しく登録され、後から引き落とせるかの確認用です。\n\n" +
          "実行しますか？",
        )) {
          e.preventDefault();
        }
      }}
    >
      動作テスト
    </button>
  );
}
