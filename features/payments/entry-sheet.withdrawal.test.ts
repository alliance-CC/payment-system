// エントリータブ H列「退会日」の書き込みそのものの検証。
//
// 解約の記録はこの1か所だけなので、「書けた/書けなかった/書く行が無かった」を
// 取り違えないことが重要。Sheets API はモックし、実際に送る範囲と値を確認する。
import { describe, it, expect, beforeEach, vi } from "vitest";

const mem = vi.hoisted(() => ({
  /** エントリータブ A列の中身 (1行目は見出し) */
  columnA: [] as string[][],
  /** spreadsheets.values.update に渡された内容 */
  updates: [] as { range: string; values: any[][] }[],
  /** 読み取り時に投げるエラー (API障害の再現用) */
  readError: null as string | null,
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class { constructor(_: any) { /* 認証はしない */ } } },
    sheets: () => ({
      spreadsheets: {
        values: {
          get: async ({ range }: any) => {
            if (mem.readError) throw new Error(mem.readError);
            expect(range).toContain("エントリー!A1:A");
            return { data: { values: mem.columnA } };
          },
          update: async ({ range, requestBody }: any) => {
            mem.updates.push({ range, values: requestBody.values });
            return {};
          },
        },
      },
    }),
  },
}));

vi.mock("./payment-settings", () => ({
  loadPaymentSettings: async () => ({ signupSheetId: "sheet-123" }),
}));

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIBdummy\n-----END PRIVATE KEY-----\n";
const sheet = await import("./entry-sheet");

beforeEach(() => {
  mem.columnA = [["顧客ID"], ["MR001"], ["MR002"]];
  mem.updates.length = 0;
  mem.readError = null;
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = "svc@example.iam.gserviceaccount.com";
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = PEM;
});

describe("updateEntryWithdrawalDate — エントリータブ H列に退会日を書く", () => {
  it("顧客IDの行の H列に書く", async () => {
    const r = await sheet.updateEntryWithdrawalDate("MR002", "2026-09-21");

    expect(r).toEqual({ ok: true });
    // A列: 1行目=見出し / 2行目=MR001 / 3行目=MR002 → シート上は3行目
    expect(mem.updates).toEqual([{ range: "エントリー!H3:H3", values: [["2026-09-21"]] }]);
  });

  it("該当の顧客IDが無ければ no-row を返す (黙って成功にしない)", async () => {
    const r = await sheet.updateEntryWithdrawalDate("MR999", "2026-09-21");

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "no-row" });
    expect(mem.updates).toEqual([]);          // 関係ない行に書かない
  });

  it("連携が未設定 (認証情報なし) なら disabled を返す", async () => {
    delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const r = await sheet.updateEntryWithdrawalDate("MR001", "2026-09-21");

    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(mem.updates).toEqual([]);
  });

  it("Sheets API が落ちたら error と理由を返す (例外は投げない)", async () => {
    mem.readError = "The caller does not have permission";
    const r = await sheet.updateEntryWithdrawalDate("MR001", "2026-09-21");

    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "error" });
    expect((r as any).error).toContain("permission");
  });

  it("会員IDが空なら何も書かない", async () => {
    const r = await sheet.updateEntryWithdrawalDate("  ", "2026-09-21");
    expect(r.ok).toBe(false);
    expect(mem.updates).toEqual([]);
  });

  it("同じ案件に何度書いても行は増えない (同じセルの上書き)", async () => {
    await sheet.updateEntryWithdrawalDate("MR001", "2026-09-21");
    await sheet.updateEntryWithdrawalDate("MR001", "2026-09-21");

    expect(mem.updates.map((u) => u.range)).toEqual(["エントリー!H2:H2", "エントリー!H2:H2"]);
  });
});

describe("describeSheetFailure — 画面に出す理由", () => {
  it("未設定はそれと分かる文言にする", () => {
    expect(sheet.describeSheetFailure({ ok: false, reason: "disabled" }))
      .toBe("連携スプレッドシートが未設定です");
  });
  it("成功なら理由は無い", () => {
    expect(sheet.describeSheetFailure({ ok: true })).toBeUndefined();
  });
  it("行が無い場合は会員IDが分かる文言をそのまま出す", () => {
    expect(sheet.describeSheetFailure({ ok: false, reason: "no-row", error: "…MR001 の行がありません" }))
      .toContain("MR001");
  });
});
