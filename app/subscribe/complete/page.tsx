import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { getChargeByOrderId, getContractById } from "@/features/payments/store";
import { finalizeMpiOrder } from "@/features/payments/billing";

export const metadata = { title: "お申し込み結果" };
export const dynamic = "force-dynamic"; // 確定は非同期に進む — 常に最新の DB 状態を表示

// 3DS 認証から戻った後の結果表示 (mpi-return が 303 でここへ戻す)。
// 表示の根拠はブラウザ経由のパラメータではなく DB の課金行 (ok) — 確定処理
// (finalizeMpiOrder) が MpiGetResult 照会で書いた値だけを信用する。
// ?r= は mpi-return が付ける参考値で、表示分岐は必ず DB 側で行う。
export default async function SubscribeCompletePage({
  searchParams,
}: {
  searchParams: { order?: string; r?: string };
}) {
  const orderId = (searchParams.order ?? "").slice(0, 100);
  let charge = orderId ? await getChargeByOrderId(orderId).catch(() => null) : null;
  // 未確定なら再表示のたびに確定を試みる (結果通知 PUSH が失われても自己回復できる)。
  // finalize は冪等・署名付き照会のみで、存在しない orderId は DB 段階で弾かれるため
  // この公開ページ経由で状態を詐称することはできない。
  if (charge && charge.ok === null) {
    await finalizeMpiOrder(orderId).catch(() => {});
    charge = await getChargeByOrderId(orderId).catch(() => charge);
  }
  const contract = charge ? await getContractById(charge.contract_id).catch(() => null) : null;

  let body: React.ReactNode;
  if (!charge || !contract) {
    body = (
      <div className="card p-6 flex items-start gap-3 text-sm">
        <AlertCircle size={18} className="text-bad shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">お申し込み情報が見つかりません</p>
          <p className="text-muted mt-1">
            お手数ですが、最初からお申し込みをやり直してください。
          </p>
        </div>
      </div>
    );
  } else if (charge.ok === true) {
    body = (
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <CheckCircle2 size={40} className="text-good" />
        <h2 className="text-lg font-semibold">お申し込みが完了しました</h2>
        <p className="text-sm text-muted">会員ID: <span className="font-mono">{contract.account_id}</span></p>
        {contract.next_charge_date && (
          <p className="text-xs text-muted">次回のお引き落とし日: {contract.next_charge_date}</p>
        )}
        <p className="text-[11px] text-muted">会員IDはお問い合わせ時に必要です。お控えください。</p>
      </div>
    );
  } else if (charge.ok === false) {
    body = (
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <AlertCircle size={40} className="text-bad" />
        <h2 className="text-lg font-semibold">お手続きを完了できませんでした</h2>
        <p className="text-sm text-muted">
          カード会社の本人認証（3Dセキュア）またはカード決済が承認されませんでした。
          お支払いは発生していません。
        </p>
        <p className="text-xs text-muted">
          別のカードでのお申し込み、またはカード会社へのお問い合わせをお試しください。
        </p>
        <a href={`/subscribe?plan=${encodeURIComponent(contract.plan_id)}`} className="btn btn-primary mt-1">
          もう一度お申し込みする
        </a>
        {charge.v_result_code && (
          <p className="text-[10px] text-muted font-mono">コード: {charge.v_result_code}</p>
        )}
      </div>
    );
  } else {
    // ok=null: 認証は済んだが確定前 (結果通知の到着待ち)・または認証がまだ進行中
    body = (
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <Loader2 size={36} className="animate-spin text-navy" />
        <h2 className="text-lg font-semibold">決済結果を確認しています</h2>
        <p className="text-sm text-muted">
          本人認証の結果を確認中です。少し待ってから、下のボタンで結果を再表示してください。
        </p>
        <a href={`/subscribe/complete?order=${encodeURIComponent(orderId)}`} className="btn btn-primary mt-1">
          結果を再表示する
        </a>
        <p className="text-[11px] text-muted">
          数分経っても完了しない場合は、再度のお申し込みはせず、お電話にてお問い合わせください。
        </p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-navy">お申し込み結果</h1>
        </header>
        {body}
      </div>
    </main>
  );
}
