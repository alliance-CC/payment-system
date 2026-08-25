// エントリーCSV / 解約CSV に「何を載せて何を載せないか」の取り決め。
//
// 実際の抽出は Supabase のクエリ条件で行っているため、ここではその条件を
// 同じ規則の述語として書き下し、境界がずれないよう固定する。
import { describe, it, expect } from "vitest";

type Contract = {
  accountId: string;
  startedAt: string;            // 申込日
  canceledAt: string | null;    // 解約日 (未解約は null)
  initialChargeOk: boolean | null | undefined; // 初回課金の結果 (undefined = 記録なし)
};

/** 申込が成立しているか (3DS 離脱・認証失敗は成立していない) */
const completed = (c: Contract) => c.initialChargeOk === undefined || c.initialChargeOk === true;

/** エントリーCSVに載せる条件: 申込日が期間内 / 成立済み / 未解約 */
function inEntryCsv(c: Contract, from: string, to: string): boolean {
  if (c.canceledAt) return false;                 // 解約済みは新規エントリーとして渡さない
  if (!completed(c)) return false;                // 申込未完了は渡さない
  return c.startedAt >= from && c.startedAt <= to;
}

/** 解約CSVに載せる条件: 解約日が期間内 / 成立済み (未成立の3DS離脱は「解約」ではない) */
function inCancelCsv(c: Contract, from: string, to: string): boolean {
  if (!c.canceledAt) return false;
  if (!completed(c)) return false;
  return c.canceledAt >= from && c.canceledAt <= to;
}

const active: Contract = { accountId: "MR-A", startedAt: "2026-08-12", canceledAt: null, initialChargeOk: true };
const canceled: Contract = { accountId: "MR-B", startedAt: "2026-08-12", canceledAt: "2026-08-20", initialChargeOk: true };
const abandoned: Contract = { accountId: "MR-C", startedAt: "2026-08-12", canceledAt: "2026-08-12", initialChargeOk: false };
const legacy: Contract = { accountId: "MR-D", startedAt: "2026-08-12", canceledAt: null, initialChargeOk: undefined };

describe("エントリーCSV", () => {
  it("期間内の申込を載せる", () => {
    expect(inEntryCsv(active, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("解約済みは載せない (解約はエントリーではなく解約CSVの担当)", () => {
    expect(inEntryCsv(canceled, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("申込月をあとから出力し直しても、解約済みが新規として混ざらない", () => {
    const rows = [active, canceled].filter((c) => inEntryCsv(c, "2026-08-01", "2026-08-31"));
    expect(rows.map((r) => r.accountId)).toEqual(["MR-A"]);
  });

  it("3DS離脱などの申込未完了は載せない", () => {
    expect(inEntryCsv(abandoned, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("初回課金の記録が無い旧フローの契約は載せる (成立扱い)", () => {
    expect(inEntryCsv(legacy, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("期間外の申込は載せない (月初・月末は含む)", () => {
    expect(inEntryCsv(active, "2026-09-01", "2026-09-30")).toBe(false);
    expect(inEntryCsv({ ...active, startedAt: "2026-08-01" }, "2026-08-01", "2026-08-31")).toBe(true);
    expect(inEntryCsv({ ...active, startedAt: "2026-08-31" }, "2026-08-01", "2026-08-31")).toBe(true);
  });
});

describe("解約CSV", () => {
  it("期間内の解約を載せる", () => {
    expect(inCancelCsv(canceled, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("未解約は載せない", () => {
    expect(inCancelCsv(active, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("3DS離脱で残った契約は「解約」ではないので載せない", () => {
    expect(inCancelCsv(abandoned, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("解約日の軸で抽出する (申込日ではない)", () => {
    // 7月申込・8月解約 → 8月の解約CSVに載る
    const julySignup = { ...canceled, startedAt: "2026-07-05" };
    expect(inCancelCsv(julySignup, "2026-08-01", "2026-08-31")).toBe(true);
    expect(inCancelCsv(julySignup, "2026-07-01", "2026-07-31")).toBe(false);
  });
});

describe("エントリーCSVと解約CSVは同じ案件を二重に出さない", () => {
  it("解約済みの案件はエントリー側から外れ、解約側にだけ出る", () => {
    const range: [string, string] = ["2026-08-01", "2026-08-31"];
    expect(inEntryCsv(canceled, ...range)).toBe(false);
    expect(inCancelCsv(canceled, ...range)).toBe(true);
  });
});
