import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, fetchAllByIds, chunk, PAGE_SIZE, MAX_PAGES } from "./db-paging";

// Supabase は1リクエストで最大1000行しか返さず、超えた分は黙って切り捨てられる。
// 取りこぼすと「案件が管理ボードから消える」「課金済みが未課金に見える」ので、
// 全件読めること・境界で重複しないことをここで固定する。

/** 件数ぶんの行を持つ、range を実装した疑似テーブル */
function table(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const run = async (from: number, to: number) => {
    calls.push([from, to]);
    // Supabase と同じく、要求範囲でも max-rows を超えては返さない
    const end = Math.min(to, from + PAGE_SIZE - 1);
    return { data: rows.slice(from, end + 1), error: null };
  };
  return { run, calls };
}

describe("fetchAllPages — 行数上限を越えて全件読む", () => {
  it("1000件ちょうどでも、次のページを確認してから終わる", async () => {
    const t = table(PAGE_SIZE);
    const out = await fetchAllPages(t.run, "t");
    expect(out).toHaveLength(PAGE_SIZE);
    expect(t.calls).toHaveLength(2);        // 2回目が空で終了
  });

  it("1000件を超えても全件返す (取りこぼさない)", async () => {
    const out = await fetchAllPages(table(1201).run, "t");
    expect(out).toHaveLength(1201);
  });

  it("ページの境目で重複しない", async () => {
    const out = await fetchAllPages<{ id: number }>(table(2500).run, "t");
    expect(new Set(out.map((r) => r.id)).size).toBe(2500);
    expect(out[0].id).toBe(0);
    expect(out.at(-1)!.id).toBe(2499);
  });

  it("1000件未満なら1回で終わる (余計に問い合わせない)", async () => {
    const t = table(3);
    expect(await fetchAllPages(t.run, "t")).toHaveLength(3);
    expect(t.calls).toHaveLength(1);
  });

  it("0件でも落ちない", async () => {
    expect(await fetchAllPages(table(0).run, "t")).toEqual([]);
  });

  it("エラーは握りつぶさず投げる (途中までを全件に見せない)", async () => {
    await expect(fetchAllPages(
      async () => ({ data: null, error: { message: "boom" } }), "契約の取得",
    )).rejects.toThrow(/契約の取得 failed: boom/);
  });

  it("ページングが効かないバックエンドでも無限ループしない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const out = await fetchAllPages(async () => {
      calls++;
      return { data: Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i })), error: null };
    }, "t");
    expect(calls).toBe(MAX_PAGES);                 // 上限で打ち切る
    expect(out).toHaveLength(PAGE_SIZE * MAX_PAGES);
    expect(spy).toHaveBeenCalled();                // 異常は記録に残す
    spy.mockRestore();
  });
});

describe("chunk — .in() のURL長対策", () => {
  it("既定は200件ずつ", () => {
    expect(chunk(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length)).toEqual([200, 200, 50]);
  });
  it("空なら空", () => expect(chunk([])).toEqual([]));
  it("端数だけでも1かたまりになる", () => expect(chunk([1, 2, 3]).length).toBe(1));
});

describe("fetchAllByIds — ID分割とページングの組み合わせ", () => {
  it("分割した各かたまりの中でもページングして全件取る", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `c${i}`);
    // 1契約あたり5行 → 200件のかたまりで1000行ちょうど = ページングが必要になる
    const out = await fetchAllByIds<{ id: string }>(
      ids,
      async (part, from, to) => {
        const rows = part.flatMap((id) => [0, 1, 2, 3, 4].map((n) => ({ id: `${id}-${n}` })));
        const end = Math.min(to, from + PAGE_SIZE - 1);
        return { data: rows.slice(from, end + 1), error: null };
      },
      "t",
    );
    expect(out).toHaveLength(1500);                       // 300契約 × 5行
    expect(new Set(out.map((r) => r.id)).size).toBe(1500); // 重複なし
  });

  it("IDが空なら問い合わせない", async () => {
    const run = vi.fn();
    expect(await fetchAllByIds([], run as any, "t")).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
