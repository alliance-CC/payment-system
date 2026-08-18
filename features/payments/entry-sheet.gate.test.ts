// ① 連携スプレッドシート「エントリー」へ書く条件の検証。
//
// エントリーに入れてよいのは「申込が成立したもの」= 管理ボードで 利用前/利用中 になった契約だけ。
// 3DS 認証画面で離脱した等で決済登録が終わっていない契約は「申込未完了」であり、課金もされない。
// これを成立した申込と同じ行として残すと、シートを見て利用開始の手配が進んでしまう。
//   - 未完了のあいだは書かない
//   - あとから成立したら (手動確定・古い未確定行の片付け) その時点で書く
//   - どの経路から何度書きに来ても行は増えない (顧客IDで重複判定)
// が要件なので、そこを固定する。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";
import { pickTargetRow, netlifeStartDate } from "./entry-sheet";

const CCID = "A100000000000000000000cc";
const KEY = "test-merchant-key";
const WAIT = "3DS-WAIT:";
const EXPIRED_AT = () => `${WAIT}${Date.now() - 30 * 60_000}`;   // 30分前 = 期限切れ

const mem = vi.hoisted(() => ({
  vtBaseUrl: "",
  contracts: [] as any[],
  charges: [] as any[],
  /** エントリータブに書かれた行 (顧客IDで重複排除された結果) */
  entries: [] as any[],
  licenses: [] as any[],
  seq: 0,
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
  getChargeByOrderId: async (orderId: string) => mem.charges.find((c) => c.order_id === orderId) ?? null,
  getContractById: async (id: string) => mem.contracts.find((c) => c.id === id) ?? null,
  updateContractRow: async (id: string, patch: any) => {
    const c = mem.contracts.find((x) => x.id === id); if (c) Object.assign(c, patch);
  },
  claimChargeFinalization: async (id: string, r: any) => {
    const c = mem.charges.find((x) => x.id === id);
    if (!c || c.ok !== null) return false;
    Object.assign(c, r); return true;
  },
  finishChargeAttempt: async (id: string, r: any) => {
    const c = mem.charges.find((x) => x.id === id); if (c) Object.assign(c, r);
  },
  getInDoubtCharge: async (id: string) => {
    const c = mem.charges.find((x) => x.id === id); return c && c.ok === null ? c : null;
  },
  // 「申込未完了」の判定 (admin-query の pendingInitial と同条件)
  hasUnfinishedInitialCharge: async (cid: string) =>
    mem.charges.some((c) => c.contract_id === cid && c.kind === "initial" && c.ok === null),
  getLicenseKeyMap: async (ids: string[]) =>
    new Map(ids.map((id) => [id, mem.contracts.find((c) => c.id === id)?.license_key ?? null])),
  updateLicenseKey: async (id: string, key: string | null) => {
    const c = mem.contracts.find((x) => x.id === id); if (c) c.license_key = key;
  },
  getServiceStartMap: async (_ids: string[]) => new Map<string, string | null>(),
  insertContract: async () => ({}), getContractByAccountId: async () => null,
  listDueContracts: async () => [], hasSuccessfulCharge: async () => false,
  hasInDoubtAttempt: async () => false, countConsentsForAccount: async () => 1,
  beginChargeAttempt: async () => "duplicate", markChargePending: async () => {},
  insertConsent: async () => {}, updateServiceStartDate: async () => {},
}));

// エントリータブの代役 (顧客IDの重複は本物と同じく書かない)。
// 書き込み先の行を決める pickTargetRow は本物をそのまま使う (下の describe で検証)。
vi.mock("./entry-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./entry-sheet")>();
  return {
    ...actual,
    appendEntryRow: async (row: any) => {
      if (mem.entries.some((e) => e.customerId === row.customerId)) return "duplicate";
      mem.entries.push(row); return "written";
    },
    appendCancelRow: async () => {},
    assignLicenseKey: async (accountId: string) => {
      mem.licenses.push(accountId); return `KEY-${mem.licenses.length}`;
    },
  };
});
vi.mock("./crm-adapter", () => ({
  supabaseCrmAdapter: () => ({
    upsertCustomer: async () => null, updateContract: async () => {}, recordConsent: async () => {},
  }),
}));
vi.mock("./signup-sheet", () => ({ appendSignupRow: async () => ({ ok: true }) }));
vi.mock("@/features/messages/send", () => ({ sendEmailViaSmtp: async () => ({ ok: true }) }));

