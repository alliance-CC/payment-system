// 連携先プロバイダの定義(管理画面 UI 用)
// 実装されているもののみ列挙する。未実装プロバイダ (komoju/ocr/fax 等) は
// 将来必要になったら再追加すること。
export type Provider =
  | "bluebean"        // CTI / オートコール
  | "twilio"          // SMS
  | "veritrans"       // 決済代行 (継続課金 / OPEN API)
  | "google_sheets"   // Sheets API (エクスポート用)
  | "smtp"            // メール送信
  | "llm";            // AI チャット / 通話メモ解析

export const PROVIDER_SCHEMAS: Record<Provider, {
  label: string;
  description: string;
  configKeys: { key: string; label: string; placeholder?: string }[];
  secretKeys: { key: string; label: string; placeholder?: string }[];
}> = {
  bluebean: {
    label: "Bluebean (CTI / オートコール)",
    description: "クリック発信・着信通知・オートコールキューに使用",
    configKeys: [{ key: "base_url", label: "API Base URL", placeholder: "https://api.bluebean..." }],
    secretKeys: [
      { key: "token", label: "API Token" },
      { key: "webhook_secret", label: "Webhook Secret(X-Bluebean-Signature と一致)" },
    ],
  },
  twilio: {
    label: "Twilio (SMS)",
    description: "顧客への SMS 配信",
    configKeys: [{ key: "from_number", label: "送信元番号", placeholder: "+8190..." }],
    secretKeys: [{ key: "account_sid", label: "Account SID" }, { key: "auth_token", label: "Auth Token" }],
  },
  veritrans: {
    label: "VeriTrans 4G (継続課金 / OPEN API)",
    description: "DGFT VeriTrans4G。カードトークン決済・ワンクリック継続課金 (OPEN API 直接接続)",
    configKeys: [
      // env: false=検証(/test-paynow), true=本番(/paynow)
      { key: "production", label: "本番接続 (true/false)", placeholder: "false" },
      { key: "token_api_key", label: "Token API Key (ブラウザからの /4gtoken 用・公開可)" },
    ],
    secretKeys: [
      { key: "merchant_ccid", label: "Merchant CCID" },
      { key: "merchant_key", label: "Merchant Key (authHash 用秘密鍵・サーバーのみ)" },
    ],
  },
  google_sheets: {
    label: "Google Sheets",
    description: "案件・顧客のスプレッドシート出力",
    configKeys: [{ key: "spreadsheet_id", label: "既定スプレッドシートID" }],
    secretKeys: [
      { key: "client_email", label: "サービスアカウントメール" },
      { key: "private_key",  label: "サービスアカウント秘密鍵(改行は \\n)" },
    ],
  },
  smtp: {
    label: "SMTP (メール送信)",
    description: "サンキューメール等の送信",
    configKeys: [
      { key: "host", label: "ホスト" },
      { key: "port", label: "ポート", placeholder: "587" },
      { key: "from", label: "差出人" },
    ],
    secretKeys: [{ key: "user", label: "ユーザー" }, { key: "pass", label: "パスワード" }],
  },
  llm: {
    label: "LLM (AI 連携)",
    description: "AI チャット・通話メモ解析等",
    configKeys: [{ key: "model", label: "モデル名", placeholder: "claude-... / gpt-... / gemini-..." }],
    secretKeys: [{ key: "api_key", label: "API Key" }],
  },
};
