// 運用シミュレーション: カレンダーを1日ずつ進めながら日次 Cron を回し、
// 「いつ・いくら決済されたか」を記録して検証する。
//
// 確認したいこと (何度も問われる要点なので、日付を動かして実際に確かめる):
//   1. 無料期間中は1円も課金されない
//   2. 課金開始日にちょうど1回、正しい金額で決済される
//   3. その後も毎月1日に決済され、金額は変わらない
//   4. 解約したら、その後いくら日が進んでも二度と決済されない
//   5. プラン変更した金額が次回の決済に反映される
//   6. 3DS 認証が終わっていない契約は決済対象にならない
//
// VeriTrans はモック HTTP サーバーで受け、実際に送られた金額を見て判定する。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server, type IncomingMessage } from "http";

const CCID = "A100000000000000000000cc";
const KEY = "test-merchant-key";

const mem = vi.hoisted(() => ({
  vtBaseUrl: "",
  contracts: [] as any[],
  charges: [] as any[],
  consents: [] as any[],
  seqContract: 0,
  seqCharge: 0,
}));
function resetMem() {
  mem.contracts.length = 0; mem.charges.length = 0; mem.consents.length = 0;
  mem.seqContract = 0; mem.seqCharge = 0;
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
      contact_email: null, free_key: null, canceled_at: null, ...row,
    };
    mem.contracts.push(c); return c;
  },
  getContractByAccountId: async (id: string) => mem.contracts.find((c) => c.account_id === id) ?? null,
  getContractById: async (id: string) => mem.contracts.find((c) => c.id === id) ?? null,
  updateContractRow: async (id: string, patch: any) => {
    const c = mem.contracts.find((x) => x.id === id); if (c) Object.assign(c, patch);
  },
  // 本番と同じ条件: 契約中/延滞 かつ 次回課金日 ≤ 対象日
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
  hasUnfinishedInitialCharge: async (cid: string) =>
    mem.charges.some((c) => c.contract_id === cid && c.kind === "initial" && c.ok === null),
  listInDoubt3dsCharges: async () => [],
  getChargeByOrderId: async (o: string) => mem.charges.find((c) => c.order_id === o) ?? null,
  claimChargeFinalization: async () => false,
  getLicenseKeyMap: async () => new Map<string, string | null>(),
  insertConsent: async (row: any) => { mem.consents.push(row); },
  updateServiceStartDate: async () => {},
  getServiceStartMap: async () => new Map<string, string | null>(),
  updateLicenseKey: async () => {},
  listCanceledContracts: async () => [],
}));

vi.mock("./entry-sheet", () => ({
  appendEntryRow: async () => {},
  appendCancelRow: async () => ({ ok: true }),
  assignLicenseKey: async () => null,
  updateEntryWithdrawalDate: async () => {},
  loadCancelSheetKeys: async () => null,
}));
vi.mock("./crm-adapter", () => ({
  supabaseCrmAdapter: () => ({
    upsertCustomer: async () => null, updateContract: async () => {}, recordConsent: async () => {},
  }),
}));
vi.mock("./signup-sheet", () => ({ appendSignupRow: async () => ({ ok: true }) }));
vi.mock("@/features/messages/send", () => ({ sendEmailViaSmtp: async () => ({ ok: true }) }));

let billing: typeof import("./billing");

// ---- モック VeriTrans ----
type Captured = { path: string; params: any };
let server: Server;
let captured: Captured[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req);
    captured.push({ path: req.url ?? "", params: JSON.parse(decodeURIComponent(raw)).params });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ result: { mstatus: "success", vResultCode: "A001000000000000" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  mem.vtBaseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  billing = await import("./billing");
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  resetMem();
  captured = [];
  process.env.PAYMENTS_FREE_MONTHS = "2";
  // Date だけ差し替える (タイマーは本物のまま = HTTP が固まらない)
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => { vi.useRealTimers(); });

/** その日の 10:00 JST (= 本番 Cron の起動時刻) に時計を合わせる */
function setToday(date: string) {
  vi.setSystemTime(new Date(`${date}T10:00:00+09:00`));
}

/** 実際に VeriTrans へ送られた「実課金」だけを取り出す (日付・金額) */
function chargeLog(): Array<{ date: string; amount: string }> {
  return captured
    .filter((c) => c.path === "/payment/Authorize/card" && c.params?.withCapture === "true")
    .map((c) => ({ date: c.params.__day, amount: c.params.amount }));
}

/** from〜to を1日ずつ進めながら日次 Cron を回す (本番の毎日1回の実行を再現) */
async function runDays(from: string, to: string): Promise<void> {
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const day = d.toISOString().slice(0, 10);
    setToday(day);
    const before = captured.length;
    await billing.runDailyCharges();
    // どの日に送信されたかを後から判定できるよう印を付ける
    for (let i = before; i < captured.length; i++) captured[i].params.__day = day;
    d = new Date(d.getTime() + 86400_000);
  }
}

function baseInput(over: Partial<Record<string, any>> = {}) {
  return {
    planId: "plus", name: "山田 太郎", phone: "090-1234-5678", email: "taro@example.com",
    paymentMethod: "card" as const, token: "tok-abc",
    consent: { termsVersion: "v1", ip: "203.0.113.1", userAgent: "vitest" },
    ...over,
  } as any;
}

