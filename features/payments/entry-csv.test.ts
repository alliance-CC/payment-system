// エントリーCSVの列の位置。管理ボードとエンカンAIの口で同じ関数を使うので、ここで固定する。
import { describe, it, expect } from "vitest";
import { entryCsvLines, ENTRY_HEADER } from "./entry-csv";

const row = {
  accountId: "MR1", licenseKey: "LK", serviceStartDate: "2026-10-01",
  chargeStartDate: "2026-12-01", lastNameKanji: "山田", firstNameKanji: "太郎",
  mobilePhone: "090-1234-5678",
};

describe("エントリーCSV", () => {
  it("見出しなしが既定の使い方で、23列の決まった位置に入る", () => {
    const [line] = entryCsvLines([row], false);
    const cols = line.split(",");
    expect(cols).toHaveLength(ENTRY_HEADER.length);
    expect(cols[0]).toBe("MR1");
    expect(cols[2]).toBe("LK");
    expect(cols[7]).toBe("2026-10-01");
    expect(cols[8]).toBe("2026-12-01");
    expect(cols[13]).toBe("山田");
    expect(cols[14]).toBe("太郎");
    expect(cols[21]).toBe("090-1234-5678");
  });

  it("見出しありなら1行目が見出し", () => {
    const lines = entryCsvLines([row], true);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("顧客ID,")).toBe(true);
  });
});
