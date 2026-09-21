// 解約したときの連携スプレッドシートへの反映。
//
// 解約の記録は「エントリー」タブ H列の退会日 1か所だけ。月別の「2026.8解約」タブは
// シート側の GAS がこの退会日から作るので、ここが書けていないと解約が先方に伝わらない。
// そのため「書けたかどうか」を必ず呼び出し側 (管理画面) へ返すことを固定する。
import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = vi.hoisted(() => ({
  contracts: [] as any[],
  updates: [] as any[],
  /** エントリータブ H列への書き込み: 会員ID → 退会日 */
  withdrawals: [] as { accountId: string; date: string }[],
  /** updateEntryWithdrawalDate が返す結果 (会員ID単位で差し替え可能) */
  writeResult: new Map<string, any>(),
  /** 申込未完了 (3DS離脱等) の契約ID */
  incomplete: new Set<string>(),
  deletedAccounts: [] as string[],
}));

vi.mock("./store", () => ({
  getContractByAccountId: async (accountId: string) =>
    mem.contracts.find((c) => c.account_id === accountId) ?? null,
  updateContractRow: async (id: string, patch: any) => {
    mem.updates.push({ id, patch });
    const c = mem.contracts.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  },
  listCanceledContracts: async () => mem.contracts.filter((c) => c.canceled_at),
  getIncompleteContractIds: async (ids: string[]) =>
    new Set(ids.filter((id) => mem.incomplete.has(id))),
  // 以下は cancelSubscription / backfill では使わないが、billing.ts の import を満たす
  insertContract: async () => {}, getContractById: async () => null, listDueContracts: async () => [],
  hasSuccessfulCharge: async () => false, hasInDoubtAttempt: async () => false,
  countConsentsForAccount: async () => 0, beginChargeAttempt: async () => ({ id: "x" }),
  finishChargeAttempt: async () => {}, markChargePending: async () => {},
  getInDoubtCharge: async () => null, insertConsent: async () => {},
  updateServiceStartDate: async () => {}, getServiceStartMap: async () => new Map(),
  updateLicenseKey: async () => {}, getLicenseKeyMap: async () => new Map(),
  getChargeByOrderId: async () => null, claimChargeFinalization: async () => false,
  listInDoubt3dsCharges: async () => [], hasUnfinishedInitialCharge: async () => false,
  setServiceStartDate: async () => ({ ok: true }), hasChargedEver: async () => false,
}));

vi.mock("./entry-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./entry-sheet")>();
  return {
    ...actual,
    appendEntryRow: async () => {},
    assignLicenseKey: async () => null,
    updateEntryServiceDates: async () => ({ ok: true }),
    updateEntryWithdrawalDate: async (accountId: string, date: string) => {
      const forced = mem.writeResult.get(accountId);
      if (forced) return forced;
      mem.withdrawals.push({ accountId, date });
      return { ok: true };
    },
  };
});

vi.mock("./veritrans/config", () => ({
  loadVeritransConfig: async () => ({ baseUrl: "http://127.0.0.1:1", merchantCcid: "cc", merchantKey: "k" }),
}));
vi.mock("./veritrans/paynowid", () => ({
  deleteAccount: async (accountId: string) => { mem.deletedAccounts.push(accountId); return { ok: true }; },
  chargeByAccount: async () => ({ ok: true }),
  registerAccountWithCard: async () => ({ ok: true }),
}));
vi.mock("./crm-adapter", () => ({
  supabaseCrmAdapter: () => ({
    upsertCustomer: async () => null, updateContract: async () => {}, recordConsent: async () => {},
  }),
}));
vi.mock("./payment-settings", () => ({
  loadPaymentSettings: async () => ({ freeMonths: 2, chargeDay: 1, cancelPolicy: "end_of_month" }),
}));
vi.mock("./signup-sheet", () => ({ appendSignupRow: async () => ({ ok: true }) }));
vi.mock("@/features/messages/send", () => ({ sendEmailViaSmtp: async () => ({ ok: true }) }));

const billing = await import("./billing");
const { todayJst } = await import("./billing-config");

function seed(over: Partial<any> = {}) {
  const c = {
    id: "c1", tenant_id: "t1", account_id: "MR001", customer_id: "cust1",
    plan_id: "plus", plan_name: "暮らし安心プラスB", amount: 1200,
    payment_method: "card", status: "active",
    started_at: "2026-08-08T01:00:00.000Z", next_charge_date: "2026-10-01",
    canceled_at: null, ...over,
  };
  mem.contracts.push(c);
  return c;
}

beforeEach(() => {
  mem.contracts.length = 0;
  mem.updates.length = 0;
  mem.withdrawals.length = 0;
  mem.writeResult.clear();
  mem.incomplete.clear();
  mem.deletedAccounts.length = 0;
});

