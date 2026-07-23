import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { signVtRequest } from "./signing";

describe("signVtRequest (§3 の署名規約)", () => {
  const params = {
    txnVersion: "2.0.0",
    dummyRequest: "1",
    orderId: "MR0001_202607",
    amount: "1000",
    payNowIdParam: { accountId: "MR0001", memberAdd: "1" },
  };

  it("minify は区切りにスペースを挟まない (Python separators=(',',':') と一致)", () => {
    const { minified } = signVtRequest(params, "CCID", "KEY");
    expect(minified).not.toMatch(/[{,:]\s/);
    expect(minified).toBe(JSON.stringify(params));
  });

  it("authHash = SHA256(ccid + minified + key) の hex", () => {
    const { minified, authHash } = signVtRequest(params, "A100000000000000000000cc", "secret-key");
    const expected = createHash("sha256")
      .update("A100000000000000000000cc" + minified + "secret-key", "utf8")
      .digest("hex");
    expect(authHash).toBe(expected);
  });

  it("body 内の params 文字列は minified とバイト単位で一致する (二重シリアライズ禁止)", () => {
    const { minified, authHash, json } = signVtRequest(params, "CCID", "KEY");
    expect(json).toBe(`{"params":${minified},"authHash":"${authHash}"}`);
  });

  it("送信 body は JSON 全体の URL エンコード (デコードで完全復元できる)", () => {
    const { json, body } = signVtRequest(params, "CCID", "KEY");
    expect(decodeURIComponent(body)).toBe(json);
    expect(body).not.toContain("{");   // エンコード済みであること
  });

  it("日本語 (非ASCII) を含んでもデコードで復元できる", () => {
    const p = { orderId: "注文_001", memo: "テスト用" };
    const { json, body } = signVtRequest(p, "CCID", "KEY");
    expect(decodeURIComponent(body)).toBe(json);
    expect(json).toContain("注文_001"); // ensure_ascii=False 相当 (\\uXXXX にしない)
  });
});
