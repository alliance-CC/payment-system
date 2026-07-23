import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { DEFAULT_BRANDING } from "@/features/branding/constants";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// 認証前 (テナント未確定) の既定メタデータ。
// 認証後は app/(workspace)/layout.tsx の generateMetadata がテナント別に上書きする。
export const metadata: Metadata = {
  title: DEFAULT_BRANDING.app_name,
  description: "あらゆる企業・あらゆる商材に対応する自由度の高いCRM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={inter.variable}>
      <body className="min-h-screen antialiased bg-bg text-ink">{children}</body>
    </html>
  );
}
