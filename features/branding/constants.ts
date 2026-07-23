// クライアント/サーバー共通で参照できる branding 既定値。
// 認証前のログイン画面など、テナントが未確定の文脈でも使える。

export type BrandingShape = {
  app_name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  accent_color: string;
  login_title: string;
  login_subtitle: string;
  footer_text: string | null;
};

export const DEFAULT_BRANDING: BrandingShape = {
  app_name: "メモリアル",
  logo_url: null,
  favicon_url: null,
  primary_color: "#312E81",
  accent_color: "#7C3AED",
  login_title: "メモリアル",
  login_subtitle: "会社ID・メールアドレス・パスワードでログイン",
  footer_text: null,
};

// ─── テーマ用カラーユーティリティ ───────────────────────────
// テナントの primary/accent を Tailwind の rgb(var(--…-rgb) / alpha) 形式へ
// 注入するためのヘルパー。クライアント/サーバー共通。

// "#2A54C8" → "42 84 200" (不正値は null)
export function hexToRgbTriplet(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// 白方向に amount (0-1) 混ぜて明るいバリアントを作る
export function lightenHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ワークスペース全体に注入する CSS 変数一式を組み立てる
export function brandingCssVarMap(b: BrandingShape): Record<string, string> {
  const primary = b.primary_color || DEFAULT_BRANDING.primary_color;
  const accent  = b.accent_color  || DEFAULT_BRANDING.accent_color;
  // 既定ブランドのときは design v2 の正確なライトバリアント
  // (indigo #4F46E5 / violet #8B5CF6) を使う。テナント独自色は自動生成。
  const isDefaultPrimary = primary === DEFAULT_BRANDING.primary_color;
  const isDefaultAccent  = accent  === DEFAULT_BRANDING.accent_color;
  return {
    "--branding-primary": primary,
    "--branding-accent": accent,
    "--brand-primary-rgb":       hexToRgbTriplet(primary) ?? "49 46 129",
    "--brand-primary-light-rgb": isDefaultPrimary
      ? "79 70 229"
      : hexToRgbTriplet(lightenHex(primary, 0.12)) ?? "79 70 229",
    "--brand-accent-rgb":        hexToRgbTriplet(accent) ?? "124 58 237",
    "--brand-accent-light-rgb":  isDefaultAccent
      ? "139 92 246"
      : hexToRgbTriplet(lightenHex(accent, 0.25)) ?? "139 92 246",
  };
}
