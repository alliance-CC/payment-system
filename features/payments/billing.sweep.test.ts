// 在疑義スイーパー (sweepAbandoned3ds) の検証。
//
// 3DS の認証画面で離脱されると結果が返らず、課金行が ok=null のまま残って
// 管理ボードに「確認中」が居座り続ける (契約も suspended のままで課金されない)。
// スイーパーはそれを VeriTrans への照会経由で片付ける役だが、
//   - 金銭移動を伴う取引には触れないこと (勝手な失敗確定 → 別 orderId で二重課金)
//   - まだ認証中かもしれない取引には触れないこと
//   - 確定は必ず MpiGetResult の結果に従うこと (推測しない)
// が安全性の要なので、そこを固定する。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";

const CCID = "A100000000000000000000cc";
const KEY = "test-merchant-key";

/** 認証開始マーカー (billing.ts の MPI_WAIT_MARKER と同値)。期限は 15+5 分 */
const WAIT = "3DS-WAIT:";
const EXPIRED_AT = () => `${WAIT}${Date.now() - 30 * 60_000}`;   // 30分前 = 期限切れ
const FRESH_AT = () => `${WAIT}${Date.now() - 60_000}`;          // 1分前 = 認証中かも

const mem = vi.hoisted(() => ({
  vtBaseUrl: "",
  contracts: [] as any[],
  charges: [] as any[],
  seqContract: 0,
  seqCharge: 0,
}));

vi.mock("./veritrans/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./veritrans/config")>();
  return {
    ...actual,
    loadVeritransConfig: async () => ({
      merchantCcid: CCID, merchantKey: KEY, tokenApiKey: "tk", production: false,
      baseUrl: `${mem.vtBaseUrl}/payment`, memberBaseUrl: `${mem.vtBaseUrl}/member`,
      dummyRequest: "1" as const, source: "env" as const,
    }),
  };
});

vi.mock("./store", () => ({
  listInDoubt3dsCharges: async (limit: number) =>
    mem.charges
      .filter((c) => c.ok === null && c.kind === "initial" && c.order_id.includes("_3ds"))
      .slice(0, limit)
      .map((c) => ({ id: c.id, order_id: c.order_id, amount: c.amount, v_result_code: c.v_result_code })),
  getChargeByOrderId: async (orderId: string) =>
    mem.charges.find((c) => c.order_id === orderId) ?? null,
  getContractById: async (id: string) => mem.contracts.find((c) => c.id === id) ?? null,
  updateContractRow: async (id: string, patch: any) => {
    const c = mem.contracts.find((x) => x.id === id); if (c) Object.assign(c, patch);
  },
  claimChargeFinalization: async (id: string, r: any) => {
    const c = mem.charges.find((x) => x.id === id);
    if (!c || c.ok !== null) return false;          // ok IS NULL 条件付き UPDATE の再現
    Object.assign(c, r); return true;
  },
  getServiceStartMap: async (_ids: string[]) => new Map<string, string | null>(),
  updateLicenseKey: async () => {},
  // 以降は成功パスの後処理で参照されるだけ (このテストでは未使用)
  insertContract: async () => ({}), getContractByAccountId: async () => null,
  listDueContracts: async () => [], hasSuccessfulCharge: async () => false,
  hasInDoubtAttempt: async () => false, countConsentsForAccount: async () => 1,
  beginChargeAttempt: async () => "duplicate", finishChargeAttempt: async () => {},
  markChargePending: async () => {}, getInDoubtCharge: async () => null,
  insertConsent: async () => {}, updateServiceStartDate: async () => {},
}));

vi.mock("./entry-sheet", () => ({
  appendEntryRow: async () => {}, appendCancelRow: async () => {}, assignLicenseKey: async () => null,
}));
vi.mock("./crm-adapter", () => ({
  supabaseCrmAdapter: () => ({
    upsertCustomer: async () => null, updateContract: async () => {}, recordConsent: async () => {},
  }),
}));
vi.mock("./signup-sheet", () => ({ appendSignupRow: async () => ({ ok: true }) }));
vi.mock("@/features/messages/send", () => ({ sendEmailViaSmtp: async () => ({ ok: true }) }));

let billing: typeof import("./billing");

// ---- モック VeriTrans (MpiGetResult 照会の応答を差し替える) ----
let server: Server;
let queried: string[] = [];
let mpiResult: any = { result: { mstatus: "success", vResultCode: "G021000000000000" } };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const json = JSON.parse(decodeURIComponent(raw));
    queried.push(String(json.params?.orderId ?? ""));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(mpiResult));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  mem.vtBaseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  billing = await import("./billing");
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  mem.contracts.length = 0; mem.charges.length = 0;
  mem.seqContract = 0; mem.seqCharge = 0;
  queried = [];
  mpiResult = { result: { mstatus: "success", vResultCode: "G021000000000000" } };
});

