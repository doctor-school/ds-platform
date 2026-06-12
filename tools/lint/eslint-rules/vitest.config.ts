import { defineConfig } from "vitest/config";

// Scope the run to the rule unit tests in this folder. No environment/setup is
// needed — ESLint's RuleTester drives the rule directly with a configured parser,
// it does not need jsdom or a browser.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.ts"],
  },
});
