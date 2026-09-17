import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Unit config for `@ds/auth-flow` (#2027). The plain modules (client, error
// dictionary, bot-protection values, field rules, server helpers) run in the
// node environment; a React surface of the package — the shared auth frame since
// PR 1.5 — opts into jsdom per file with `// @vitest-environment jsdom`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
