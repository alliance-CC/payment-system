import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Next.js 専用の "server-only" バリアはテスト実行時には無効化する
      // (import しただけで throw するため。RSC 境界の保証はビルドが担う)
      "server-only": path.resolve(__dirname, "test/stubs/empty.ts"),
      "@": path.resolve(__dirname),
    },
  },
});
