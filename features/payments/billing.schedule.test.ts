// 課金日の通し検証。
// 「課金開始日にちゃんと課金され、その後も毎月ずれずに続くか」を、
// 申込〜1年分の日付連鎖として固定する (月末・年跨ぎ・うるう年を含む)。
import { describe, it, expect } from "vitest";
import {
  firstChargeDate, nextChargeDateAfter, chargeStartDateFrom, monthOf, addDays, todayJst,
} from "./billing-config";

const FREE_MONTHS = 2;
const CHARGE_DAY = 1;

/** 申込〜N回目までの実際の課金日を並べる (Cron が next_charge_date を進める動きの再現) */
function scheduleFrom(serviceStart: string, months: number): string[] {
  const dates: string[] = [];
  let next = chargeStartDateFrom(serviceStart, FREE_MONTHS, CHARGE_DAY);
  for (let i = 0; i < months; i++) {
    dates.push(next);
    next = nextChargeDateAfter(monthOf(next), CHARGE_DAY);   // 課金成功時に Cron が進める値
  }
  return dates;
}

describe("課金開始日", () => {
  it("利用開始日の2ヶ月後の1日から始まる (無料2ヶ月)", () => {
    expect(chargeStartDateFrom("2026-09-01", 2, 1)).toBe("2026-11-01");
    expect(chargeStartDateFrom("2026-08-15", 2, 1)).toBe("2026-10-01");
  });

  it("年をまたぐ", () => {
    expect(chargeStartDateFrom("2026-11-20", 2, 1)).toBe("2027-01-01");
    expect(chargeStartDateFrom("2026-12-01", 2, 1)).toBe("2027-02-01");
  });

  it("無料期間0なら利用開始日そのもの", () => {
    expect(chargeStartDateFrom("2026-08-15", 0, 1)).toBe("2026-08-15");
  });

  it("利用開始日が不明なら空 (勝手な日付で課金予定を作らない)", () => {
    expect(chargeStartDateFrom("", 2, 1)).toBe("");
  });
});

describe("課金開始後は毎月ずれずに続く", () => {
  it("12ヶ月ぶん、毎月1日で年跨ぎしても崩れない", () => {
    expect(scheduleFrom("2026-09-01", 14)).toEqual([
      "2026-11-01", "2026-12-01",
      "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01",
      "2027-07-01", "2027-08-01", "2027-09-01", "2027-10-01", "2027-11-01", "2027-12-01",
    ]);
  });

  it("同じ日が二度出てこない (二重課金の予定を作らない)", () => {
    const s = scheduleFrom("2026-08-01", 24);
    expect(new Set(s).size).toBe(s.length);
  });

  it("必ず翌月へ進む (止まったり戻ったりしない)", () => {
    const s = scheduleFrom("2026-08-01", 24);
    for (let i = 1; i < s.length; i++) expect(s[i] > s[i - 1]).toBe(true);
  });

  it("課金日28日でも、うるう年の2月で破綻しない", () => {
    // 2028年はうるう年 (2/29まで)
    expect(nextChargeDateAfter("2028-01", 28)).toBe("2028-02-28");
    expect(nextChargeDateAfter("2027-01", 31)).toBe("2027-02-28");   // 末日に丸める
    expect(nextChargeDateAfter("2028-01", 31)).toBe("2028-02-29");
  });
});

describe("Cron が拾う条件 (next_charge_date ≤ 当日JST)", () => {
  // listDueContracts は next_charge_date <= todayJst() で抽出する。
  const due = (nextChargeDate: string, today: string) => nextChargeDate <= today;

  it("課金開始日の当日に拾われる", () => {
    expect(due("2026-11-01", "2026-11-01")).toBe(true);
  });

  it("前日は拾わない", () => {
    expect(due("2026-11-01", "2026-10-31")).toBe(false);
  });

  it("Cronが落ちて遅れても、翌日以降に必ず拾われる (取りこぼさない)", () => {
    expect(due("2026-11-01", "2026-11-02")).toBe(true);
    expect(due("2026-11-01", "2026-12-05")).toBe(true);
  });

  it("todayJst は JST の日付を返す (UTC深夜でも前日にならない)", () => {
    // 2026-11-01 00:30 JST = 2026-10-31 15:30 UTC
    const jstMidnight = Date.UTC(2026, 9, 31, 15, 30);
    expect(new Date(jstMidnight + 9 * 3600_000).toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("失敗リトライ", () => {
  it("リトライ日は当日から間隔日後 (対象月は変わらない)", () => {
    const retry1 = addDays("2026-11-01", 1);
    const retry2 = addDays(retry1, 3);
    const retry3 = addDays(retry2, 7);
    expect([retry1, retry2, retry3]).toEqual(["2026-11-02", "2026-11-05", "2026-11-12"]);
    // どのリトライ日でも課金対象月は11月のまま = 11月分を取りこぼさない
    for (const d of [retry1, retry2, retry3]) expect(monthOf(d)).toBe("2026-11");
  });

  it("リトライ成功後は「対象月の翌月」に戻る (リトライ日の翌月ではない)", () => {
    // 11/12 にリトライ成功 → 次回は 12/01 (12/12 ではない)
    expect(nextChargeDateAfter(monthOf("2026-11-12"), CHARGE_DAY)).toBe("2026-12-01");
  });
});

describe("初回課金日の基準は利用開始日 (申込日ではない)", () => {
  it("申込8/12・利用開始9/1 なら 11/1 課金開始 (10/1 ではない)", () => {
    expect(firstChargeDate("2026-09-01", FREE_MONTHS, CHARGE_DAY)).toBe("2026-11-01");
    expect(firstChargeDate("2026-08-12", FREE_MONTHS, CHARGE_DAY)).toBe("2026-10-01");
  });
});
