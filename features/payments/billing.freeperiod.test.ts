// ②無料期間(2ヶ月) / ③継続課金(会員ID都度決済) / ④解約(当月末まで利用可) の統合テスト。
//
// 「LP → 規約同意 → 決済登録 → CRM」の決済ロジックを、モック VeriTrans サーバー(実HTTP)+
// インメモリ store/CRM/シート/メールで end-to-end に駆動して機械検証する。
//   ② 申込時は「会員登録+カード登録のみ・課金なし(withCapture=false)」。初回課金日は
//      申込月+2ヶ月の1日 (2ヶ月無料・申込月含む)。申込時に revenue charge 行を作らない。
//   ③ 初回課金日に日次 Cron が「会員ID指定の都度決済」を実行し、以降毎月1日課金。
//   ④ 解約で VeriTrans 会員削除 + 契約 canceled + 次回課金停止、利用可能期限=当月末。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";
import {
  firstChargeDate, endOfMonth, todayJst, monthOf, nextChargeDateAfter,
} from "./billing-config";

const CCID = "A100000000000000000000cc";
const KEY = "test-merchant-key";

// ---- 純ヘルパーの単体検証 (ユーザー提示の例をそのまま固定) ----
describe("firstChargeDate — 無料期間後の初回課金日", () => {
  it("2026-05-15 申込 / 2ヶ月無料 → 2026-07-01 (5・6月無料 → 7月課金開始)", () => {
    expect(firstChargeDate("2026-05-15", 2)).toBe("2026-07-01");
  });
  it("年跨ぎ: 2026-11-20 申込 / 2ヶ月無料 → 2027-01-01", () => {
    expect(firstChargeDate("2026-11-20", 2)).toBe("2027-01-01");
  });
  it("無料期間 0 → 申込月の1日 (即時課金運用の基準)", () => {
    expect(firstChargeDate("2026-05-15", 0)).toBe("2026-05-01");
  });
});

describe("endOfMonth — 解約時の当月末(利用可能期限)", () => {
  it("2026-05-15 → 2026-05-31", () => expect(endOfMonth("2026-05-15")).toBe("2026-05-31"));
  it("2026-02-10 → 2026-02-28 (平年)", () => expect(endOfMonth("2026-02-10")).toBe("2026-02-28"));
});

// ---- インメモリ状態 (モック factory と本体が共有) ----
const mem = vi.hoisted(() => ({
  vtBaseUrl: "",
  contracts: [] as any[],
  charges: [] as any[],
  consents: [] as any[],
  crmCustomers: new Map<string, string>(),
  crmUpdates: [] as any[],
  emails: [] as any[],
  sheetRows: [] as any[],
  seqContract: 0,
  seqCharge: 0,
  seqCustomer: 0,
}));
function resetMem() {
  mem.contracts.length = 0; mem.charges.length = 0; mem.consents.length = 0;
  mem.crmCustomers.clear(); mem.crmUpdates.length = 0; mem.emails.length = 0; mem.sheetRows.length = 0;
  mem.seqContract = 0; mem.seqCharge = 0; mem.seqCustomer = 0;
}

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
  insertContract: async (row: any) => {
    const c = {
      id: `c${++mem.seqContract}`, started_at: new Date().toISOString(), customer_id: null,
      deal_id: null, plan_name: null, status: "active", consecutive_failures: 0,
      last_result_code: null, last_charged_at: null, contact_name: null, contact_phone: null,
      contact_email: null, free_key: null, ...row,
    };
    mem.contracts.push(c); return c;
  },
  getContractByAccountId: async (id: string) => mem.contracts.find((c) => c.account_id === id) ?? null,
  getContractById: async (id: string) => mem.contracts.find((c) => c.id === id) ?? null,
  updateContractRow: async (id: string, patch: any) => {
    const c = mem.contracts.find((x) => x.id === id); if (c) Object.assign(c, patch);
  },
  listDueContracts: async (dueDate: string, limit: number) =>
    mem.contracts
      .filter((c) => ["active", "delinquent"].includes(c.status) && c.next_charge_date && c.next_charge_date <= dueDate)
      .sort((a, b) => String(a.next_charge_date).localeCompare(String(b.next_charge_date)))
      .slice(0, limit).map((c) => ({ ...c })),
  hasSuccessfulCharge: async (cid: string, m: string) =>
    mem.charges.some((c) => c.contract_id === cid && c.charge_month === m && c.ok === true),
  hasInDoubtAttempt: async (cid: string, m: string) =>
    mem.charges.some((c) => c.contract_id === cid && c.charge_month === m && c.ok === null),
  countConsentsForAccount: async (id: string) => mem.consents.filter((c) => c.account_id === id).length,
  beginChargeAttempt: async (row: any) => {
    if (mem.charges.some((c) => c.order_id === row.order_id)) return "duplicate";
    const c = { id: `ch${++mem.seqCharge}`, ok: null, v_result_code: null, mstatus: null, ...row };
    mem.charges.push(c); return { id: c.id };
  },
  finishChargeAttempt: async (id: string, r: any) => {
    const c = mem.charges.find((x) => x.id === id); if (c) Object.assign(c, r);
  },
  markChargePending: async (id: string, i: any) => {
    const c = mem.charges.find((x) => x.id === id); if (c) { c.mstatus = i.mstatus; c.v_result_code = i.v_result_code; }
  },
  getInDoubtCharge: async (id: string) => {
    const c = mem.charges.find((x) => x.id === id); return c && c.ok === null ? c : null;
  },
  insertConsent: async (row: any) => { mem.consents.push(row); },
}));

