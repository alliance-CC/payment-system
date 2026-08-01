import { save3dsDebug, read3dsDebug } from "@/features/payments/veritrans/threeds-debug";

// 3Dセキュア認証完了後の戻り先 (redirectionUri)。検証用に、
//   ・ブラウザに戻ってきた内容 (このリクエストの query/body)
//   ・VeriTransからのサーバー通知 (pushUrl = /mpi-result が保存したもの)
// をまとめて表示する。この内容をコピーして開発者に共有してもらう。
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  let body = "";
  if (req.method === "POST") body = await req.text().catch(() => "");
  const ct = req.headers.get("content-type");
  const returnData = JSON.stringify({ method: req.method, contentType: ct, query, body: body.slice(0, 8000) }, null, 2);
  await save3dsDebug("return", returnData, ct);

  const push = await read3dsDebug("push");
  const combined =
    "==== ① ブラウザに戻ってきた内容 (redirectionUri) ====\n" + returnData + "\n\n" +
    "==== ② VeriTransからのサーバー通知 (pushUrl / mpi-result) ====\n" +
    (push ? JSON.stringify(push, null, 2) : "(まだ届いていません。数秒待って『再読み込み』を押してください)") + "\n";

  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3Dセキュア テスト結果</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f4f5fb;margin:0;padding:20px;color:#1f2937}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;max-width:720px;margin:0 auto}
  h1{font-size:18px;color:#1e3a5f;margin:0 0 8px}
  p{font-size:13px;color:#6b7280}
  textarea{width:100%;height:360px;font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;border:1px solid #e5e7eb;border-radius:8px;padding:10px;box-sizing:border-box}
  .btn{display:inline-block;margin-top:10px;background:#1e3a5f;color:#fff;border:none;border-radius:999px;padding:8px 16px;font-weight:600;text-decoration:none;font-size:13px;cursor:pointer}
</style></head><body>
<div class="card">
  <h1>3Dセキュア テスト結果</h1>
  <p>下の枠の内容を<b>すべてコピーして、開発者に貼ってください</b>。②が「まだ届いていません」の場合は、数秒待って「再読み込み」を押してください。</p>
  <textarea readonly onclick="this.select()">${esc(combined)}</textarea>
  <div><a class="btn" href="/subscribe/3ds-return">再読み込み</a></div>
</div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const GET = handle;
export const POST = handle;
