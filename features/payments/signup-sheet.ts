// 申込データを Google スプレッドシートへ1行追記する (CRM を使わない当面の受け皿)。
//   列: 登録日時 / 会員ID / プラン / 氏名 / 電話番号
//
// 認証は既存の Sheets サービスアカウント (features/integrations の google_sheets と共通) を流用:
//   GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY (改行は \n)
// 追記先:
//   PAYMENTS_SIGNUP_SHEET_ID  … 無ければ GOOGLE_SHEETS_TARGET_SPREADSHEET_ID を使う
//   PAYMENTS_SIGNUP_SHEET_TAB … タブ名 (既定 "申込")
//
// 未設定なら何もしない。失敗しても申込は成功させる (通知系と同じ非ブロッキング方針)。
import "server-only";
import { normalizeGooglePrivateKey } from "./google-key";

export type SignupSheetRow = {
  registeredAt: string; // ISO 文字列 (JST 表示に整形して書く)
  accountId: string;
  planName: string;
  name: string;
  phone: string;
};

const HEADER = ["登録日時", "会員ID", "プラン", "氏名", "電話番号"];

function jstStamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  // 保存はUTC・表示はJST (要件: 日付更新 2-1)
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "medium" });
}

export async function appendSignupRow(row: SignupSheetRow): Promise<void> {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId =
    process.env.PAYMENTS_SIGNUP_SHEET_ID || process.env.GOOGLE_SHEETS_TARGET_SPREADSHEET_ID;
  const tab = process.env.PAYMENTS_SIGNUP_SHEET_TAB || "申込";

  if (!clientEmail || !privateKey || !spreadsheetId) return; // 未設定 = 何もしない

  try {
    // 動的 import: Sheets 未使用のデプロイで googleapis を読み込まない
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: normalizeGooglePrivateKey(privateKey),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // 見出しが無ければ先に入れる (A1 が空なら未作成とみなす)
    const head = await sheets.spreadsheets.values
      .get({ spreadsheetId, range: `${tab}!A1:E1` })
      .catch(() => null);
    const hasHeader = !!head?.data?.values?.length;
    if (!hasHeader) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [HEADER] },
      }).catch(() => {});
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[jstStamp(row.registeredAt), row.accountId, row.planName, row.name, row.phone]],
      },
    });
  } catch (e: any) {
    console.error("[signup-sheet] append failed:", String(e?.message ?? e));
  }
}
