"use client";

// 解約ボタン (確認ダイアログ付き)。フォームの submit を担う。
export default function CancelButton({ name }: { name: string | null }) {
  return (
    <button
      type="submit"
      className="btn btn-danger text-xs py-1"
      onClick={(e) => {
        const who = name ? `「${name}」さん` : "この登録者";
        if (!confirm(`${who}を解約しますか？\n\nVeriTrans会員削除・次回課金停止を実行します。\n(退会手続き当月末日までは利用可)`)) {
          e.preventDefault();
        }
      }}
    >
      解約
    </button>
  );
}
