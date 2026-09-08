// ⑤ データローダ用CSV に「何を載せて何を載せないか」の取り決め。
//
// 実際の抽出は Supabase のクエリ + フィルタで行っているため、ここではその条件を
// 同じ規則の述語として書き下し、境界がずれないよう固定する。
import { describe, it, expect } from "vitest";
import { chargeStartDateFrom } from "./billing-config";

type Contract = {
  safCaseNo: string;            // SAF案件番号 (未入力は空)
  planName: string;             // 付帯名
  startedAt: string;            // 申込日
  canceledAt: string;           // 解約日 (未解約は空)
  initialChargeOk: boolean | null | undefined; // 初回課金の結果 (undefined = 記録なし)
};

/** 申込が成立しているか (3DS 離脱・認証失敗は成立していない) */
const completed = (c: Contract) => c.initialChargeOk === undefined || c.initialChargeOk === true;

/** データローダ用CSVに載せる条件: 申込日が期間内 / 成立済み / SAF案件番号あり */
function inDataLoaderCsv(c: Contract, from: string, to: string): boolean {
  if (!completed(c)) return false;              // 申込未完了は渡さない
  if (!c.safCaseNo.trim()) return false;        // 取込キーが無い行は入れても使えない
  return c.startedAt >= from && c.startedAt <= to;
}

const base: Contract = {
  safCaseNo: "SAF-0001",
  planName: "暮らし安心プラスB",
  startedAt: "2026-08-12",
  canceledAt: "",
  initialChargeOk: true,
};

describe("データローダ用CSVに載せる条件", () => {
  it("SAF案件番号が入っている期間内の案件を載せる", () => {
    expect(inDataLoaderCsv(base, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("SAF案件番号が未入力なら載せない (取込キーが無く使えないため)", () => {
    expect(inDataLoaderCsv({ ...base, safCaseNo: "" }, "2026-08-01", "2026-08-31")).toBe(false);
    expect(inDataLoaderCsv({ ...base, safCaseNo: "   " }, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("解約済みも載せる (解約日を渡すための出力なので除外しない)", () => {
    const canceled = { ...base, canceledAt: "2026-09-20" };
    expect(inDataLoaderCsv(canceled, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("3DS離脱などの申込未完了は載せない", () => {
    expect(inDataLoaderCsv({ ...base, initialChargeOk: false }, "2026-08-01", "2026-08-31")).toBe(false);
  });

  it("初回課金の記録が無い旧フローの契約は載せる (成立扱い)", () => {
    expect(inDataLoaderCsv({ ...base, initialChargeOk: undefined }, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("期間の境界は月初・月末を含む", () => {
    expect(inDataLoaderCsv({ ...base, startedAt: "2026-08-01" }, "2026-08-01", "2026-08-31")).toBe(true);
    expect(inDataLoaderCsv({ ...base, startedAt: "2026-08-31" }, "2026-08-01", "2026-08-31")).toBe(true);
    expect(inDataLoaderCsv({ ...base, startedAt: "2026-07-31" }, "2026-08-01", "2026-08-31")).toBe(false);
    expect(inDataLoaderCsv({ ...base, startedAt: "2026-09-01" }, "2026-08-01", "2026-08-31")).toBe(false);
  });
});

describe("出力する4項目", () => {
  /** 実装と同じ組み立て (SAF案件番号 / 付帯名 / 課金開始日 / 解約日) */
  const toRow = (c: Contract, serviceStart: string, freeMonths = 2, chargeDay = 1) => ({
    safCaseNo: c.safCaseNo.trim(),
    serviceName: c.planName,
    chargeStartDate: chargeStartDateFrom(serviceStart, freeMonths, chargeDay),
    canceledDate: c.canceledAt,
  });

  it("課金開始日は管理ボード・エントリーCSVと同じ規則 (利用開始日+無料期間)", () => {
    const row = toRow(base, "2026-09-01");
    expect(row.chargeStartDate).toBe("2026-11-01");
  });

  it("未解約の解約日は空欄", () => {
    expect(toRow(base, "2026-09-01").canceledDate).toBe("");
  });

  it("解約済みは解約日が入る", () => {
    expect(toRow({ ...base, canceledAt: "2026-12-10" }, "2026-09-01").canceledDate).toBe("2026-12-10");
  });

  it("付帯名はプラン名をそのまま出す (A/Bの別も含む)", () => {
    expect(toRow(base, "2026-09-01").serviceName).toBe("暮らし安心プラスB");
    expect(toRow({ ...base, planName: "暮らし安心プレミアムB" }, "2026-09-01").serviceName)
      .toBe("暮らし安心プレミアムB");
  });

  it("SAF案件番号は前後の空白を落として出す", () => {
    expect(toRow({ ...base, safCaseNo: "  SAF-0001  " }, "2026-09-01").safCaseNo).toBe("SAF-0001");
  });
});
