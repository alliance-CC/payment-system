// 外部企業向けダッシュボードの月別絞り込み。
// 先方へ出すのはご契約日を軸にした月別一覧なので、その境界を固定する。
import { describe, it, expect } from "vitest";
import { filterByContractMonth, type PartnerRow } from "./partner-query";

const row = (contractDate: string, o: Partial<PartnerRow> = {}): PartnerRow => ({
  customerName: "山田 太郎",
  contractDate,
  serviceStartDate: "",
  withdrawalDate: "",
  serviceName: "暮らし安心プラスB",
  ...o,
});

describe("ご契約日での月別絞り込み", () => {
  const rows = [
    row("2026-07-31"),
    row("2026-08-01"),
    row("2026-08-31"),
    row("2026-09-01"),
  ];

  it("対象月のご契約だけを返す (月初・月末を含む)", () => {
    expect(filterByContractMonth(rows, "2026-08").map((r) => r.contractDate))
      .toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("空の月指定は全期間", () => {
    expect(filterByContractMonth(rows, "")).toHaveLength(4);
  });

  it("該当が無い月は空", () => {
    expect(filterByContractMonth(rows, "2026-01")).toHaveLength(0);
  });

  it("ご契約日が無い行は月別に出さない (全期間では出る)", () => {
    const withBlank = [...rows, row("")];
    expect(filterByContractMonth(withBlank, "2026-08")).toHaveLength(2);
    expect(filterByContractMonth(withBlank, "")).toHaveLength(5);
  });

  it("退会済みも対象月に含める (退会日を見せるための一覧なので除外しない)", () => {
    const canceled = [row("2026-08-10", { withdrawalDate: "2026-08-20" })];
    expect(filterByContractMonth(canceled, "2026-08")).toHaveLength(1);
  });
});
