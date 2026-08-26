import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Unit-test config for the doctor storefront. Node environment, not jsdom: the
 * tested seams are the server-side session helpers (`lib/session.ts`,
 * `lib/shell-auth.ts`), which touch `Headers`/`fetch` and no DOM, plus the 017
 * shell components rendered to STATIC SERVER MARKUP (`react-dom/server`) — the
 * level EARS-1 actually constrains (what reaches the HTML), which needs no DOM
 * either. A jsdom project lands here when the app gains its first test of
 * client-side BEHAVIOUR — see
 * apps/docs/content/architecture/component-testing.md for that tier.
 *
 * `@vitejs/plugin-react` supplies the JSX transform (the same plugin the portal's
 * component tier uses): the app's tsconfig sets `jsx: "preserve"` for Next's own
 * compiler, which the bundler cannot emit, so the test pipeline names the
 * automatic runtime itself.
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
  },
});
