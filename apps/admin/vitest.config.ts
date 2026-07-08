import { defineConfig } from "vitest/config";

/**
 * Fast unit tier for the admin app. Scoped to pure-TS `*.test.ts` co-located with
 * the helpers under test (МСК formatter, lifecycle-action derivation) — the
 * live-stand browser contract is covered by the playwright-bdd e2e suite
 * (`e2e/`), which is excluded here. Node environment: no React DOM rendering in
 * this tier.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e/**", "**/*.spec.ts"],
  },
});
