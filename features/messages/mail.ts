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

/** どの経路で送信されるか。
 *  ⚠️ sendEmailViaSmtp は SMTP 未設定時に「デモモード」として ok:true を返すため、
 *     送信結果だけでは設定漏れを検知できない。設定判定は必ずこの関数で行うこと。 */
export type MailTransport = { kind: "resend" | "smtp" | "none"; from?: string; detail: string };

export async function describeMailTransport(tenantId?: string | null): Promise<MailTransport> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM;
  if (key && from) return { kind: "resend", from, detail: `Resend（差出人: ${from}）` };
  if (key && !from) {
    return { kind: "none", detail: "RESEND_API_KEY はありますが、差出人 RESEND_FROM が未設定です" };
  }

  const { getIntegration } = await import("@/features/integrations/service");
  const integ = await getIntegration("smtp", { tenantId }).catch(() => null);
  const host = integ?.config.host as string | undefined;
  const smtpFrom = integ?.config.from as string | undefined;
  if (host && smtpFrom) return { kind: "smtp", from: smtpFrom, detail: `SMTP ${host}（差出人: ${smtpFrom}）` };

  return {
    kind: "none",
    detail: "メール送信が未設定です。RESEND_API_KEY と RESEND_FROM を設定するか、SMTP_HOST / SMTP_FROM を設定してください",
  };
}
