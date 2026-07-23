// tokenize.ts の電文組み立て検証 (money-path のオーケストレーションには触れない純検証)。
// 過去に card_expire の形式で不具合があったため "MM/YY" 整形を固定する。
import { describe, it, expect, vi, afterEach } from "vitest";
import { tokenizeCard } from "./tokenize";

function mockFetchOnce(response: any) {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { json: async () => response } as any;
  });
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("tokenizeCard 電文", () => {
  it("card_expire を MM/YY に整形し、西暦4桁は下2桁へ丸める", async () => {
    const calls = mockFetchOnce({ status: "success", token: "Tok123" });
    const r = await tokenizeCard("https://vt/4gtoken", "PUBKEY", {
      number: "4111 1111 1111 1111", expMonth: "1", expYear: "2030", cvc: "123",
    });
    expect(r.ok).toBe(true);
    expect(calls[0].body.card_expire).toBe("01/30");
    // カード番号は空白除去して送る
    expect(calls[0].body.card_number).toBe("4111111111111111");
    // 公開キーのみ送る (秘密鍵は送らない)
    expect(calls[0].body.token_api_key).toBe("PUBKEY");
    // 旧実装が想定していた token_key はレスポンスに無く、結果にも含めない
    expect((r as any).token).toBe("Tok123");
  });

  it("2桁年入力もそのまま MM/YY になる", async () => {
    const calls = mockFetchOnce({ status: "success", token: "T" });
    await tokenizeCard("https://vt/4gtoken", "K", {
      number: "4111111111111111", expMonth: "12", expYear: "28", cvc: "999",
    });
    expect(calls[0].body.card_expire).toBe("12/28");
  });

  it("status!=success はエラーとして扱う (PAN・コードは結果に含めない)", async () => {
    mockFetchOnce({ status: "failure", code: "T001", message: "invalid card" });
    const r = await tokenizeCard("https://vt/4gtoken", "K", {
      number: "4111111111111111", expMonth: "12", expYear: "30", cvc: "123",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid card");
  });
});
