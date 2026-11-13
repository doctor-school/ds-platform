import { defineConfig } from "vitest/config";

// Pure-model and server-unit tests co-located under `src`; scoped so the
// emitted `dist/**` (the `tsc -b` output the api consumes) never runs twice.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
