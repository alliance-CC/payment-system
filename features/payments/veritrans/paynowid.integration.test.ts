// モック VeriTrans サーバーに対するプロトコルレベル統合テスト。
// 実際に HTTP で電文を送り、以下を機械的に検証する:
//   - URL エンコードされた {"params":...,"authHash":...} ボディがデコード・検証できる
//   - authHash が SHA256(ccid + minify(params) + key) と一致する (署名整合)
//   - params の構造が公式仕様 (2026-07-11 照合) どおり:
//       merchantCcid 必須 / payNowIdParam.token / accountParam.accountId /
//       memberAdd 不使用 / 会員管理系は別ベースURL
//   - mstatus success/failure/pending のレスポンス写像
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";
import { createHash } from "crypto";
import type { VeritransConfig } from "./config";
import {
  registerAndCharge, chargeByAccount, updateCardByToken, deleteAccount, authorizeMpi,
} from "./paynowid";

type Captured = { path: string; params: any; authHash: string; rawBody: string };

const CCID = "A100000000000000000000cc";
const KEY = "test-merchant-key";

let server: Server;
let port: number;
let captured: Captured[] = [];
let nextResponse: any = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
let nextStatus = 200;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const rawBody = await readBody(req);
    const decoded = decodeURIComponent(rawBody);
    const json = JSON.parse(decoded);
    captured.push({ path: req.url ?? "", params: json.params, authHash: json.authHash, rawBody });
    res.statusCode = nextStatus;
    res.setHeader("Content-Type", "application/json");
    res.end(typeof nextResponse === "string" ? nextResponse : JSON.stringify(nextResponse));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as any).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => { nextStatus = 200; }); // 前テストの 5xx を持ち越さない

function cfg(): VeritransConfig {
  return {
    merchantCcid: CCID,
    merchantKey: KEY,
    tokenApiKey: "tk",
    production: false,
    baseUrl: `http://127.0.0.1:${port}/payment`,
    memberBaseUrl: `http://127.0.0.1:${port}/member`,
    dummyRequest: "1",
    source: "env",
  };
}

function last(): Captured {
  return captured[captured.length - 1];
}

/** サーバー側と同じ手順で authHash を再計算して検証 (受信した params の minify と一致するはず) */
function verifyHash(c: Captured) {
  // ボディの params 部分の文字列 (バイト単位) を取り出して検証する
  const decoded = decodeURIComponent(c.rawBody);
  const m = decoded.match(/^\{"params":(.*),"authHash":"([0-9a-f]{64})"\}$/);
  expect(m, "body 形式が {params, authHash} でない").toBeTruthy();
  const expected = createHash("sha256").update(CCID + m![1] + KEY, "utf8").digest("hex");
  expect(m![2]).toBe(expected);
}

describe("registerAndCharge (会員登録+カード登録+初回課金)", () => {
  it("正しい電文構造で /payment/Authorize/card に送る", async () => {
    nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
    const res = await registerAndCharge(
      { accountId: "MR0001", orderId: "MR0001_202607", amount: 1000, token: "tok-1", freeKey: "cust-1" },
      cfg(),
    );
    expect(res.ok).toBe(true);
    const c = last();
    expect(c.path).toBe("/payment/Authorize/card");
    verifyHash(c);
    expect(c.params.merchantCcid).toBe(CCID);                       // params 内に必須
    expect(c.params.txnVersion).toBe("2.0.0");
    expect(c.params.dummyRequest).toBe("1");
    expect(c.params.amount).toBe("1000");                           // 文字列
    expect(c.params.withCapture).toBe("true");
    expect(c.params.token).toBeUndefined();                          // top-level token は送らない
    expect(c.params.payNowIdParam.token).toBe("tok-1");              // トークンは payNowIdParam.token
    expect(c.params.payNowIdParam.accountParam.accountId).toBe("MR0001"); // accountParam 配下
    // freeKey は半角英数字へ整形される (ハイフン除去) — VeriTrans 自由項目の形式に合わせる
    expect(c.params.payNowIdParam.freeKey).toBe("cust1");
    expect(JSON.stringify(c.params)).not.toContain("memberAdd");     // 存在しないフラグを送らない
  });
});

describe("chargeByAccount (保存済み標準カードでの都度決済)", () => {
  it("token なし・accountParam.accountId のみで課金する", async () => {
    nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
    const res = await chargeByAccount(
      { accountId: "MR0001", orderId: "MR0001_202608", amount: 1000 },
      cfg(),
    );
    expect(res.ok).toBe(true);
    const c = last();
    expect(c.path).toBe("/payment/Authorize/card");
    verifyHash(c);
    expect(c.params.payNowIdParam.token).toBeUndefined();
    expect(c.params.payNowIdParam.accountParam.accountId).toBe("MR0001");
    expect(c.params.payNowIdParam.accountParam.cardParam).toBeUndefined(); // cardId 不要
  });

  it("mstatus=failure は ok=false + vResultCode を写像する", async () => {
    nextResponse = { result: { mstatus: "failure", vResultCode: "G083000000000000" } };
    const res = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_202609", amount: 1000 }, cfg());
    expect(res.ok).toBe(false);
    expect(res.pending).toBe(false);
    expect(res.vResultCode).toBe("G083000000000000");
  });

  it("mstatus=pending は ok=false かつ pending=true (在疑義扱い)", async () => {
    nextResponse = { result: { mstatus: "pending", vResultCode: "P001000000000000" } };
    const res = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_202610", amount: 1000 }, cfg());
    expect(res.ok).toBe(false);
    expect(res.pending).toBe(true);
  });
});

