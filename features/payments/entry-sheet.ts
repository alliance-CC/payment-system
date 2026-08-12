// 連携スプレッドシート (①②③)。1つのスプレッドシートに3タブを持つ:
//   "エントリー"    … 申込が保存されたタイミングで1件書き込む (①)
//   "ライセンスキー" … A列=ウイルスバスターのライセンスキー / B列=付与先の会員ID (②)
//   "解約"          … 解約時に1件書き込む (③)
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

export const ENTRY_TAB = "エントリー";
export const CANCEL_TAB = "解約";
export const LICENSE_TAB = "ライセンスキー";

/** エントリータブの1行 (画像1の項目順 A〜H) */
export type EntrySheetRow = {
  customerId: string;      // A 顧客ID (= 会員ID)
  contractDate: string;    // B ご契約日 (= 申込日)
  serviceStartDate: string;// C ご利用開始日
  chargeStartDate: string; // D 課金開始日
  lastNameKanji: string;   // E 契約者名_姓_漢字
  firstNameKanji: string;  // F 契約者名_名_漢字
  mobilePhone: string;     // G 電話番号_携帯
  serviceName: string;     // H ご加入サービス名
};

/** 解約タブの1行 (画像2の項目順 A〜E) */
export type CancelSheetRow = {
  customerId: string;       // A 顧客ID
  contractDate: string;     // B ご契約日
  serviceStartDate: string; // C ご利用開始日
  canceledDate: string;     // D 解約日
  serviceName: string;      // E ご加入サービス名
};

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
  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), spreadsheetId };
}

/**
 * 「顧客IDが入っていない行の上から順に」書き込む (①③ 共通)。
 * append ではなく、A列を読んで最初の空き行を特定して update する。
 *   ・見出し行(1行目)は対象外
 *   ・途中に空行があればそこを埋める (シート側で行を用意しておける)
 *   ・空きが無ければ最終行の次に追記する
 */
async function writeToFirstEmptyRow(
  client: { sheets: any; spreadsheetId: string },
  tab: string,
  values: string[],
): Promise<void> {
  const { sheets, spreadsheetId } = client;
  const col = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:A100000`,
  });
  const rows: any[][] = col?.data?.values ?? [];
  // 1行目は見出し。2行目以降でA列が空の最初の行を探す
  let target = -1;
  for (let i = 1; i < rows.length; i++) {
    const v = String(rows[i]?.[0] ?? "").trim();
    if (!v) { target = i + 1; break; }   // シートの行番号は1始まり
  }
  if (target === -1) target = Math.max(rows.length, 1) + 1; // 空きが無ければ最終行の次

  const lastCol = String.fromCharCode("A".charCodeAt(0) + values.length - 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tab}!A${target}:${lastCol}${target}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

/** ① 申込をエントリータブへ記録する (非ブロッキング) */
export async function appendEntryRow(row: EntrySheetRow): Promise<void> {
  try {
    const client = await getSheets();
    if (!client) return; // 未設定 = 何もしない
    await writeToFirstEmptyRow(client, ENTRY_TAB, [
      row.customerId, row.contractDate, row.serviceStartDate, row.chargeStartDate,
      row.lastNameKanji, row.firstNameKanji, row.mobilePhone, row.serviceName,
    ]);
  } catch (e: any) {
    console.error("[entry-sheet] entry write failed:", String(e?.message ?? e));
  }
}

/** ③ 解約を解約タブへ記録する (非ブロッキング) */
export async function appendCancelRow(row: CancelSheetRow): Promise<void> {
  try {
    const client = await getSheets();
    if (!client) return;
    await writeToFirstEmptyRow(client, CANCEL_TAB, [
      row.customerId, row.contractDate, row.serviceStartDate, row.canceledDate, row.serviceName,
    ]);
  } catch (e: any) {
    console.error("[entry-sheet] cancel write failed:", String(e?.message ?? e));
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

  const client = await getSheets(overrideSheetId).catch((e: any) => {
    throw new Error(`認証に失敗しました: ${String(e?.message ?? e)}`);
  });
  if (!client) return { ok: false, error: "スプレッドシートIDが未設定です (この画面で保存してください)" };

  const { sheets, spreadsheetId } = client;
  try {
    // 1・2. シートを開いてタブ名を取得 (共有されていなければここで 403)
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties.title" });
    const tabs: string[] = (meta?.data?.sheets ?? []).map((s: any) => s?.properties?.title).filter(Boolean);
    const missingTabs = [ENTRY_TAB, CANCEL_TAB, LICENSE_TAB].filter((t) => !tabs.includes(t));

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
    const hint = /permission|403|forbidden/i.test(msg)
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
