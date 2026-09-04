import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit + component config for `@ds/room` (#1722). Mirrors
// `packages/design-system/vitest.config.ts`: `@vitejs/plugin-react` supplies the
// JSX transform, jsdom supplies the DOM the client hooks and (from slice 2) the
// room composition need, and the include is scoped to the co-located test files
// under `src`. The shared convention is documented at
// apps/docs/content/architecture/component-testing.md.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
