// 電話番号のハイフン統一テスト。先方へ渡す値 (CSV・連携シート) の表記を固定する。
// ハイフンが入ることで Excel が数値と解釈しなくなり、先頭0の欠落も起きない。
import { describe, it, expect } from "vitest";
import { formatPhoneJp } from "./phone";

describe("携帯番号 (11桁)", () => {
  it("ハイフン無しの入力にハイフンを付ける", () => {
    expect(formatPhoneJp("09012345678")).toBe("090-1234-5678");
    expect(formatPhoneJp("08098765432")).toBe("080-9876-5432");
    expect(formatPhoneJp("07011112222")).toBe("070-1111-2222");
  });

  it("既にハイフン付きでも同じ結果になる (再整形)", () => {
    expect(formatPhoneJp("090-1234-5678")).toBe("090-1234-5678");
    expect(formatPhoneJp("090 1234 5678")).toBe("090-1234-5678");
  });

  it("IP電話(050)も携帯と同じ区切り", () => {
    expect(formatPhoneJp("05012345678")).toBe("050-1234-5678");
  });
});

describe("固定電話", () => {
  it("東京(03)・大阪(06) は市外局番2桁", () => {
    expect(formatPhoneJp("0312345678")).toBe("03-1234-5678");
    expect(formatPhoneJp("0687654321")).toBe("06-8765-4321");
  });

  it("市外局番の桁数が特定できない番号は入力どおり返す (誤った区切りにしない)", () => {
    // 0467 (鎌倉) などは市外局番4桁だが、桁数からは判別できないためそのまま
    expect(formatPhoneJp("0467123456")).toBe("0467123456");
    expect(formatPhoneJp("0467-12-3456")).toBe("0467-12-3456");
  });
});

describe("フリーダイヤル", () => {
  it("0120 は 4-3-3", () => {
    expect(formatPhoneJp("0120123456")).toBe("0120-123-456");
  });

  it("0800 は 4-3-4", () => {
    expect(formatPhoneJp("08001234567")).toBe("0800-123-4567");
  });
});

describe("表記ゆれの吸収", () => {
  it("全角数字を半角に直して整形する", () => {
    expect(formatPhoneJp("０９０１２３４５６７８")).toBe("090-1234-5678");
  });

  it("国番号 +81 は国内表記に戻す", () => {
    expect(formatPhoneJp("+81-90-1234-5678")).toBe("090-1234-5678");
    expect(formatPhoneJp("819012345678")).toBe("090-1234-5678");
  });

  it("前後の空白は無視する", () => {
    expect(formatPhoneJp("  09012345678  ")).toBe("090-1234-5678");
  });
});

describe("異常値", () => {
  it("未入力は空文字", () => {
    expect(formatPhoneJp(null)).toBe("");
    expect(formatPhoneJp("")).toBe("");
    expect(formatPhoneJp("   ")).toBe("");
  });

  it("数字を含まない値はそのまま返す", () => {
    expect(formatPhoneJp("なし")).toBe("なし");
  });
});
