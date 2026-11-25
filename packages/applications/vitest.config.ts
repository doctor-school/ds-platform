import { defineConfig } from "vitest/config";

// Unit config for `@ds/applications` (033, #4031). The model and the client are
// pure TypeScript over `fetch`, so the node environment is enough; the include
// is scoped to the co-located test files under `src`. The shared convention is
// documented at apps/docs/content/architecture/component-testing.md.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