// ─────────────────────────────────────────────────────

describe("課金開始日にちゃんと決済され、その後も毎月続くか", () => {
  it("申込8/12・利用開始9/1 → 無料期間は0円、11/1から毎月1日に1,320円", async () => {
    setToday("2026-08-12");
    const res = await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));
    expect(res.ok).toBe(true);

    const contract = mem.contracts[0];
    expect(contract.next_charge_date).toBe("2026-11-01");   // 課金開始日

    captured = [];   // 申込時のカード登録は除いて、以降の実課金だけを見る
    await runDays("2026-08-13", "2027-01-15");

    // 課金開始日から毎月1日ちょうど、金額は据え置き
    expect(chargeLog()).toEqual([
      { date: "2026-11-01", amount: "1320" },
      { date: "2026-12-01", amount: "1320" },
      { date: "2027-01-01", amount: "1320" },
    ]);
  });

  it("無料期間中は日次Cronを何日回しても1円も課金されない", async () => {
    setToday("2026-08-12");
    await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));

    captured = [];
    await runDays("2026-08-13", "2026-10-31");   // 課金開始日の前日まで

    expect(chargeLog()).toEqual([]);
  });

  it("同じ日にCronが二重で走っても、課金は1回だけ (二重課金しない)", async () => {
    setToday("2026-08-12");
    await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));

    captured = [];
    setToday("2026-11-01");
    await billing.runDailyCharges();
    await billing.runDailyCharges();     // 手動再実行・リトライ起動を想定
    await billing.runDailyCharges();

    expect(chargeLog().length).toBe(1);
  });

  it("Cronが数日止まっても、復旧した日にその月の分が課金される (取りこぼさない)", async () => {
    setToday("2026-08-12");
    await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));

    captured = [];
    // 11/1〜11/4 は Cron が動かなかった想定。11/5 に復旧
    await runDays("2026-11-05", "2026-11-30");

    expect(chargeLog()).toEqual([{ date: "2026-11-05", amount: "1320" }]);
    // 次回は 12/1 に戻る (遅れた分だけ課金日がずれ続けたりしない)
    expect(mem.contracts[0].next_charge_date).toBe("2026-12-01");
  });
});

describe("解約したら課金が止まるか", () => {
  it("解約した翌日以降、いくら日が進んでも二度と課金されない", async () => {
    setToday("2026-08-12");
    const res = await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));
    const accountId = res.ok ? res.accountId : "";

    captured = [];
    await runDays("2026-11-01", "2026-12-05");     // 11月・12月は課金される
    expect(chargeLog().map((c) => c.date)).toEqual(["2026-11-01", "2026-12-01"]);

    // 12/10 に解約
    setToday("2026-12-10");
    const cancel = await billing.cancelSubscription(accountId);
    expect(cancel.ok).toBe(true);

    const contract = mem.contracts[0];
    expect(contract.status).toBe("canceled");
    expect(contract.next_charge_date).toBeNull();   // 次回課金日が消える = 対象から外れる

    // 以降3ヶ月ぶん回しても一切課金されない
    captured = [];
    await runDays("2026-12-11", "2027-03-05");
    expect(chargeLog()).toEqual([]);
  });

  it("解約済みを再度解約しても課金は起きない (冪等)", async () => {
    setToday("2026-08-12");
    const res = await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));
    const accountId = res.ok ? res.accountId : "";

    setToday("2026-11-05");
    await billing.cancelSubscription(accountId);
    await billing.cancelSubscription(accountId);

    captured = [];
    await runDays("2026-11-06", "2027-02-05");
    expect(chargeLog()).toEqual([]);
  });

  it("課金開始日の当日に解約すれば、その月から課金されない", async () => {
    setToday("2026-08-12");
    const res = await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));
    const accountId = res.ok ? res.accountId : "";

    // 11/1 の Cron より前に解約した想定
    setToday("2026-11-01");
    await billing.cancelSubscription(accountId);

    captured = [];
    await runDays("2026-11-01", "2027-01-05");
    expect(chargeLog()).toEqual([]);
  });
});

describe("金額の変更が次の決済に反映されるか", () => {
  it("プラン変更で金額を上げると、次回の決済額が新しい金額になる", async () => {
    setToday("2026-08-12");
    await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));

    captured = [];
    await runDays("2026-11-01", "2026-11-02");
    expect(chargeLog()).toEqual([{ date: "2026-11-01", amount: "1320" }]);

    // 管理画面のプラン変更 = 契約の amount を書き換える
    mem.contracts[0].amount = 1870;

    captured = [];
    await runDays("2026-12-01", "2026-12-02");
    expect(chargeLog()).toEqual([{ date: "2026-12-01", amount: "1870" }]);
  });
});

describe("決済登録が終わっていない契約は課金されない", () => {
  it("3DS 認証待ち (suspended) のあいだは決済対象にならない", async () => {
    setToday("2026-08-12");
    await billing.registerSubscription(baseInput({ serviceStartDate: "2026-09-01" }));

    // 3DS 認証待ちの状態を再現 (start3dsSubscription はこの状態で契約を作る)
    mem.contracts[0].status = "suspended";

    captured = [];
    await runDays("2026-11-01", "2027-01-05");
    expect(chargeLog()).toEqual([]);
  });
});
