import { defineConfig } from "vitest/config";

// Scope the run to the colocated parse-function tests. No browser/jsdom needed —
// extractPhone/extractText are pure functions over the webhook JSON.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.mjs"],
  },
});
