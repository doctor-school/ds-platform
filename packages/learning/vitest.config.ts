import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pure-model and server-unit tests (node) plus the `./ui` component tests
// (jsdom, per-file `@vitest-environment` docblock) co-located under `src`;
// scoped so the emitted `dist/**` (the `tsc -b` output the api consumes) never
// runs twice.
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
