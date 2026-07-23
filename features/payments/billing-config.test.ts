import { describe, it, expect } from "vitest";
import { monthOf, yyyymmOf, addDays, nextChargeDateAfter, recurringOrderId } from "./billing-config";

describe("課金日ヘルパー (JST基準の日付計算)", () => {
  it("monthOf / yyyymmOf", () => {
    expect(monthOf("2026-07-10")).toBe("2026-07");
    expect(yyyymmOf("2026-07-10")).toBe("202607");
  });

  it("addDays は月跨ぎ・年跨ぎを正しく処理する", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  describe("nextChargeDateAfter (翌月同日・月末丸め §5)", () => {
    it("通常日はそのまま翌月同日", () => {
      expect(nextChargeDateAfter("2026-07", 15)).toBe("2026-08-15");
    });
    it("31日アンカーは31日の無い月では月末に丸める", () => {
      expect(nextChargeDateAfter("2026-08", 31)).toBe("2026-09-30");
      expect(nextChargeDateAfter("2026-01", 31)).toBe("2026-02-28");
    });
    it("うるう年の2月は29日", () => {
      expect(nextChargeDateAfter("2028-01", 31)).toBe("2028-02-29");
      expect(nextChargeDateAfter("2028-01", 29)).toBe("2028-02-29");
    });
    it("12月アンカーの翌月は翌年1月", () => {
      expect(nextChargeDateAfter("2026-12", 10)).toBe("2027-01-10");
    });
  });

  describe("recurringOrderId (並行Cronでの決定的採番 — 二重課金防止)", () => {
    it("retryN=0 は base、retryN>0 は _rN", () => {
      expect(recurringOrderId("MR0001", "202607", 0)).toBe("MR0001_202607");
      expect(recurringOrderId("MR0001", "202607", 1)).toBe("MR0001_202607_r1");
      expect(recurringOrderId("MR0001", "202607", 3)).toBe("MR0001_202607_r3");
    });
    it("同一 (account, 月, retryN) は必ず同一 orderId (並行インスタンスが衝突する)", () => {
      // 2つの並行 Cron が同じ契約スナップショット (cf=0) から採番 → 同一 orderId
      const a = recurringOrderId("MR0001", "202607", 0);
      const b = recurringOrderId("MR0001", "202607", 0);
      expect(a).toBe(b); // order_id UNIQUE で一方が duplicate→skip になる
    });
    it("月・retryN が違えば別 orderId (正当なリトライ/翌月は区別される)", () => {
      const keys = [
        recurringOrderId("MR0001", "202607", 0),
        recurringOrderId("MR0001", "202607", 1),
        recurringOrderId("MR0001", "202608", 0),
      ];
      expect(new Set(keys).size).toBe(3);
    });
  });
});
