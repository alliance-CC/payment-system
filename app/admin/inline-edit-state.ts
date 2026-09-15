/**
 * 行内編集 (InlineEdit) の「入力欄を閉じるか」の判定。
 *
 * サーバーアクションの送信中は pending=true、完了 (=一覧が描き直された後) に false へ戻る。
 * その立ち下がりを捉えて表示モードへ戻す。これが無いと、保存が成功していても入力欄が
 * 開いたままで「保存したのに画面が変わらない」ように見える。
 *
 * React に依存しない純関数にしてあるのは、この規則だけをテストで固定するため。
 */
export function shouldCloseEditor(wasPending: boolean, pending: boolean): boolean {
  return wasPending && !pending;
}