describe("会員管理系 API (別ベースURL {test-}paynowid/v1)", () => {
  it("deleteAccount は /member/Delete/account へ accountBasicParam.deleteCardInfo つきで送る", async () => {
    nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
    const res = await deleteAccount("MR0001", cfg());
    expect(res.ok).toBe(true);
    const c = last();
    expect(c.path).toBe("/member/Delete/account");
    verifyHash(c);
    const ap = c.params.payNowIdParam.accountParam;
    expect(ap.accountId).toBe("MR0001");
    expect(ap.accountBasicParam.deleteCardInfo).toBe("1");
    expect(c.params.orderId).toBeUndefined();                        // 会員管理系に orderId は無い
  });

  it("updateCardByToken は /member/Update/cardinfo へ cardParam.token + defaultCard で送る", async () => {
    nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
    const res = await updateCardByToken({ accountId: "MR0001", token: "tok-new" }, cfg());
    expect(res.ok).toBe(true);
    const c = last();
    expect(c.path).toBe("/member/Update/cardinfo");
    verifyHash(c);
    const ap = c.params.payNowIdParam.accountParam;
    expect(ap.accountId).toBe("MR0001");
    expect(ap.cardParam.token).toBe("tok-new");
    expect(ap.cardParam.defaultCard).toBe("1");
  });
});

describe("結果不明 (indeterminate) の判定 — 二重課金防止の要", () => {
  it("HTTP 5xx は indeterminate=true (確定失敗にしない)", async () => {
    nextStatus = 500;
    nextResponse = { result: { mstatus: "failure" } }; // 5xx なら中身に関わらず不明扱い
    const res = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_ind1", amount: 1000 }, cfg());
    nextStatus = 200;
    expect(res.ok).toBe(false);
    expect(res.pending).toBe(false);
    expect(res.indeterminate).toBe(true);
  });

  it("result を欠く不正応答 (mstatus 読めず) は indeterminate=true", async () => {
    nextResponse = { garbage: true };
    const res = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_ind2", amount: 1000 }, cfg());
    expect(res.ok).toBe(false);
    expect(res.indeterminate).toBe(true);
  });

  it("接続失敗 (到達不能ポート) は indeterminate=true", async () => {
    const deadCfg = { ...cfg(), baseUrl: "http://127.0.0.1:1/payment" }; // 到達不能
    const res = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_ind3", amount: 1000 }, deadCfg);
    expect(res.ok).toBe(false);
    expect(res.indeterminate).toBe(true);
    expect(res.transportError).toBeTruthy();
  });

  it("正常な success / failure は indeterminate=false (確定応答)", async () => {
    nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
    const ok = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_ind4", amount: 1000 }, cfg());
    expect(ok.ok).toBe(true);
    expect(ok.indeterminate).toBe(false);

    nextResponse = { result: { mstatus: "failure", vResultCode: "G083000000000000" } };
    const ng = await chargeByAccount({ accountId: "MR0001", orderId: "MR0001_ind5", amount: 1000 }, cfg());
    expect(ng.ok).toBe(false);
    expect(ng.indeterminate).toBe(false); // 確定失敗 (別orderIdでのリトライは許容)
  });
});

describe("authorizeMpi (3DS2.0 開始)", () => {
  it("serviceOptionType / pushUrl / redirectionUri を送り authStartUrl を写像する", async () => {
    nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000", authStartUrl: "https://3ds.example/start" } };
    const res = await authorizeMpi({
      orderId: "MR0001_202611", amount: 1000, token: "tok-3ds",
      accountId: "MR0001",
      pushUrl: "https://app.example/api/payments/veritrans/mpi-result",
      redirectionUri: "https://app.example/subscribe/complete",
    }, cfg());
    expect(res.ok).toBe(true);
    expect(res.authStartUrl).toBe("https://3ds.example/start");
    const c = last();
    expect(c.path).toBe("/payment/Authorize/mpi");
    verifyHash(c);
    expect(c.params.serviceOptionType).toBeTruthy();
    expect(c.params.pushUrl).toContain("mpi-result");
    expect(c.params.redirectionUri).toContain("complete");
    expect(c.params.payNowIdParam.token).toBe("tok-3ds");
    expect(c.params.payNowIdParam.accountParam.accountId).toBe("MR0001");
  });
});
