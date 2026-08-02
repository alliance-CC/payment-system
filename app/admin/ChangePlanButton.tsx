"use client";

// プラン変更の実行ボタン。同じフォーム内の select#planId を読み、
// 現在と同じなら中止、違えば確認ダイアログを出して送信する。
export default function ChangePlanButton({ currentPlanId }: { currentPlanId: string }) {
  return (
    <button
      type="submit"
      className="text-xs py-1 px-2 rounded border border-navy/40 text-navy hover:bg-navy/10 transition-colors shrink-0"
      onClick={(e) => {
        const form = e.currentTarget.form;
        const sel = form?.elements.namedItem("planId") as HTMLSelectElement | null;
        if (!sel) return;
        if (sel.value === currentPlanId) {
          e.preventDefault();
          window.alert("現在と同じプランです。");
          return;
        }
        const label = sel.options[sel.selectedIndex]?.text ?? sel.value;
        if (!window.confirm(
          `プランを「${label}」に変更しますか？\n\n` +
          `・無料期間中：差額なし（初回課金が新料金になります）\n` +
          `・課金開始後：翌月分から新料金になります（当月・過去分は変わりません）`,
        )) {
          e.preventDefault();
        }
      }}
    >
      変更
    </button>
  );
}
