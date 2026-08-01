import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { signVtRequest, verifyPushHash } from "./signing";

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

describe("verifyPushHash (結果通知の改ざんチェック 4-5)", () => {
  const CCID = "A100000000000000000000cc";
  const KEY = "secret-key";

  // VeriTrans 決済サーバーが結果連携時に付与する vAuthInfo を模擬生成する。
  //   vAuthInfo = SHA-256( ccid + authParams順の「値」連結 + key ) の hex
  //   authParams = パラメータ名のカンマ区切りを Base64 したもの
  function makePush(values: Record<string, string>, order: string[]): Record<string, string> {
    const concatenated = order.map((k) => values[k] ?? "").join("");
    const vAuthInfo = createHash("sha256").update(CCID + concatenated + KEY, "utf8").digest("hex");
    return {
      ...values,
      authParams: Buffer.from(order.join(","), "utf8").toString("base64"),
      vAuthInfo,
    };
  }

  it("正しい vAuthInfo なら ok=true (連結順は authParams に従う)", () => {
    const push = makePush(
      { mpiMstatus: "success", vResultCode: "G011A001", OrderId: "MR0001_202611" },
      ["mpiMstatus", "vResultCode", "OrderId"],
    );
    const r = verifyPushHash(push, CCID, KEY);
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(["mpiMstatus", "vResultCode", "OrderId"]);
  });

  it("連結順が入れ替わっても authParams どおりに検証できる (順序は固定でない)", () => {
    const push = makePush(
      { mpiMstatus: "success", vResultCode: "G011A001", OrderId: "MR0001_202611" },
      ["OrderId", "mpiMstatus", "vResultCode"],
    );
    expect(verifyPushHash(push, CCID, KEY).ok).toBe(true);
  });

  it("いずれかの値が改ざんされたら ok=false (結果の詐称を検知)", () => {
    const push = makePush(
      { mpiMstatus: "failure", vResultCode: "GE230000", OrderId: "MR0001_202611" },
      ["mpiMstatus", "vResultCode", "OrderId"],
    );
    // 攻撃者が failure → success に書き換えても vAuthInfo は一致しない
    const tampered = { ...push, mpiMstatus: "success" };
    expect(verifyPushHash(tampered, CCID, KEY).ok).toBe(false);
  });

  it("vAuthInfo 自体を差し替えても ok=false (鍵を知らなければ再計算できない)", () => {
    const push = makePush(
      { mpiMstatus: "success", vResultCode: "G011A001", OrderId: "X" },
      ["mpiMstatus", "vResultCode", "OrderId"],
    );
    expect(verifyPushHash({ ...push, vAuthInfo: "deadbeef".repeat(8) }, CCID, KEY).ok).toBe(false);
    // 鍵が違えば当然一致しない
    expect(verifyPushHash(push, CCID, "wrong-key").ok).toBe(false);
  });

  it("authParams / vAuthInfo が欠落していれば ok=false", () => {
    expect(verifyPushHash({ mpiMstatus: "success" }, CCID, KEY).ok).toBe(false);
    expect(verifyPushHash({ vAuthInfo: "abc" }, CCID, KEY).ok).toBe(false);
  });

  it("大文字hexの vAuthInfo でも一致判定できる", () => {
    const push = makePush({ mpiMstatus: "success", OrderId: "X" }, ["mpiMstatus", "OrderId"]);
    expect(verifyPushHash({ ...push, vAuthInfo: push.vAuthInfo.toUpperCase() }, CCID, KEY).ok).toBe(true);
  });
});
