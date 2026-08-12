// Google サービスアカウント秘密鍵の正規化。
//
// 環境変数へ貼る過程で形が崩れやすく、崩れると OpenSSL が
//   error:1E08010C:DECODER routines::unsupported
// を出して認証できない。よくある崩れ方をすべて吸収する:
//   ・JSON からコピーして前後にダブルクォートが付いたまま
//   ・改行が "\n" という2文字のまま (JSON の生値)
//   ・CRLF が混ざる / 前後に空白や空行が付く
//   ・鍵全体を Base64 にして貼っている (改行問題の回避策としてよく使われる)
// いずれでもない場合は PEM として不正なので、呼び出し側が原因を提示できるよう
// isValidPrivateKey() で判定できるようにしている。
import "server-only";

const PEM_HEAD = /-----BEGIN (RSA )?PRIVATE KEY-----/;

export function normalizeGooglePrivateKey(raw: string | undefined | null): string {
  let k = String(raw ?? "").trim();
  if (!k) return "";

  // 1. 前後のクォートを外す (JSON からのコピペ対策)
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }

  // 2. 文字列としての \n / \r\n を実際の改行へ
  k = k.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");

  // 3. Base64 で貼られている場合はデコードして PEM に戻す
  if (!PEM_HEAD.test(k) && /^[A-Za-z0-9+/=\s]+$/.test(k) && k.length > 100) {
    try {
      const decoded = Buffer.from(k.replace(/\s+/g, ""), "base64").toString("utf8");
      if (PEM_HEAD.test(decoded)) k = decoded;
    } catch { /* Base64 ではなかった → そのまま */ }
  }

  // 4. 実改行の正規化 (CRLF → LF)。末尾は改行で終える (OpenSSL が好む形)
  k = k.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return k ? `${k}\n` : "";
}

/** PEM として最低限の形をしているか (BEGIN/END が揃っているか) */
export function isValidPrivateKey(key: string): boolean {
  return PEM_HEAD.test(key) && /-----END (RSA )?PRIVATE KEY-----/.test(key);
}

/** 形式不正時に管理画面へ出す案内文 (鍵そのものは絶対に含めない) */
export const PRIVATE_KEY_HELP =
  "秘密鍵(GOOGLE_SHEETS_PRIVATE_KEY)の形式が不正です。" +
  "サービスアカウントのJSONにある private_key の値を、" +
  "「-----BEGIN PRIVATE KEY-----」から「-----END PRIVATE KEY-----」まで含めて設定してください" +
  "（前後のダブルクォートは不要。改行は \\n のままでも実際の改行でも構いません）。";
