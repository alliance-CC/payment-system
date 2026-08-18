"use client";
// エントリー済みチェックの「すべて選択」。
// 表示中の行のチェックボックスをまとめて切り替えるだけで、保存は行わない
// (保存は「エントリー済みにする」ボタンを押したときのみ)。
export default function SelectAllCheckbox() {
  return (
    <input
      type="checkbox"
      aria-label="表示中のすべてを選択"
      title="表示中のすべてを選択"
      onChange={(e) => {
        const checked = e.currentTarget.checked;
        document
          .querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="accountIds"]')
          .forEach((box) => { box.checked = checked; });
      }}
    />
  );
}
