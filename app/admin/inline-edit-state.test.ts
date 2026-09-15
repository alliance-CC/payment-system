import { describe, it, expect } from "vitest";
import { shouldCloseEditor } from "./inline-edit-state";

// 「編集ボタン → 入力 → 保存」で入力欄が閉じないと、DBには保存されているのに
// 画面上は入力欄が開いたままで「変更しても反映されない」ように見える (実際に発生した不具合)。
// 閉じる条件をここで固定しておく。
describe("shouldCloseEditor — 保存完了で入力欄を閉じる", () => {
  it("送信中 → 完了 で閉じる", () => {
    expect(shouldCloseEditor(true, false)).toBe(true);
  });
  it("送信中のあいだは閉じない (入力値を消さない)", () => {
    expect(shouldCloseEditor(true, true)).toBe(false);
    expect(shouldCloseEditor(false, true)).toBe(false);
  });
  it("何も送信していないのに閉じない (編集を開いた直後に勝手に閉じない)", () => {
    expect(shouldCloseEditor(false, false)).toBe(false);
  });

  it("開く→送信→完了 の一連の流れで、閉じるのは完了時の1回だけ", () => {
    // pending の推移をそのまま流し、閉じる判定が立つ回数を数える
    const timeline = [false, false, true, true, false, false];
    let was = false;
    const closes: number[] = [];
    timeline.forEach((pending, i) => {
      if (shouldCloseEditor(was, pending)) closes.push(i);
      was = pending;
    });
    expect(closes).toEqual([4]);
  });
});
