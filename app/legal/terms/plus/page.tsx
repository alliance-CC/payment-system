// 暮らし安心プラス ご利用規約 (確定版)。
import TermsView from "../TermsView";
import { PLUS_TERMS } from "../terms-data";

export const metadata = { title: "暮らし安心プラス ご利用規約 — 株式会社ライフアップ" };

export default function PlusTermsPage() {
  return <TermsView terms={PLUS_TERMS} />;
}
