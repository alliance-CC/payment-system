// ウイルスバスター 規約一式（トレンドマイクロ株式会社の製品）。
//   暮らし安心プレミアムに含まれる「セキュリティ」に対応する。
import DocTermsView, { type DocContact } from "../DocTermsView";
import { VIRUSBUSTER_TERMS } from "../terms-data";

export const metadata = { title: "ウイルスバスター 利用規約 — 株式会社ライフアップ" };

const CONTACTS: DocContact[] = [
  {
    role: "ソフトウェアの提供元（使用許諾契約の当事者）",
    name: "トレンドマイクロ株式会社",
    lines: [
      "サポート／使用許諾契約（EULA）の最新版：https://www.go-tm.jp/eula-top",
      "収集データの詳細：https://success.trendmicro.com/data-collection-disclosure",
    ],
  },
  {
    role: "契約・会費・解約に関するお問い合わせ（販売元）",
    name: "株式会社ライフアップ",
    lines: ["TEL：03-6709-9237", "受付時間：11:00〜20:00（年末年始を除く）"],
  },
];

export default function VirusbusterTermsPage({ searchParams }: { searchParams: { from?: string } }) {
  return (
    <DocTermsView
      terms={VIRUSBUSTER_TERMS}
      fromSubscribe={searchParams.from === "subscribe"}
      lead="「ウイルスバスター」は暮らし安心プレミアムに含まれるセキュリティサービスです。ソフトウェアの使用条件はトレンドマイクロ株式会社の使用許諾契約（EULA）が直接適用されます。"
      contacts={CONTACTS}
    />
  );
}
