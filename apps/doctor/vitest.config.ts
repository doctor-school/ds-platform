import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Unit-test config for the doctor storefront. Node environment, not jsdom: the
 * only tested seams today are the server-side session helpers (`lib/session.ts`),
 * which touch `Headers`/`fetch` and no DOM. A jsdom project lands here when the
 * app gains its first component test — see
 * apps/docs/content/architecture/component-testing.md for that tier.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e/**"],
  },
});