describe("解約したときのスプレッドシート反映", () => {
  it("エントリータブの退会日に解約日 (手続き日) を書く", async () => {
    seed();
    const res = await billing.cancelSubscription("MR001");

    expect(res.ok).toBe(true);
    expect(mem.withdrawals).toEqual([{ accountId: "MR001", date: todayJst() }]);
    expect(res.sheetOk).toBe(true);
    expect(res.sheetError).toBeUndefined();
  });

  it("シートに書く前に、課金停止と解約状態の更新が済んでいる", async () => {
    seed();
    await billing.cancelSubscription("MR001");

    const patch = mem.updates.at(-1)!.patch;
    expect(patch.status).toBe("canceled");
    expect(patch.next_charge_date).toBeNull();
    expect(patch.canceled_at).toBeTruthy();
    expect(mem.deletedAccounts).toEqual(["MR001"]);   // VeriTrans の会員(カード)も削除
  });

  it("退会日を書けなければ、その旨を理由つきで返す (画面に出せる)", async () => {
    seed();
    mem.writeResult.set("MR001", { ok: false, reason: "error", error: "Sheets API 500" });

    const res = await billing.cancelSubscription("MR001");
    expect(res.ok).toBe(true);                 // 解約・課金停止は成立している
    expect(res.sheetOk).toBe(false);
    expect(res.sheetError).toBe("Sheets API 500");
  });

  it("エントリータブに行が無い場合も、黙って成功にしない", async () => {
    seed();
    mem.writeResult.set("MR001", {
      ok: false, reason: "no-row", error: "エントリータブに会員ID MR001 の行がありません",
    });

    const res = await billing.cancelSubscription("MR001");
    expect(res.sheetOk).toBe(false);
    expect(res.sheetError).toContain("行がありません");
  });

  it("連携シートが未設定なら、未設定だと分かる文言を返す", async () => {
    seed();
    mem.writeResult.set("MR001", { ok: false, reason: "disabled" });

    const res = await billing.cancelSubscription("MR001");
    expect(res.sheetOk).toBe(false);
    expect(res.sheetError).toBe("連携スプレッドシートが未設定です");
  });

  it("シートが書けなくても課金は止まる (記録より停止を優先)", async () => {
    seed();
    mem.writeResult.set("MR001", { ok: false, reason: "error", error: "boom" });

    await billing.cancelSubscription("MR001");
    expect(mem.contracts[0].status).toBe("canceled");
    expect(mem.contracts[0].next_charge_date).toBeNull();
  });

  it("解約済みを再度解約してもシートを触らない (二重記録しない)", async () => {
    seed({ status: "canceled", canceled_at: "2026-09-01T00:00:00.000Z" });
    const res = await billing.cancelSubscription("MR001");

    expect(res.ok).toBe(true);
    expect(mem.withdrawals).toEqual([]);
  });
});

describe("退会日の記録漏れを補う (backfillWithdrawalDates)", () => {
  it("解約済みの全案件の退会日を埋め直す", async () => {
    seed({ id: "c1", account_id: "MR001", canceled_at: "2026-08-20T01:00:00.000Z", status: "canceled" });
    seed({ id: "c2", account_id: "MR002", canceled_at: "2026-09-03T01:00:00.000Z", status: "canceled" });

    const r = await billing.backfillWithdrawalDates();
    expect(r).toMatchObject({ ok: true, filled: 2, notFound: 0, skipped: 0 });
    expect(mem.withdrawals).toEqual([
      { accountId: "MR001", date: "2026-08-20" },
      { accountId: "MR002", date: "2026-09-03" },
    ]);
  });

  it("申込未完了 (3DS離脱) は解約ではないので書かない", async () => {
    seed({ id: "c1", account_id: "MR001", canceled_at: "2026-08-20T01:00:00.000Z", status: "canceled" });
    seed({ id: "c2", account_id: "MR002", canceled_at: "2026-08-21T01:00:00.000Z", status: "canceled" });
    mem.incomplete.add("c2");   // 初回登録取引が成功していない = エントリーしていない

    const r = await billing.backfillWithdrawalDates();
    expect(r).toMatchObject({ ok: true, filled: 1, skipped: 1 });
    expect(mem.withdrawals.map((w) => w.accountId)).toEqual(["MR001"]);
  });

  it("エントリー行が無い案件は notFound として件数を返す (打ち切らない)", async () => {
    seed({ id: "c1", account_id: "MR001", canceled_at: "2026-08-20T01:00:00.000Z", status: "canceled" });
    seed({ id: "c2", account_id: "MR002", canceled_at: "2026-08-21T01:00:00.000Z", status: "canceled" });
    mem.writeResult.set("MR001", { ok: false, reason: "no-row", error: "no row" });

    const r = await billing.backfillWithdrawalDates();
    expect(r).toMatchObject({ ok: true, filled: 1, notFound: 1 });
    expect(mem.withdrawals.map((w) => w.accountId)).toEqual(["MR002"]);
  });

  it("シート未設定・APIエラーはそこで打ち切り、原因を返す", async () => {
    seed({ id: "c1", account_id: "MR001", canceled_at: "2026-08-20T01:00:00.000Z", status: "canceled" });
    seed({ id: "c2", account_id: "MR002", canceled_at: "2026-08-21T01:00:00.000Z", status: "canceled" });
    mem.writeResult.set("MR001", { ok: false, reason: "disabled" });

    const r = await billing.backfillWithdrawalDates();
    expect(r.ok).toBe(false);
    expect(r.error).toBe("連携スプレッドシートが未設定です");
    expect(mem.withdrawals).toEqual([]);   // 2件目まで走らない
  });

  it("解約日が無い契約は対象外", async () => {
    seed({ id: "c1", account_id: "MR001", canceled_at: null, status: "active" });
    const r = await billing.backfillWithdrawalDates();
    expect(r).toMatchObject({ ok: true, filled: 0, skipped: 0 });
  });
});
