import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./shared/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Memoreal v2 palette: deep indigo × vivid violet (PR #6 デザイン準拠)
        bg:     "#F5F6FB",   // わずかに紫がかったオフホワイト
        panel:  "#FFFFFF",
        // プライマリ/アクセントはテナントブランディング (tenant_brandings) に追従する。
        // 既定値は globals.css の :root、テナント値は app/(workspace)/layout.tsx が注入。
        navy:   "rgb(var(--brand-primary-rgb) / <alpha-value>)",
        navyL:  "rgb(var(--brand-primary-light-rgb) / <alpha-value>)",
        ink:    "#0F172A",   // slate-900
        muted:  "#64748B",   // slate-500
        border: "#E4E7F0",   // 紫がかったボーダー
        silver: "#CBD2E8",   // パネル装飾 (紫寄りに調整)
        silverL:"#E9EBF7",
        accent: "rgb(var(--brand-accent-rgb) / <alpha-value>)",
        accent2:"rgb(var(--brand-accent-light-rgb) / <alpha-value>)",
        good:   "#10B981",   // emerald
        warn:   "#F59E0B",   // amber
        bad:    "#EF4444",   // red
      },
      boxShadow: {
        // 多層のソフトシャドウ (design v2)
        card: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
        md:   "0 6px 20px rgba(49,46,129,0.10), 0 2px 6px rgba(15,23,42,0.05)",
        lg:   "0 16px 40px rgba(49,46,129,0.14), 0 4px 12px rgba(15,23,42,0.06)",
        glow: "0 0 0 1px rgb(var(--brand-accent-rgb) / 0.4), 0 0 22px rgb(var(--brand-primary-rgb) / 0.22)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
