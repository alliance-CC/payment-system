// 管理ボードの絞り込みテスト。表示範囲(申込月/全案件)・タブ・検索の挙動を固定する。
import { describe, it, expect } from "vitest";
import {
  parseScope, isAppliedIn, filterByScope, filterByStatus, filterByQuery,
} from "./admin-filter";

type Row = {
  accountId: string;
  appliedAt: string;
  statusLabel: string;
  billingAlert: boolean;
  name: string | null;
  phone: string | null;
};

const row = (o: Partial<Row> & { accountId: string }): Row => ({
  appliedAt: "2026-08-10",
  statusLabel: "利用中",
  billingAlert: false,
  name: null,
  phone: null,
  ...o,
});

describe("表示範囲の読み取り", () => {
  it("未指定・不正値は「申込月のみ」", () => {
    expect(parseScope(undefined)).toBe("month");
    expect(parseScope(null)).toBe("month");
    expect(parseScope("")).toBe("month");
    expect(parseScope("month")).toBe("month");
    expect(parseScope("なにか")).toBe("month");
  });

  it("all のときだけ全案件", () => {
    expect(parseScope("all")).toBe("all");
  });
});

describe("申込月の判定", () => {
  it("申込日の年月が対象月と一致するもののみ", () => {
    expect(isAppliedIn("2026-08-01", "2026-08")).toBe(true);
    expect(isAppliedIn("2026-08-31", "2026-08")).toBe(true);
    expect(isAppliedIn("2026-07-31", "2026-08")).toBe(false);
    expect(isAppliedIn("2026-09-01", "2026-08")).toBe(false);
  });

  it("申込日が無い行は隠さない (見落とし防止)", () => {
    expect(isAppliedIn("", "2026-08")).toBe(true);
  });
});

describe("表示範囲での絞り込み", () => {
  const rows = [
    row({ accountId: "MR-A", appliedAt: "2026-08-05" }),
    row({ accountId: "MR-B", appliedAt: "2026-07-20" }),
    row({ accountId: "MR-C", appliedAt: "2026-08-28" }),
  ];

  it("申込月のみ: その月に申し込んだ案件だけを返す", () => {
    const got = filterByScope(rows, "month", "2026-08").map((r) => r.accountId);
    expect(got).toEqual(["MR-A", "MR-C"]);
  });

  it("対象月を変えると別の案件が出る", () => {
    const got = filterByScope(rows, "month", "2026-07").map((r) => r.accountId);
    expect(got).toEqual(["MR-B"]);
  });

  it("全案件: 対象月に関わらず全部返す", () => {
    expect(filterByScope(rows, "all", "2026-08")).toHaveLength(3);
  });

  it("該当が無い月は空 (全件表示に戻らない)", () => {
    expect(filterByScope(rows, "month", "2026-01")).toHaveLength(0);
  });
});

describe("ステータスタブでの絞り込み", () => {
  const rows = [
    row({ accountId: "MR-A", statusLabel: "利用中" }),
    row({ accountId: "MR-B", statusLabel: "解約" }),
    row({ accountId: "MR-C", statusLabel: "申込未完了", billingAlert: true }),
  ];

  it("all / 未指定は素通し", () => {
    expect(filterByStatus(rows, "all")).toHaveLength(3);
    expect(filterByStatus(rows, undefined)).toHaveLength(3);
  });

  it("ラベル一致で絞る", () => {
    expect(filterByStatus(rows, "解約").map((r) => r.accountId)).toEqual(["MR-B"]);
  });

  it("alert は要注意フラグで絞る", () => {
    expect(filterByStatus(rows, "alert").map((r) => r.accountId)).toEqual(["MR-C"]);
  });
});

describe("検索", () => {
  const rows = [
    row({ accountId: "MR7f9abc", name: "山田 太郎", phone: "09012345678" }),
    row({ accountId: "MR1a2b3c", name: "鈴木 花子", phone: "080-9876-5432" }),
  ];

  it("空の検索語は素通し", () => {
    expect(filterByQuery(rows, "")).toHaveLength(2);
    expect(filterByQuery(rows, "   ")).toHaveLength(2);
  });

  it("会員ID・お客様名の部分一致", () => {
    expect(filterByQuery(rows, "mr7f9").map((r) => r.accountId)).toEqual(["MR7f9abc"]);
    expect(filterByQuery(rows, "花子").map((r) => r.accountId)).toEqual(["MR1a2b3c"]);
  });

  it("電話番号はハイフン有無どちらで検索してもヒットする", () => {
    // 保存値がハイフン無し / 検索語がハイフン有り
    expect(filterByQuery(rows, "090-1234-5678").map((r) => r.accountId)).toEqual(["MR7f9abc"]);
    // 保存値がハイフン有り / 検索語がハイフン無し
    expect(filterByQuery(rows, "08098765432").map((r) => r.accountId)).toEqual(["MR1a2b3c"]);
  });

  it("該当なしは空", () => {
    expect(filterByQuery(rows, "存在しない")).toHaveLength(0);
  });
});
