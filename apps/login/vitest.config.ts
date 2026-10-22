import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Unit-test config for the sign-in host — the doctor storefront's shape
 * (`apps/doctor/vitest.config.ts`): node by default (the request gate and the
 * entry projection touch `Headers`/`fetch`, no DOM); a file that renders opts
 * into jsdom with a `@vitest-environment jsdom` docblock.
 */
export default defineConfig({
  plugins: [react()],
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
    setupFiles: ["./vitest.setup.ts"],
  },
});
