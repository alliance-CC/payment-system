import { timingSafeEqual } from "crypto";

// エンカンAI (社内の自動化アプリ) から呼ぶ口の合言葉。
//   ENKAN_API_TOKEN … Authorization: Bearer <合言葉>。未設定なら誰も通さない (誤って全開放しない)。
// 管理ボードのパスワード・Cookie とは別に持つ (ロボットにログイン画面を操作させないため)。
export function enkanTokenConfigured(): boolean {
  return !!(process.env.ENKAN_API_TOKEN ?? "").trim();
}

export function enkanAuthorized(authHeader: string | null | undefined): boolean {
  const token = (process.env.ENKAN_API_TOKEN ?? "").trim();
  if (!token) return false;
  const got = String(authHeader ?? "");
  const want = `Bearer ${token}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