/** 「3DS 認証待ちのまま放置された申込」を1件作る */
function seedPending(opts: { amount?: number; marker?: string | null; kind?: string; orderId?: string } = {}) {
  const contract = {
    id: `c${++mem.seqContract}`, tenant_id: "t1", account_id: `MR${mem.seqContract}`,
    customer_id: null, plan_id: "plus", plan_name: "暮らし安心プラス", amount: 1980,
    payment_method: "card", status: "suspended", started_at: new Date().toISOString(),
    anchor_day: 1, next_charge_date: "2026-10-01", consecutive_failures: 0,
    last_result_code: null, last_charged_at: null,
    contact_name: "小松 圭太郎", contact_phone: "09000000000", contact_email: null, free_key: null,
  };
  mem.contracts.push(contract);
  const charge = {
    id: `ch${++mem.seqCharge}`, tenant_id: "t1", contract_id: contract.id,
    order_id: opts.orderId ?? `${contract.account_id}_202608_3ds`,
    charge_month: "2026-08", kind: opts.kind ?? "initial",
    amount: opts.amount ?? 0, ok: null, mstatus: null,
    v_result_code: opts.marker === undefined ? EXPIRED_AT() : opts.marker,
  };
  mem.charges.push(charge);
  return { contract, charge };
}

describe("在疑義スイーパー — 放置された3DS申込の片付け", () => {
  it("期限切れの0円与信を失敗確定し、契約を canceled にして再申込を解放する", async () => {
    const { contract, charge } = seedPending();
    // 照会しても本人認証の結果が無い = 認証未完了のまま放置された状態
    mpiResult = { result: { mstatus: "success", vResultCode: "G021000000000000" } };

    const s = await billing.sweepAbandoned3ds();

    expect(s.scanned).toBe(1);
    expect(s.closed).toBe(1);
    expect(charge.ok).toBe(false);
    expect(charge.v_result_code).toBe("3DS-EXPIRED");
    expect(contract.status).toBe("canceled");
    expect(contract.next_charge_date).toBeNull();
  });

  it("照会したら実は成功していた取引は、失敗にせず契約を有効化する (通知が失われた救済)", async () => {
    const { contract, charge } = seedPending();
    mpiResult = {
      result: {
        mstatus: "success", vResultCode: "G021000000000000",
        mpiMstatus: "success", mpiVresultCode: "G011A00100000000", cardMstatus: "success",
      },
    };

    const s = await billing.sweepAbandoned3ds();

    expect(s.activated).toBe(1);
    expect(s.closed).toBe(0);
    expect(charge.ok).toBe(true);
    expect(contract.status).toBe("active");
  });

  it("認証開始から間もない取引には触れない (認証中の可能性があるため照会もしない)", async () => {
    const { contract, charge } = seedPending({ marker: FRESH_AT() });

    const s = await billing.sweepAbandoned3ds();

    expect(s.stillPending).toBe(1);
    expect(queried).toHaveLength(0);          // VT への照会自体を行わない
    expect(charge.ok).toBeNull();
    expect(contract.status).toBe("suspended");
  });

  it("金額ありの取引には触れない (勝手な失敗確定は二重課金を生むため手動確定に回す)", async () => {
    const { contract, charge } = seedPending({ amount: 1980 });

    const s = await billing.sweepAbandoned3ds();

    expect(s.skippedPaid).toBe(1);
    expect(s.closed).toBe(0);
    expect(queried).toHaveLength(0);
    expect(charge.ok).toBeNull();
    expect(contract.status).toBe("suspended");
  });

  it("日次課金の在疑義 (recurring) は対象外 — 走査すらしない", async () => {
    const { charge } = seedPending({ kind: "recurring", orderId: "MR1_202610" });

    const s = await billing.sweepAbandoned3ds();

    expect(s.scanned).toBe(0);
    expect(charge.ok).toBeNull();
  });

  it("複数回実行しても結果は変わらない (冪等)", async () => {
    const { contract, charge } = seedPending();

    const first = await billing.sweepAbandoned3ds();
    const second = await billing.sweepAbandoned3ds();

    expect(first.closed).toBe(1);
    expect(second.scanned).toBe(0);            // 確定済みは在疑義一覧から外れる
    expect(charge.ok).toBe(false);
    expect(contract.status).toBe("canceled");
  });
});