vi.mock("./crm-adapter", () => ({
  supabaseCrmAdapter: () => ({
    upsertCustomer: async (key: any) => {
      const phone = String(key.phone ?? "").replace(/[^0-9]/g, "");
      let id = mem.crmCustomers.get(phone);
      if (!id) { id = `cust${++mem.seqCustomer}`; mem.crmCustomers.set(phone, id); }
      return id;
    },
    updateContract: async (customerId: string, state: any) => { mem.crmUpdates.push({ customerId, state }); },
    recordConsent: async () => {},
  }),
}));

vi.mock("./signup-sheet", () => ({
  appendSignupRow: async (row: any) => { mem.sheetRows.push(row); return { ok: true }; },
}));

vi.mock("@/features/messages/send", () => ({
  sendEmailViaSmtp: async (msg: any) => { mem.emails.push(msg); return { ok: true }; },
}));

let billing: typeof import("./billing");

// ---- モック VeriTrans HTTP サーバー ----
type Captured = { path: string; params: any };
let server: Server;
let captured: Captured[] = [];
let nextResponse: any = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
let nextStatus = 200;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const json = JSON.parse(decodeURIComponent(raw));
    captured.push({ path: req.url ?? "", params: json.params });
    res.statusCode = nextStatus;
    res.setHeader("Content-Type", "application/json");
    res.end(typeof nextResponse === "string" ? nextResponse : JSON.stringify(nextResponse));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  mem.vtBaseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  billing = await import("./billing");
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  resetMem(); captured = []; nextStatus = 200;
  nextResponse = { result: { mstatus: "success", vResultCode: "A001000000000000" } };
  process.env.PAYMENTS_FREE_MONTHS = "2"; // 2ヶ月無料 (申込月含む)
});

function baseInput() {
  return {
    planId: "plus", name: "山田 太郎", phone: "090-1234-5678", email: "taro@example.com",
    paymentMethod: "card" as const, token: "tok-abc", caseId: "deal-9001",
    consent: { termsVersion: "v1", ip: "203.0.113.1", userAgent: "vitest" },
  };
}
function lastCard() { return [...captured].reverse().find((c) => c.path === "/payment/Authorize/card"); }

