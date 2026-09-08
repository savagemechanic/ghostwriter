import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        r2Buckets: ["ASSETS"],
        bindings: {
          GHOSTWRITER_ADMIN_TOKEN: "test-owner-key-that-is-never-real",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"], testTimeout: 30000 },
});
