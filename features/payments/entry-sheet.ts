// 連携スプレッドシート (①②③)。1つのスプレッドシートに2タブを使う:
//   "エントリー"    … 申込が成立した (決済登録が完了し「利用前」になった) 時点で1件書き込む (①)。
//                     3DS 認証で離脱した等の「申込未完了」は書かない — 課金されない申込を
//                     成立した申込と同じ行として残さないため。
//                     解約したら、その行の H列「退会日」に解約日を書き足す (③)。
//   "ライセンスキー" … A列=ウイルスバスターのライセンスキー / B列=付与先の会員ID (②)
//
// 解約の記録はエントリータブの「退会日」1か所に集約している。月別の「2026.8解約」タブは
// シート側の GAS が退会日から作るため、アプリから別タブへ書き込むことはしない
// (二重管理になり、どちらが正か分からなくなるため)。
//
// 認証は既存の Sheets サービスアカウントを流用:
//   GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY (改行は \n)
// 対象スプレッドシートIDは管理画面(課金設定)の signupSheetId。未設定なら何もしない。
//
// 方針: シート連携の失敗で申込・解約を失敗させない (通知系と同じ非ブロッキング)。
//       ただしライセンスキーの付与だけは「誰に何を渡したか」の一次記録がシート側に
//       あるため、取得できなければ付与せず null を返す (二重付与を作らない)。
import "server-only";
import { loadPaymentSettings } from "./payment-settings";
import { normalizeGooglePrivateKey, isValidPrivateKey, PRIVATE_KEY_HELP } from "./google-key";

export const ENTRY_TAB = "エントリー";
export const LICENSE_TAB = "ライセンスキー";

/** エントリータブの1行 (項目順 A〜I) */
export type EntrySheetRow = {
  customerId: string;       // A 顧客ID (= 会員ID)
  contractDate: string;     // B ご契約日 (= 申込日)
  serviceStartDate: string; // C ご利用開始日
  chargeStartDate: string;  // D 課金開始日
  lastNameKanji: string;    // E 契約者名_姓_漢字
  firstNameKanji: string;   // F 契約者名_名_漢字
  mobilePhone: string;      // G 電話番号_携帯
  serviceName: string;      // I ご加入サービス名
  // H「退会日」は申込時点では空。解約時に updateEntryWithdrawalDate で後追い記入する。
};

/** エントリータブの列位置 (1始まり)。シートの項目が変わったときはここだけ直す。 */
const ENTRY_COL = {
  customerId: 1,        // A
  serviceStartDate: 3,  // C
  chargeStartDate: 4,   // D
  withdrawalDate: 8,    // H
} as const;

type SheetsClient = Awaited<ReturnType<typeof getSheets>> extends infer T
  ? T extends null ? never : NonNullable<T> : never;

/** Sheets クライアントと対象スプレッドシートID。未設定なら null (＝連携無効)。
 *  overrideId を渡すと保存済み設定より優先する (管理画面の接続テストで、
 *  入力中のIDをそのまま試せるようにするため)。 */
async function getSheets(overrideId?: string): Promise<{ sheets: any; spreadsheetId: string } | null> {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;

  const override = (overrideId ?? "").trim();
  const s = override ? null : await loadPaymentSettings();
  const spreadsheetId =
    override || (s?.signupSheetId ?? "").trim() || process.env.PAYMENTS_SIGNUP_SHEET_ID || "";
  if (!spreadsheetId) return null;

  // 動的 import: Sheets 未使用のデプロイで googleapis を読み込まない
  const key = normalizeGooglePrivateKey(privateKey);
  if (!isValidPrivateKey(key)) throw new Error(PRIVATE_KEY_HELP);
  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: clientEmail,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), spreadsheetId };
}

/**
 * A列 (顧客ID) の内容から書き込み先の行を決める (①③ 共通)。
 *   ・見出し行(1行目)は対象外
 *   ・dedupeKey が既にA列にあれば "duplicate" (書かない)
 *   ・途中に空行があればそこを埋める (シート側で行を用意しておける)
 *   ・空きが無ければ最終行の次に追記する
 * 決済確定のタイミングが複数あり (3DS確定・手動確定・スイープ後の補完)、同じ申込で
 * 二度呼ばれうるため、重複判定を分離して単体テストできるようにしている。
 */
