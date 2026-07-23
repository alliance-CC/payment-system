/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // ストック商材LP (public/lp/index.html) を拡張子なしの /lp で配信する。
  // LP の「このプランで申し込む」は同一オリジンの /subscribe?plan=plus|premium へ遷移する。
  async rewrites() {
    return [{ source: "/lp", destination: "/lp/index.html" }];
  },
};
export default nextConfig;
