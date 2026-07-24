// 暮らし安心プレミアム ご利用規約 (確定版)。
import TermsView from "../TermsView";
import { PREMIUM_TERMS } from "../terms-data";

export const metadata = { title: "暮らし安心プレミアム ご利用規約 — 株式会社ライフアップ" };

export default function PremiumTermsPage({ searchParams }: { searchParams: { from?: string } }) {
  return <TermsView terms={PREMIUM_TERMS} fromSubscribe={searchParams.from === "subscribe"} />;
}
