import { describe, it, expect } from "vitest";
import { cronHealth, describeAgo, CRON_STALE_HOURS } from "./cron-health";

// 「課金が実行されなかったこと」に気づくための最後の砦。
// Cron が起動しなくなると 503 も通知メールも鳴らないので、ここの判定が唯一の警報になる。
const NOW = new Date("2026-09-21T10:00:00.000Z");
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("cronHealth — 日次課金が動いているかの判定", () => {
  it("直近に実行されていれば ok", () => {
    expect(cronHealth(hoursBefore(1), NOW)).toEqual({ state: "ok", hoursAgo: 1 });
  });

  it("24時間前はまだ警告しない (実行時刻のぶれを許容する)", () => {
    expect(cronHealth(hoursBefore(24), NOW).state).toBe("ok");
  });

  it("しきい値ちょうどは警告しない / 超えたら警告する", () => {
    expect(cronHealth(hoursBefore(CRON_STALE_HOURS), NOW).state).toBe("ok");
    expect(cronHealth(hoursBefore(CRON_STALE_HOURS + 0.5), NOW).state).toBe("stale");
  });

  it("2日以上止まっていれば警告", () => {
    const r = cronHealth(hoursBefore(50), NOW);
    expect(r.state).toBe("stale");
    expect(r).toMatchObject({ hoursAgo: 50 });
  });

  it("記録が無い場合は never (導入直後。警告ではなく案内にする)", () => {
    expect(cronHealth(null, NOW)).toEqual({ state: "never" });
    expect(cronHealth(undefined, NOW)).toEqual({ state: "never" });
    expect(cronHealth("", NOW)).toEqual({ state: "never" });
  });

  it("壊れた値も never 扱いにする (画面を壊さない)", () => {
    expect(cronHealth("not-a-date", NOW)).toEqual({ state: "never" });
  });

  it("未来の時刻 (時計ずれ) で誤って停止中と出さない", () => {
    expect(cronHealth(hoursBefore(-5), NOW)).toEqual({ state: "ok", hoursAgo: 0 });
  });
});

describe("describeAgo — 経過時間の表示", () => {
  it("1時間未満", () => expect(describeAgo(0.4)).toBe("1時間以内"));
  it("時間単位", () => expect(describeAgo(5.9)).toBe("約5時間前"));
  it("日単位", () => expect(describeAgo(50)).toBe("約2日前"));
});