let billing: typeof import("./billing");

// ---- モック VeriTrans (MpiGetResult 照会) ----
let server: Server;
let mpiResult: any;
const AUTH_OK = {
  result: {
    mstatus: "success", vResultCode: "G021000000000000",
    mpiMstatus: "success", mpiVresultCode: "G011A00100000000", cardMstatus: "success",
  },
};
/** 本人認証の結果が無い = 認証未完了のまま放置された状態 */
const AUTH_NONE = { result: { mstatus: "success", vResultCode: "G021000000000000" } };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    await readBody(req);
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
  mem.entries.length = 0; mem.licenses.length = 0;
  mem.seq = 0;
  mpiResult = AUTH_OK;
});

/** 3DS 認証待ちの申込を1件 (契約 suspended + 初回取引 ok=null) 作る */
function seedApplication(opts: { plan?: "plus" | "premium"; amount?: number } = {}) {
  const n = ++mem.seq;
  const premium = opts.plan === "premium";
  const contract = {
    id: `c${n}`, tenant_id: "t1", account_id: `MR${n}`, customer_id: null,
    plan_id: premium ? "premium" : "plus",
    plan_name: premium ? "暮らし安心プレミアム" : "暮らし安心プラス",
    amount: 1980, payment_method: "card", status: "suspended",
    started_at: new Date().toISOString(), anchor_day: 1, next_charge_date: "2026-10-01",
    consecutive_failures: 0, last_result_code: null, last_charged_at: null,
    contact_name: "小松 圭太郎", contact_phone: "09000000000", contact_email: null,
    free_key: null, license_key: null,
  };
  mem.contracts.push(contract);
  const charge = addCharge(contract.id, { amount: opts.amount ?? 0 });
  return { contract, charge };
}

function addCharge(contractId: string, opts: { amount?: number; orderId?: string } = {}) {
  const n = mem.charges.length + 1;
  const contract = mem.contracts.find((c) => c.id === contractId)!;
  const charge = {
    id: `ch${n}`, tenant_id: "t1", contract_id: contractId,
    order_id: opts.orderId ?? `${contract.account_id}_202608_3ds_s${n}`,
    charge_month: "2026-08", kind: "initial", amount: opts.amount ?? 0,
    ok: null, mstatus: null, v_result_code: EXPIRED_AT(),
  };
  mem.charges.push(charge);
  return charge;
}

