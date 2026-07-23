import "server-only";
import { sendEmailViaSmtp } from "./send";

// メール送信の統一入口。RESEND_API_KEY があれば Resend(無料枠あり・Vercelで安定)を使い、
// 無ければ SMTP(SMTP_* / nodemailer)にフォールバックする。
//   RESEND_API_KEY … Resend の APIキー
//   RESEND_FROM    … 差出人 (未設定なら SMTP_FROM。例: 暮らし安心 <no-reply@lifeap.co>)
export async function sendMail(
  msg: { to: string; subject: string; body: string },
  tenantId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM;
  if (key && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.body }),
      });
      if (res.ok) return { ok: true };
      const t = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${t.slice(0, 200)}` };
    } catch (e: any) {
      return { ok: false, error: `resend: ${String(e?.message ?? e)}` };
    }
  }
  // フォールバック: SMTP
  return sendEmailViaSmtp(msg, tenantId);
}