export function pickTargetRow(
  rows: any[][],
  dedupeKey?: string,
): { row: number } | "duplicate" {
  const key = (dedupeKey ?? "").trim();
  let target = -1;
  for (let i = 1; i < rows.length; i++) {   // 1行目は見出し
    const v = String(rows[i]?.[0] ?? "").trim();
    if (key && v === key) return "duplicate";
    if (!v && target === -1) target = i + 1;  // シートの行番号は1始まり
  }
  // 重複確認のため全行を見てから決める (空き行を見つけても早期returnしない)
  return { row: target === -1 ? Math.max(rows.length, 1) + 1 : target };
}

/** 「顧客IDが入っていない行の上から順に」書き込む (①③ 共通)。
 *  append ではなく、A列を読んで書き込み先の行を特定して update する。
 *  dedupeKey を渡すと、その値が既にA列にある場合は書かずに "duplicate" を返す。 */
async function writeToFirstEmptyRow(
  client: { sheets: any; spreadsheetId: string },
  tab: string,
  values: string[],
  dedupeKey?: string,
): Promise<"written" | "duplicate"> {
  const { sheets, spreadsheetId } = client;
  const col = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:A100000`,
  });
  const picked = pickTargetRow(col?.data?.values ?? [], dedupeKey);
  if (picked === "duplicate") return "duplicate";
  const target = picked.row;

  const lastCol = String.fromCharCode("A".charCodeAt(0) + values.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A${target}:${lastCol}${target}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
  return "written";
}

/** ① 申込をエントリータブへ記録する (非ブロッキング)。
 *  同じ顧客IDが既にあれば書かない — 申込の成立は 3DS 確定・在疑義の手動確定・
 *  スイープ後の補完と複数の経路で起こるため、行が二重にならないようにする。 */
export async function appendEntryRow(row: EntrySheetRow): Promise<"written" | "duplicate" | "skipped"> {
  try {
    const client = await getSheets();
    if (!client) return "skipped"; // 未設定 = 何もしない
    return await writeToFirstEmptyRow(client, ENTRY_TAB, [
      row.customerId,                             // A 顧客ID
      row.contractDate,                           // B ご契約日
      row.serviceStartDate,                       // C ご利用開始日
      row.chargeStartDate,                        // D 課金開始日
      row.lastNameKanji,                          // E 契約者名_姓_漢字
      row.firstNameKanji,                         // F 契約者名_名_漢字
      row.mobilePhone,                            // G 電話番号_携帯
      "",                                         // H 退会日 (解約時に後から記入)
      row.serviceName,                            // I ご加入サービス名
    ], row.customerId);
  } catch (e: any) {
    console.error("[entry-sheet] entry write failed:", String(e?.message ?? e));
    return "skipped";
  }
}

export type SheetWriteResult =
  | { ok: true }
  | { ok: false; reason: "disabled" }            // 連携が未設定 (シートID/認証情報なし)
  | { ok: false; reason: "no-row"; error: string } // エントリータブに該当の顧客IDが無い
  | { ok: false; reason: "error"; error: string };

/** 書けなかった理由を、管理画面にそのまま出せる日本語にする。 */
export function describeSheetFailure(r: SheetWriteResult): string | undefined {
  if (r.ok) return undefined;
  if (r.reason === "disabled") return "連携スプレッドシートが未設定です";
  return r.error;
}

/**
 * ③ 解約をエントリータブ H列「退会日」に記入する。
 *
 * 解約の記録はここ1か所だけ。月別の「2026.8解約」タブはシート側の GAS が
 * この退会日から作るので、書けていないと先方の表に解約が出ない。
 * そのため結果を呼び出し側へ返す — 握りつぶすと誰も記録漏れに気づけない。
 */
export async function updateEntryWithdrawalDate(
  customerId: string, canceledDate: string,
): Promise<SheetWriteResult> {
  return writeEntryCell(customerId, ENTRY_COL.withdrawalDate, [canceledDate], "withdrawal date");
}

/**
 * エントリータブの C列「ご利用開始日」と D列「課金開始日」を書き直す。
 * 管理画面で利用開始日を変更したとき、シート側の日付を古いまま残さないため。
 */
export async function updateEntryServiceDates(
  customerId: string, serviceStartDate: string, chargeStartDate: string,
): Promise<SheetWriteResult> {
  // C と D は隣接しているので1回の更新で書ける
  return writeEntryCell(
    customerId, ENTRY_COL.serviceStartDate, [serviceStartDate, chargeStartDate], "service dates",
  );
}

/**
 * エントリータブの該当行 (顧客IDで検索) の、指定列から右へ values を書き込む。
 * 失敗しても例外は投げない (呼び出し元の処理は止めない) が、結果は必ず返す。
 */
async function writeEntryCell(
  customerId: string, startCol: number, values: string[], label: string,
): Promise<SheetWriteResult> {
  const key = (customerId ?? "").trim();
  if (!key) return { ok: false, reason: "error", error: "会員IDが空です" };
  try {
    const client = await getSheets();
    if (!client) return { ok: false, reason: "disabled" };
    const { sheets, spreadsheetId } = client;

    const col = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${ENTRY_TAB}!A1:A100000`,
    });
    const rows: any[][] = col?.data?.values ?? [];
    let target = -1;
    for (let i = 1; i < rows.length; i++) {                 // 1行目は見出し
      if (String(rows[i]?.[0] ?? "").trim() === key) { target = i + 1; break; }
    }
    if (target === -1) {
      // 書く先が無い。申込時にシート連携が未設定だった / A列を編集した等で起こる。
      // 黙って成功扱いにすると記録漏れに気づけないため、理由として返す。
      console.error(`[entry-sheet] ${label}: エントリータブに行がありません:`, key);
      return {
        ok: false, reason: "no-row",
        error: `エントリータブに会員ID ${key} の行がありません`,
      };
    }

    const from = String.fromCharCode(64 + startCol);
    const to = String.fromCharCode(64 + startCol + values.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${ENTRY_TAB}!${from}${target}:${to}${target}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    return { ok: true };
  } catch (e: any) {
    const error = String(e?.message ?? e);
    console.error(`[entry-sheet] ${label} write failed:`, error);
    return { ok: false, reason: "error", error };
  }
}