describe("② 無料期間 (2ヶ月・申込月含む) — 申込時は登録のみ・課金なし", () => {
  it("申込時に会員+カード登録のみ (withCapture=false) で課金せず、初回課金日=申込月+2ヶ月の1日", async () => {
    const res = await billing.registerSubscription(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // VeriTrans へは与信のみ (capture=false) で送る = 申込時課金しない
    const card = lastCard();
    expect(card).toBeTruthy();
    expect(card!.params.withCapture).toBe("false");
    expect(card!.params.payNowIdParam.accountParam.accountId).toBe(res.accountId);
    expect(card!.params.payNowIdParam.token).toBe("tok-abc");

    // revenue の課金記録は作らない (申込時は無料)
    expect(mem.charges).toHaveLength(0);

    // 契約: active・暦月課金 (anchor=1)・初回課金日 = firstChargeDate(today,2)
    const expectedFirst = firstChargeDate(todayJst(), 2);
    expect(mem.contracts).toHaveLength(1);
    expect(mem.contracts[0]).toMatchObject({ status: "active", anchor_day: 1, next_charge_date: expectedFirst });
    expect(res.nextChargeDate).toBe(expectedFirst);
    // 初回課金日は「2ヶ月先の1日」
    expect(res.nextChargeDate).toMatch(/^\d{4}-\d{2}-01$/);

    // CRM へ active 反映 + 申込シート追記
    expect(mem.crmUpdates.some((u) => u.state.status === "active")).toBe(true);
    expect(mem.sheetRows).toHaveLength(1);
  });

  it("無料期間中は日次 Cron の課金対象にならない (初回課金日が未来)", async () => {
    await billing.registerSubscription(baseInput());
    const sum = await billing.runDailyCharges(); // 今日時点では初回課金日(2ヶ月先)は未到来
    expect(sum.charged).toBe(0);
    expect(sum.processed).toBe(0);
    expect(lastCard()!.params.withCapture).toBe("false"); // 直近のVT呼び出しは申込時の登録のみ
  });
});

describe("③ 継続課金 — 初回課金日に会員ID都度決済 → 以降毎月1日課金", () => {
  it("初回課金日が到来したら Cron が課金し、次回を翌月1日へ", async () => {
    const res = await billing.registerSubscription(baseInput());
    expect(res.ok).toBe(true);
    // 無料期間が明けた想定: 契約の初回課金日を今日に前倒しして Cron を回す
    const c = mem.contracts[0];
    c.next_charge_date = todayJst();
    captured = [];

    const sum = await billing.runDailyCharges();
    expect(sum.charged).toBe(1);

    // 会員ID都度決済 (token なし・accountId のみ) = パターン②
    const card = lastCard()!;
    expect(card.params.withCapture).toBe("true");           // 実課金 (売上確定)
    expect(card.params.payNowIdParam.token).toBeUndefined();
    expect(card.params.payNowIdParam.accountParam.accountId).toBe(res.ok ? res.accountId : "");
    expect(card.params.amount).toBe("1200");

    // 課金成功が記録され、次回課金日は翌月1日 (毎月1日課金)
    expect(mem.charges.some((x) => x.ok === true)).toBe(true);
    const today = todayJst();
    expect(c.status).toBe("active");
    expect(c.consecutive_failures).toBe(0);
    expect(c.next_charge_date).toBe(nextChargeDateAfter(monthOf(today), 1));
    expect(c.next_charge_date).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("2ヶ月連続で課金でき、毎回1日ずつ翌月へ進む (継続課金)", async () => {
    await billing.registerSubscription(baseInput());
    const c = mem.contracts[0];

    // 1ヶ月目 (課金月が別になるよう過去日を基準にする。同月内は二重課金ガードでスキップされるため)
    c.next_charge_date = "2020-01-01";
    await billing.runDailyCharges();
    const afterFirst = c.next_charge_date;      // → 2020-02-01
    expect(afterFirst).toBe("2020-02-01");

    // 2ヶ月目: 次回課金日 (2020-02-01) が到来した想定で再度 Cron
    await billing.runDailyCharges();
    const afterSecond = c.next_charge_date;      // → 2020-03-01

    // 2回とも成功課金が記録され (課金月が別)、課金日が1ヶ月進んでいる
    const okCharges = mem.charges.filter((x) => x.ok === true);
    expect(okCharges.length).toBe(2);
    expect(new Set(okCharges.map((x) => x.charge_month)).size).toBe(2);
    expect(afterSecond).toBe("2020-03-01");
    expect(afterSecond > afterFirst).toBe(true);
  });
});

describe("④ 解約 — 会員削除 + 契約canceled + 課金停止 + 当月末まで利用可", () => {
  it("解約すると canceled になり次回課金停止、利用可能期限=当月末、VeriTrans会員削除を呼ぶ", async () => {
    const res = await billing.registerSubscription(baseInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    captured = [];

    const cancel = await billing.cancelSubscription(res.accountId);
    expect(cancel.ok).toBe(true);
    // 「退会手続き当月末日まで利用可」= endOfMonth(today)
    expect(cancel.effectiveUntil).toBe(endOfMonth(todayJst()));

    // 契約は canceled・次回課金日は停止
    const c = mem.contracts[0];
    expect(c.status).toBe("canceled");
    expect(c.next_charge_date).toBeNull();

    // VeriTrans 会員削除 API (別ベースURL) を叩く
    expect(captured.some((x) => x.path === "/member/Delete/account")).toBe(true);

    // 解約後は日次 Cron の課金対象にならない
    captured = [];
    const sum = await billing.runDailyCharges();
    expect(sum.charged).toBe(0);
    expect(captured.filter((x) => x.path === "/payment/Authorize/card")).toHaveLength(0);
  });

  it("解約済みを再度解約しても冪等 (ok=true)", async () => {
    const res = await billing.registerSubscription(baseInput());
    if (!res.ok) return;
    await billing.cancelSubscription(res.accountId);
    const again = await billing.cancelSubscription(res.accountId);
    expect(again.ok).toBe(true);
  });
});
