// Googleサービスアカウント秘密鍵の正規化テスト。
// 環境変数へ貼る過程で崩れると OpenSSL が
//   error:1E08010C:DECODER routines::unsupported
// を出して認証できなくなるため、よくある崩れ方を吸収できているか固定する。
import { describe, it, expect } from "vitest";
import { normalizeGooglePrivateKey, isValidPrivateKey } from "./google-key";

// 形式確認用のダミー (実鍵ではない。中身はデコードされないため何でもよい)
const BODY = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDummy";
const PEM = `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n`;

describe("秘密鍵の正規化", () => {
  it("実際の改行を含む正しいPEMはそのまま通る", () => {
    const k = normalizeGooglePrivateKey(PEM);
    expect(isValidPrivateKey(k)).toBe(true);
    expect(k).toContain("\n");
  });

  it("改行が \\n の2文字のまま(JSONの生値)でも実改行に直す", () => {
    const raw = `-----BEGIN PRIVATE KEY-----\\n${BODY}\\n-----END PRIVATE KEY-----\\n`;
    const k = normalizeGooglePrivateKey(raw);
    expect(isValidPrivateKey(k)).toBe(true);
    expect(k).not.toContain("\\n");
  });

  it("JSONからコピーして前後にダブルクォートが付いていても外す", () => {
    const raw = `"-----BEGIN PRIVATE KEY-----\\n${BODY}\\n-----END PRIVATE KEY-----\\n"`;
    expect(isValidPrivateKey(normalizeGooglePrivateKey(raw))).toBe(true);
  });

  it("CRLF が混ざっていても LF に揃える", () => {
    const raw = `-----BEGIN PRIVATE KEY-----\r\n${BODY}\r\n-----END PRIVATE KEY-----\r\n`;
    const k = normalizeGooglePrivateKey(raw);
    expect(isValidPrivateKey(k)).toBe(true);
    expect(k).not.toContain("\r");
  });

  it("前後の空白・空行が付いていても除去する", () => {
    expect(isValidPrivateKey(normalizeGooglePrivateKey(`\n  ${PEM}  \n`))).toBe(true);
  });

  it("鍵全体をBase64にして貼っていてもデコードして復元する", () => {
    const b64 = Buffer.from(PEM, "utf8").toString("base64");
    expect(isValidPrivateKey(normalizeGooglePrivateKey(b64))).toBe(true);
  });

  it("RSA PRIVATE KEY 形式も受け付ける", () => {
    const raw = `-----BEGIN RSA PRIVATE KEY-----\n${BODY}\n-----END RSA PRIVATE KEY-----\n`;
    expect(isValidPrivateKey(normalizeGooglePrivateKey(raw))).toBe(true);
  });

  it("未設定・空文字は不正として扱う", () => {
    expect(isValidPrivateKey(normalizeGooglePrivateKey(undefined))).toBe(false);
    expect(isValidPrivateKey(normalizeGooglePrivateKey(""))).toBe(false);
  });

  it("BEGIN/END が欠けたものは不正として扱う (誤設定を検知できる)", () => {
    expect(isValidPrivateKey(normalizeGooglePrivateKey(BODY))).toBe(false);
    // JSON 全体を貼ってしまったケース
    expect(isValidPrivateKey(normalizeGooglePrivateKey('{"type":"service_account"}'))).toBe(false);
  });
});
