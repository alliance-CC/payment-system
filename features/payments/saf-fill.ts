// エンカンAI用：SAF案件番号（＝Salesforce の案件ID）とフリガナを、あとから入れる。
//
// 担当者 2026-11-27：SAF案件番号を手で入れていて、案件番号（AA…）を入れたり空のままだったりする。
// 暮らし安心のエントリーのとき（エンカンAI）に、Salesforce から案件IDを引いて入れたい。
//   GET  … 案件IDの形でない・フリガナが空の契約を返す（エンカンAIが Salesforce で探す）
//   POST … 見つけた案件ID・フリガナを書く。ただし、
//          ・SAF案件番号は、いまの値がエンカンAIが読んだときのまま（old）のときだけ書く（その間に人が直した値を消さない）
//          ・フリガナは、空のときだけ書く（人が入れた値・申込で聞いた値を変えない）
// 申込未完了（3DS離脱など）の契約は扱わない（加入していない人をつなげない）。
import "server-only";
import { createSupabaseService } from "@/shared/db/service";
import { fetchAllPages } from "./db-paging";
import { getIncompleteContractIds } from "./store";
import { normalizeKanaPart, joinKana } from "./kana";

/** Salesforce の案件ID（006 で始まる15桁か18桁）。 */
export const CASE_ID_RE = /^006[0-9A-Za-z]{12}([0-9A-Za-z]{3})?$/;

export type SafTodoRow = {
  accountId: string;
  name: string;          // お名前（申込で入れたもの）
  phone: string;         // 電話番号（申込で入れたもの）
  safCaseNo: string;     // いまのSAF案件番号（空・案件番号・打ち間違い）
  kana: string;          // いまのフリガナ（空なら ""）
  appliedDate: string;   // 申込日 (JST)
  canceled: boolean;     // 解約したか
};

export type SafFillItem = {
  accountId: string;
  /** エンカンAIが読んだときの SAF案件番号（いまの値がこれと同じときだけ書き換える） */
  oldSafCaseNo?: string;
  /** 入れる案件ID。省けば SAF案件番号は変えない */
  safCaseNo?: string;
  /** 入れるフリガナ「セイ メイ」。省けばフリガナは変えない（空のときだけ書く） */
  kana?: string;
};

export type SafFillResult = { accountId: string; saf: string; kana: string };

function jstDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 「セイ メイ」を保存できる形にする。カタカナにできなければ null。 */
export function normalizeKanaPair(raw: unknown): string | null {
  const parts = String(raw ?? "").trim().split(/[\s　]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const last = normalizeKanaPart(parts[0]);
  const first = normalizeKanaPart(parts[1]);
  return last && first ? joinKana(last, first) : null;
}

/**
 * 1件ぶん、何を書くかを決める（純粋関数・テストする）。
 * current＝いまの値。返す patch が空なら書かない。saf / kana はそれぞれの理由（画面・ログに出す）。
 */
export function planSafFill(
  current: { saf_case_no: string | null; contact_kana: string | null },
  item: SafFillItem,
): { patch: Record<string, string>; saf: string; kana: string } {
  const patch: Record<string, string> = {};
  let saf = "変えない";
  let kana = "変えない";
  const now = String(current.saf_case_no ?? "").trim();

  if (item.safCaseNo !== undefined) {
    const want = String(item.safCaseNo ?? "").trim();
    const old = String(item.oldSafCaseNo ?? "").trim();
    if (!CASE_ID_RE.test(want)) saf = "案件IDの形ではありません";
    else if (now === want) saf = "同じ";
    else if (now !== old) saf = "読んだあとに変わっていたので変えません";
    else {
      patch.saf_case_no = want;
      saf = "入れた";
    }
  }

  if (item.kana !== undefined) {
    const want = normalizeKanaPair(item.kana);
    if (!want) kana = "カタカナのセイ・メイではありません";
    else if (String(current.contact_kana ?? "").trim()) kana = "もう入っているので変えません";
    else {
      patch.contact_kana = want;
      kana = "入れた";
    }
  }
  return { patch, saf, kana };
}

/** 案件IDの形でない・フリガナが空の契約（申込未完了は除く・申込日の昇順）。 */
export async function loadSafTodo(): Promise<SafTodoRow[]> {
  const svc = createSupabaseService();
  const all = await fetchAllPages<any>(
    (from, to) => svc
      .from("payment_contracts")
      .select("id, account_id, contact_name, contact_phone, saf_case_no, contact_kana, started_at, canceled_at")
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
    "payment_contracts saf-todo query",
  );
  const todo = all.filter((r: any) =>
    !CASE_ID_RE.test(String(r.saf_case_no ?? "").trim()) || !String(r.contact_kana ?? "").trim());
  const skip = await getIncompleteContractIds(todo.map((r: any) => r.id));
  return todo
    .filter((r: any) => !skip.has(r.id))
    .map((r: any) => ({
      accountId: r.account_id ?? "",
      name: r.contact_name ?? "",
      phone: r.contact_phone ?? "",
      safCaseNo: String(r.saf_case_no ?? "").trim(),
      kana: String(r.contact_kana ?? "").trim(),
      appliedDate: jstDate(r.started_at),
      canceled: !!r.canceled_at,
    }));
}

/** 見つけた案件ID・フリガナを書く。1件ずつ読み直してから書く（`planSafFill`）。 */
export async function applySafFill(items: SafFillItem[]): Promise<{ updated: number; results: SafFillResult[] }> {
  const svc = createSupabaseService();
  const results: SafFillResult[] = [];
  let updated = 0;
  for (const item of items) {
    const accountId = String(item.accountId ?? "").trim();
    if (!accountId) continue;
    const { data, error } = await svc
      .from("payment_contracts")
      .select("id, saf_case_no, contact_kana")
      .eq("account_id", accountId)
      .limit(2);
    if (error) {
      results.push({ accountId, saf: `読めませんでした（${error.message}）`, kana: "" });
      continue;
    }
    if (!data || data.length !== 1) {
      results.push({ accountId, saf: data?.length ? "同じ会員IDの契約が2つあります" : "見つかりません", kana: "" });
      continue;
    }
    const row = data[0] as any;
    const plan = planSafFill(row, item);
    if (Object.keys(plan.patch).length) {
      const { error: upErr } = await svc.from("payment_contracts").update(plan.patch).eq("id", row.id);
      if (upErr) {
        results.push({ accountId, saf: `書けませんでした（${upErr.message}）`, kana: "" });
        continue;
      }
      updated++;
    }
    results.push({ accountId, saf: plan.saf, kana: plan.kana });
  }
  return { updated, results };
}
