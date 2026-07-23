// 会員ID (accountId) 発行 (§5)。
// 制約: 100字以内・英数字・一意。「LP申込 → VeriTrans → 登録通知 → CRM」を貫く共通キー。
//
// 設計方針 (§5):
//  - CRM の顧客案件IDから決定的に生成できる場合は同一IDを維持 (再登録時も同じID)。
//  - CRMに該当が無いオープン申込では衝突しない英数字を新規採番。
//  - 正確な使用可能文字は仕様書で要確認 (TODO §10)。当面 [A-Za-z0-9] のみに正規化。
import { randomBytes } from "crypto";

const MAX_LEN = 100;
const PREFIX = "MR"; // Memoreal。OEM 先では設定で差し替え (§1.2) — TODO: tenant 設定化

// 英数字のみへ正規化 (仕様の安全側)。
function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, "");
}

// CRM 案件ID から決定的に生成 (再登録で同一IDを維持したいケース)。
export function accountIdFromCaseId(caseId: string): string {
  const base = `${PREFIX}${sanitize(caseId)}`;
  return base.slice(0, MAX_LEN);
}

// オープン申込など、決定的な種が無い場合の新規採番 (衝突しない英数字)。
export function newAccountId(): string {
  // 24 hex 文字のランダム + プレフィックス。十分に一意。
  const rand = randomBytes(12).toString("hex");
  return `${PREFIX}${rand}`.slice(0, MAX_LEN);
}

// 妥当性チェック (登録前ガード)。
export function isValidAccountId(id: string): boolean {
  return /^[A-Za-z0-9]{1,100}$/.test(id);
}
