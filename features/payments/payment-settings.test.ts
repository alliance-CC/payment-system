// 課金設定の保存/読み出し。
//
// 読み出しは is_active=true の行だけを見るので、書き込み側で is_active を立て忘れると
// 「保存しました」と出るのに読み戻すと既定値に戻る (＝設定したのに反映されない)。
// 実際に検証環境で再現したため、書き込む内容をここで固定する。
import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = vi.hoisted(() => ({
  /** integrations テーブルの中身 */
  rows: [] as any[],
  /** insert / update に渡された内容 */
  inserted: [] as any[],
  updated: [] as any[],
}));

vi.mock("@/shared/db/service", () => ({
  createSupabaseService: () => ({
    from: () => {
      // eq() を何度でも重ねられるようにした最小の PostgREST 風スタブ
      const filters: Record<string, any> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filters[k] = v; return q; },
        limit: () => q,
        maybeSingle: async () => {
          const hit = mem.rows.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v));
          return { data: hit ?? null, error: null };
        },
        insert: async (payload: any) => {
          mem.inserted.push(payload);
          mem.rows.push({ id: `i${mem.rows.length + 1}`, ...payload });
          return { error: null };
        },
        update: (payload: any) => {
          mem.updated.push(payload);
          return {
            eq: async (_k: string, id: string) => {
              const r = mem.rows.find((x) => x.id === id);
              if (r) Object.assign(r, payload);
              return { error: null };
            },
          };
        },
      };
      return q;
    },
  }),
}));

const settings = await import("./payment-settings");

const BASE = {
  plans: [{ id: "plus", name: "暮らし安心プラスB", amount: 1320, cycle: "monthly" as const }],
  freeMonths: 3, chargeDay: 1,
  retryIntervalsDays: [1, 3, 7], retryMax: 3, cardExpiredCodes: [],
  cronBatchLimit: 200, notifyEmail: null, termsVersion: "2026-07-01",
  cancelPolicy: "end_of_month" as const,
};

beforeEach(() => {
  mem.rows.length = 0; mem.inserted.length = 0; mem.updated.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

describe("課金設定の保存 (新規作成)", () => {
  it("is_active=true を明示して作る (列の既定値に頼らない)", async () => {
    const r = await settings.savePaymentSettings(BASE);
    expect(r.ok).toBe(true);
    expect(mem.inserted).toHaveLength(1);
    expect(mem.inserted[0].is_active).toBe(true);
  });

  it("作ったあと、そのまま読み戻せる", async () => {
    await settings.savePaymentSettings(BASE);
    const loaded = await settings.loadPaymentSettings();
    expect(loaded.freeMonths).toBe(3);
  });
});

describe("課金設定の保存 (既存行の更新)", () => {
  it("既にある行を更新し、is_active を true に直す", async () => {
    mem.rows.push({
      id: "i1", provider: "payment_settings",
      tenant_id: "00000000-0000-0000-0000-000000000001",
      is_active: false, config: { freeMonths: 1 },
    });
    const r = await settings.savePaymentSettings(BASE);
    expect(r.ok).toBe(true);
    expect(mem.inserted).toHaveLength(0);          // 二重に行を作らない
    expect(mem.updated[0].is_active).toBe(true);   // 読めない状態から復帰できる
    expect((await settings.loadPaymentSettings()).freeMonths).toBe(3);
  });
});

describe("Cron が書く項目を管理画面の保存で消さない", () => {
  it("patchPaymentSettings は既存値を保ったまま一部だけ更新する", async () => {
    await settings.savePaymentSettings({ ...BASE, signupSheetId: "sheet-1" });
    await settings.patchPaymentSettings({
      lastChargeRun: { at: "2026-09-21T01:00:00.000Z", charged: 2, failed: 0, errors: 0 },
    });
    const loaded = await settings.loadPaymentSettings();
    expect(loaded.signupSheetId).toBe("sheet-1");        // 既存値が残る
    expect(loaded.lastChargeRun?.charged).toBe(2);       // 追加分も入る
    expect(loaded.freeMonths).toBe(3);
  });
});
