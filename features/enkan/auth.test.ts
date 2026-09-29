// エンカンAIの口の合言葉。未設定のときに誰でも通れてしまわないことを固定する。
import { describe, it, expect, afterEach } from "vitest";
import { enkanAuthorized, enkanTokenConfigured } from "./auth";

const saved = process.env.ENKAN_API_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.ENKAN_API_TOKEN;
  else process.env.ENKAN_API_TOKEN = saved;
});

describe("エンカンAIの合言葉", () => {
  it("未設定なら、何を送っても通さない", () => {
    delete process.env.ENKAN_API_TOKEN;
    expect(enkanTokenConfigured()).toBe(false);
    expect(enkanAuthorized("Bearer ")).toBe(false);
    expect(enkanAuthorized("")).toBe(false);
    expect(enkanAuthorized(null)).toBe(false);
  });

  it("合言葉がぴったり同じときだけ通す", () => {
    process.env.ENKAN_API_TOKEN = "abc123";
    expect(enkanAuthorized("Bearer abc123")).toBe(true);
    expect(enkanAuthorized("Bearer abc1234")).toBe(false);
    expect(enkanAuthorized("abc123")).toBe(false);
    expect(enkanAuthorized(null)).toBe(false);
  });
});