describe("エントリーに入れるのは申込が成立したものだけ", () => {
  it("3DS 認証が完了して利用前になった申込は書く", async () => {
    const { contract, charge } = seedApplication();

    const fin = await billing.finalizeMpiOrder(charge.order_id);

    expect(fin.state).toBe("activated");
    expect(contract.status).toBe("active");
    expect(mem.entries).toHaveLength(1);
    expect(mem.entries[0]).toMatchObject({
      customerId: contract.account_id,
      serviceName: contract.plan_name,
      lastNameKanji: "小松", firstNameKanji: "圭太郎",
    });
  });

  it("決済が完了していない (申込未完了の) 契約は書かない", async () => {
    const { contract, charge } = seedApplication();
    // 同じ契約に別試行の未確定行が残っている = 管理ボードでは「申込未完了」
    addCharge(contract.id);

    await billing.finalizeMpiOrder(charge.order_id);

    expect(charge.ok).toBe(true);            // 認証自体は成立している
    expect(mem.entries).toHaveLength(0);     // それでもシートには入れない
    expect(mem.licenses).toHaveLength(0);
  });

  it("認証されないまま放置された申込は書かない (スイープで解約されるだけ)", async () => {
    const { contract, charge } = seedApplication();
    mpiResult = AUTH_NONE;

    const s = await billing.sweepAbandoned3ds();

    expect(s.closed).toBe(1);
    expect(charge.ok).toBe(false);
    expect(contract.status).toBe("canceled");
    expect(mem.entries).toHaveLength(0);
  });

  it("古い未確定行が片付いて申込未完了でなくなったら、その時点で書く", async () => {
    const { contract, charge } = seedApplication();
    const stale = addCharge(contract.id);

    // 1) 認証は成功したが、古い未確定行のせいでシートには入らない
    await billing.finalizeMpiOrder(charge.order_id);
    expect(mem.entries).toHaveLength(0);

    // 2) スイープが古い行をみなし失敗で閉じる → 申込未完了ではなくなる
    mpiResult = AUTH_NONE;
    const s = await billing.sweepAbandoned3ds();

    expect(s.closed).toBe(1);
    expect(stale.ok).toBe(false);
    expect(contract.status).toBe("active");   // 成立済みの契約は解約されない
    expect(mem.entries).toHaveLength(1);
    expect(mem.entries[0].customerId).toBe(contract.account_id);
  });

  it("在疑義を手動で成功確定したら、その時点で書く (プレミアムはライセンスキーも付与)", async () => {
    const { contract, charge } = seedApplication({ plan: "premium", amount: 1980 });

    const res = await billing.resolveInDoubtCharge(charge.id, true);

    expect(res.ok).toBe(true);
    expect(contract.status).toBe("active");
    expect(mem.entries).toHaveLength(1);
    expect(mem.licenses).toEqual([contract.account_id]);
    expect(contract.license_key).toBe("KEY-1");
  });

  it("失敗として確定した在疑義は書かない", async () => {
    const { charge } = seedApplication({ amount: 1980 });

    await billing.resolveInDoubtCharge(charge.id, false);

    expect(mem.entries).toHaveLength(0);
  });

  it("成立後に何度書きに来ても行は増えず、ライセンスキーも二重付与しない", async () => {
    const { contract, charge } = seedApplication({ plan: "premium" });

    await billing.finalizeMpiOrder(charge.order_id);     // 3DS 確定で1行目
    await billing.finalizeMpiOrder(charge.order_id);     // PUSH とブラウザ復帰の二重着信
    const stale = addCharge(contract.id, { orderId: `${contract.account_id}_202608_3ds_s9` });
    mpiResult = AUTH_NONE;
    await billing.sweepAbandoned3ds();                   // 片付け後の補完
    await billing.resolveInDoubtCharge(stale.id, true).catch(() => {});

    expect(mem.entries).toHaveLength(1);
    expect(mem.licenses).toHaveLength(1);
  });
});

describe("エントリー行の書き込み先 (pickTargetRow)", () => {
  const header = [["顧客ID", "ご契約日"]];

  it("見出しの次の空き行に書く", () => {
    expect(pickTargetRow(header, "MR1")).toEqual({ row: 2 });
  });

  it("途中の空行を上から埋める (シート側で行を用意しておける)", () => {
    const rows = [...header, ["MR1"], [""], ["MR3"]];
    expect(pickTargetRow(rows, "MR9")).toEqual({ row: 3 });
  });

  it("空きが無ければ最終行の次に追記する", () => {
    const rows = [...header, ["MR1"], ["MR2"]];
    expect(pickTargetRow(rows, "MR9")).toEqual({ row: 4 });
  });

  it("同じ顧客IDが既にあれば書かない (空行が先にあっても)", () => {
    const rows = [...header, ["MR1"], [""], ["MR3"]];
    expect(pickTargetRow(rows, "MR3")).toBe("duplicate");
  });

  it("顧客IDを渡さない場合は重複判定しない (解約タブ等)", () => {
    const rows = [...header, ["MR1"]];
    expect(pickTargetRow(rows)).toEqual({ row: 3 });
  });
});

describe("D列 ネトサポご利用開始日 (ご利用開始日の翌月1日)", () => {
  it("月の途中でも翌月1日になる", () => {
    expect(netlifeStartDate("2026-08-15")).toBe("2026-09-01");
    expect(netlifeStartDate("2026-08-01")).toBe("2026-09-01");
    expect(netlifeStartDate("2026-08-31")).toBe("2026-09-01");
  });

  it("年をまたぐ", () => {
    expect(netlifeStartDate("2026-12-20")).toBe("2027-01-01");
  });

  it("2月・31日の無い月でも1日固定なので破綻しない", () => {
    expect(netlifeStartDate("2026-01-31")).toBe("2026-02-01");
    expect(netlifeStartDate("2026-02-28")).toBe("2026-03-01");
  });

  it("利用開始日が不明なら空欄 (勝手な日付を先方へ渡さない)", () => {
    expect(netlifeStartDate("")).toBe("");
    expect(netlifeStartDate("2026-08")).toBe("");
    expect(netlifeStartDate("不明")).toBe("");
  });
});
