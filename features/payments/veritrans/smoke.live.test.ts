// VeriTrans 4G ライブ・スモークテスト (オプトイン)。
//
//   目的: テスト利用情報通知書の3値 (CCID / 鍵 / token_api_key) が揃ったら、
//         実際の /4gtoken トークン化 → 会員登録+初回課金 を検証環境に対して1件実行し、
//         「LP→カード→決済」の実機経路が通ることを確認する。
//
//   実行条件: 通常の `npx vitest run` では skip される (資格情報が無いため)。
//   実行方法:
//     VT_SMOKE=1 \
//     VT_MERCHANT_CCID=xxxx VT_MERCHANT_KEY=xxxx VT_TOKEN_API_KEY=xxxx \
//     npx vitest run features/payments/veritrans/smoke.live.test.ts
//
//   注意:
//     - VT_PRODUCTION は付けない (検証環境 test-paynow / dummyRequest=1 で実行)。
//     - カード番号 4111111111111111 は 4G 検証環境の標準テストカード。
//       PAN・セキュリティコードはコードにもログにも残さない (この値は公開テスト用)。
//     - 実行するとテスト加盟店に 1 件のダミー取引が発生する。
import { describe, it, expect } from "vitest";
import { VT_ENDPOINTS, VT_TXN_VERSION, type VeritransConfig } from "./config";
import { registerAndCharge } from "./paynowid";

const enabled =
  process.env.VT_SMOKE === "1" &&
  !!process.env.VT_MERCHANT_CCID &&
  !!process.env.VT_MERCHANT_KEY &&
  !!process.env.VT_TOKEN_API_KEY;

// 検証環境固定の設定を env から直接組む (DB / getIntegration には依存しない)
function envConfig(): VeritransConfig {
  return {
    merchantCcid: process.env.VT_MERCHANT_CCID!,
    merchantKey: process.env.VT_MERCHANT_KEY!,
    tokenApiKey: process.env.VT_TOKEN_API_KEY!,
    production: false,
    baseUrl: VT_ENDPOINTS.test,
    memberBaseUrl: VT_ENDPOINTS.memberTest,
    dummyRequest: "1",
    source: "env",
  };
}

// ブラウザの tokenize.ts と同じ電文で /4gtoken を叩く (サーバー側から代行)
async function tokenizeTestCard(tokenApiKey: string): Promise<string> {
  const res = await fetch(VT_ENDPOINTS.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token_api_key: tokenApiKey,
      card_number: "4111111111111111",
      card_expire: "12/30",
      security_code: "123",
      lang: "ja",
    }),
  });
  const json: any = await res.json().catch(() => null);
  if (json?.status !== "success" || !json?.token) {
    throw new Error(`tokenize failed: ${json?.message ?? json?.code ?? "unknown"}`);
  }
  return json.token as string;
}

describe.skipIf(!enabled)("VeriTrans 4G ライブ・スモーク (検証環境)", () => {
  it("トークン化 → 会員登録+初回課金 が成功する", async () => {
    const cfg = envConfig();
    expect(VT_TXN_VERSION).toBeTruthy();

    const token = await tokenizeTestCard(cfg.tokenApiKey);
    expect(token.length).toBeGreaterThan(0);

    // accountId / orderId は衝突しないよう env で一意に渡す (Date/Math は使えないため)。
    // accountId は VeriTrans §5 で英数字のみ (payment_contracts の制約も [A-Za-z0-9])。
    // VT_SMOKE_SUFFIX は英数字で渡すこと (例: $(date +%s))
    const suffix = (process.env.VT_SMOKE_SUFFIX ?? "smoke1").replace(/[^A-Za-z0-9]/g, "");
    const result = await registerAndCharge(
      {
        accountId: `smoke${suffix}`,
        orderId: `smoke${suffix}`,
        amount: 100,
        token,
      },
      cfg,
    );

    // 成否を必ず出力 (資格情報の妥当性・接続先の確認材料)
    // eslint-disable-next-line no-console
    console.log("[vt-smoke] result:", {
      ok: result.ok,
      mstatus: (result as any).mstatus,
      vResultCode: (result as any).vResultCode,
    });
    expect(result.ok).toBe(true);
  }, 30_000);
});
