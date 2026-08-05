// ネットライフサポート 利用規約（OEM版 保険付きネット詐欺相談サービス）。
//   暮らし安心プラス／プレミアム両プランに含まれるため、両プラン規約から参照される。
import DocTermsView, { type DocContact } from "../DocTermsView";
import { NETLIFE_TERMS } from "../terms-data";

export const metadata = { title: "ネットライフサポート 利用規約 — 株式会社ライフアップ" };

const CONTACTS: DocContact[] = [
  {
    role: "本サービス・保険の申請に関するお問い合わせ（提供元）",
    name: "日本ＰＣサービス株式会社　保険サポートセンター",
    lines: ["TEL：0120-445-845", "受付時間：10:00〜19:00（当社休業日を除く）"],
  },
  {
    // サービスの実施・サポートは提供元が行い、当社はパッケージの販売・決済・提供元連携を担う。
    // そのため窓口はサービスごとに異なる。本サービスの契約・会費窓口は規約原文の指定に従う。
    role: "契約・会費・解約に関するお問い合わせ（販売元）",
    name: "株式会社ライフアップ",
    lines: ["TEL：0800-300-9674", "受付時間：平日11:00〜19:00（土日祝日・年末年始を除く）"],
  },
  {
    role: "引受保険会社",
    name: "レスキュー損害保険株式会社",
    lines: ["https://www.rescue-sonpo.jp/lifeap_sagi_10man_index.php のお問い合わせフォーム"],
  },
];

export default function NetlifeTermsPage({ searchParams }: { searchParams: { from?: string } }) {
  return (
    <DocTermsView
      terms={NETLIFE_TERMS}
      fromSubscribe={searchParams.from === "subscribe"}
      lead="「ネットライフサポート」は暮らし安心プラス・プレミアム両プランに含まれるサービスです。以下の規約もあわせてご確認ください。"
      contacts={CONTACTS}
    />
  );
}
