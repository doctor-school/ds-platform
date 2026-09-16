import { defineConfig } from "vitest/config";

// Unit config for `@ds/auth-flow` (#2027, wave 1 PR 1.3). The package holds no
// React surface in wave 1 — the client, the error dictionary, the bot-protection
// values and the field rules are all plain modules — so the node environment is
// the honest one; the jsdom tier arrives with the screens in PRs 1.5–1.8.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