/**
 * ② 未使用のライセンスキーを1件確保して会員IDを書き込む。
 * A列2行目以降を上から走査し、B列が空の最初の行を採用する。
 * 付与できたキーを返す (未設定・在庫切れ・エラー時は null = 付与しない)。
 *
 * ⚠️ 同時申込での二重付与を完全には防げない (シートにロックが無い)。B列の書き込み前に
 *    再読込して奪取を検知し、取られていたら次の空きへ進むことで実用上の衝突を減らす。
 */
export async function assignLicenseKey(accountId: string): Promise<string | null> {
  try {
    const client = await getSheets();
    if (!client) return null;
    const { sheets, spreadsheetId } = client;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${LICENSE_TAB}!A1:B100000`,
      });
      const rows: any[][] = res?.data?.values ?? [];
      let rowNo = -1;
      let key = "";
      for (let i = 1; i < rows.length; i++) {         // 1行目は見出し
        const k = String(rows[i]?.[0] ?? "").trim();
        const assigned = String(rows[i]?.[1] ?? "").trim();
        if (k && !assigned) { rowNo = i + 1; key = k; break; }
      }
      if (rowNo === -1) {
        console.error("[entry-sheet] license key stock is empty");
        return null;                                  // 在庫切れ
      }
      // 書き込み直前に該当セルだけ再確認 (他プロセスに取られていないか)
      const check = await sheets.spreadsheets.values.get({
        spreadsheetId, range: `${LICENSE_TAB}!B${rowNo}`,
      });
      if (String(check?.data?.values?.[0]?.[0] ?? "").trim()) continue; // 取られていた→次を探す

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${LICENSE_TAB}!B${rowNo}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[accountId]] },
      });
      return key;
    }
    console.error("[entry-sheet] license key assign: retries exhausted");
    return null;
  } catch (e: any) {
    console.error("[entry-sheet] license key assign failed:", String(e?.message ?? e));
    return null;
  }
}

export type SheetTestResult = {
  ok: boolean;
  /** 失敗理由 (未設定・権限なし・タブ名違い等) */
  error?: string;
  /** スプレッドシート名 */
  title?: string;
  /** 実在するタブ名 */
  tabs?: string[];
  /** 必要な3タブが揃っているか */
  missingTabs?: string[];
  /** 書き込み権限を確認できたか */
  canWrite?: boolean;
  /** ライセンスキーの在庫 */
  stock?: LicenseStock;
};

/**
 * 連携スプレッドシートの疎通確認 (管理画面の「接続テスト」から呼ぶ)。
 *   1. サービスアカウントでシートを開けるか (共有されているか)
 *   2. 必要な3タブが存在するか
 *   3. 書き込みできるか (未使用セルに書いて即消す。データは残さない)
 *   4. ライセンスキーの在庫を数える
 */
export async function testSheetConnection(overrideSheetId?: string): Promise<SheetTestResult> {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  if (!clientEmail) return { ok: false, error: "GOOGLE_SHEETS_CLIENT_EMAIL が未設定です (Vercelの環境変数)" };
  if (!privateKey) return { ok: false, error: "GOOGLE_SHEETS_PRIVATE_KEY が未設定です (Vercelの環境変数)" };

  // 鍵の形が崩れていると OpenSSL の DECODER エラーになる。原因が分かる案内を先に返す
  if (!isValidPrivateKey(normalizeGooglePrivateKey(privateKey))) {
    return { ok: false, error: PRIVATE_KEY_HELP };
  }

  let client: Awaited<ReturnType<typeof getSheets>>;
  try {
    client = await getSheets(overrideSheetId);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return {
      ok: false,
      error: /DECODER|unsupported|PEM|1E08010C/i.test(msg) ? PRIVATE_KEY_HELP : `認証に失敗しました: ${msg}`,
    };
  }
  if (!client) return { ok: false, error: "スプレッドシートIDが未設定です (この画面で保存してください)" };

  const { sheets, spreadsheetId } = client;
  try {
    // 1・2. シートを開いてタブ名を取得 (共有されていなければここで 403)
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
    const tabs: string[] = (meta?.data?.sheets ?? []).map((s: any) => s?.properties?.title).filter(Boolean);
    // 解約タブはアプリから読み書きしないので必須にしない (解約は「エントリー」の退会日に記録する)
    const missingTabs = [ENTRY_TAB, LICENSE_TAB].filter((t) => !tabs.includes(t));

    // 3. 書き込み確認: ライセンスキータブの未使用セルに書いて即クリアする
    let canWrite = false;
    if (tabs.includes(LICENSE_TAB)) {
      const probe = `${LICENSE_TAB}!Z1000`;
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: probe, valueInputOption: "RAW",
          requestBody: { values: [[`connection-test ${new Date().toISOString()}`]] },
        });
        canWrite = true;
        await sheets.spreadsheets.values.clear({ spreadsheetId, range: probe }).catch(() => {});
      } catch {
        canWrite = false;   // 閲覧者権限で共有されている等
      }
    }

    // 4. 在庫集計
    const stock = tabs.includes(LICENSE_TAB) ? await countLicenseStock(overrideSheetId) : null;

    return {
      ok: missingTabs.length === 0 && canWrite,
      title: meta?.data?.properties?.title,
      tabs, missingTabs, canWrite,
      stock: stock ?? undefined,
      error: missingTabs.length
        ? `タブが見つかりません: ${missingTabs.join(" / ")}`
        : !canWrite
        ? "書き込み権限がありません (共有を「編集者」にしてください)"
        : undefined,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const hint = /DECODER|1E08010C/i.test(msg)
      ? PRIVATE_KEY_HELP
      : /permission|403|forbidden/i.test(msg)
      ? `シートがサービスアカウントに共有されていません。シートの「共有」に ${clientEmail} を「編集者」で追加してください。`
      : /not found|404/i.test(msg)
      ? "スプレッドシートIDが違うか、シートが存在しません。"
      : msg;
    return { ok: false, error: hint };
  }
}

export type LicenseStock = { total: number; used: number; remaining: number };

/**
 * ② ライセンスキーの在庫を数える (毎朝9時の Cron から呼ぶ)。
 *   母数 = A列2行目以降でキーが入っている行数 (増える可能性あり)
 *   使用 = そのうち B列(会員ID)が入っている行数
 */
export async function countLicenseStock(overrideSheetId?: string): Promise<LicenseStock | null> {
  try {
    const client = await getSheets(overrideSheetId);
    if (!client) return null;
    const res = await client.sheets.spreadsheets.values.get({
      spreadsheetId: client.spreadsheetId,
      range: `${LICENSE_TAB}!A1:B100000`,
    });
    const rows: any[][] = res?.data?.values ?? [];
    let total = 0;
    let used = 0;
    for (let i = 1; i < rows.length; i++) {
      const k = String(rows[i]?.[0] ?? "").trim();
      if (!k) continue;
      total++;
      if (String(rows[i]?.[1] ?? "").trim()) used++;
    }
    return { total, used, remaining: total - used };
  } catch (e: any) {
    console.error("[entry-sheet] license stock count failed:", String(e?.message ?? e));
    return null;
  }
}
