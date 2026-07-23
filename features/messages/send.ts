// チャネル別の実送信ロジック (SMS=Twilio / Email=SMTP)。
// integrations テーブル → env の順で設定を読み、未設定時はデモモードで送信済み扱いにする。
import { getIntegration } from "@/features/integrations/service";

export type SendTarget = {
  to: string;         // SMS: 電話番号 / Email: メールアドレス
  subject?: string;   // Email のみ。省略時は本文先頭から自動生成
  body: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendSmsViaTwilio(target: SendTarget, tenantId?: string | null): Promise<SendResult> {
  const integ = await getIntegration("twilio", { tenantId });
  const sid  = integ.secret.account_sid as string | undefined;
  const auth = integ.secret.auth_token  as string | undefined;
  const from = integ.config.from_number as string | undefined;

  if (!sid || !auth || !from) {
    return { ok: true }; // デモモード: 送信成功扱い
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: target.to, From: from, Body: target.body }),
      }
    );
    if (res.ok) return { ok: true };
    const err = await res.text();
    return { ok: false, error: err.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

export async function sendEmailViaSmtp(target: SendTarget, tenantId?: string | null): Promise<SendResult> {
  if (!target.to.includes("@")) {
    return { ok: false, error: "メールアドレスが不正です" };
  }
  const integ = await getIntegration("smtp", { tenantId });
  const host = integ.config.host as string | undefined;
  const port = Number(integ.config.port ?? 587);
  const from = integ.config.from as string | undefined;
  const user = integ.secret.user as string | undefined;
  const pass = integ.secret.pass as string | undefined;

  if (!host || !from) {
    return { ok: true }; // デモモード
  }

  try {
    // 動的 import で SSR バンドルを軽くする
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
    const subject = target.subject?.trim() || target.body.split("\n")[0].slice(0, 60) || "ご連絡";
    await transporter.sendMail({
      from,
      to: target.to,
      subject,
      text: target.body,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

// outbox_messages の 1 行を送信し、結果オブジェクトを返す。
export async function sendOutboxMessage(msg: {
  channel: string;
  body: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  subject?: string | null;
}, tenantId?: string | null): Promise<SendResult> {
  if (msg.channel === "email") {
    if (!msg.contact_email) return { ok: false, error: "メールアドレスなし" };
    return sendEmailViaSmtp({ to: msg.contact_email, body: msg.body, subject: msg.subject ?? undefined }, tenantId);
  }
  // 既定 SMS
  if (!msg.contact_phone) return { ok: false, error: "電話番号なし" };
  return sendSmsViaTwilio({ to: msg.contact_phone, body: msg.body }, tenantId);
}
