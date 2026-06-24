import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Component-test config for the portal (introduced by #212). The portal had only
 * Playwright e2e before; the slotted-OTP regression (#212) needs a fast,
 * deterministic DOM-level reproduction, so this adds a jsdom Vitest project scoped
 * to `*.test.tsx` co-located with the components under test. `@/*` mirrors the
 * tsconfig path alias; `@ds/design-system/*` resolves through the workspace
 * package's own `exports`, so no alias is needed for it.
 *
 * Convention (the sanctioned component-test tier + the shared jsdom polyfills +
 * the "jsdom guards the JS contract only, not rendering" caveat) is documented at
 * apps/docs/content/architecture/component-testing.md (#215).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e/**", "tests/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
