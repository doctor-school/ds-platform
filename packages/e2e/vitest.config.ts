import { defineConfig } from "vitest/config";

// Unit config for the PURE seams of the regression-contract package: route
// filtering, dynamic-segment resolution and navigation-model projection. The
// browser-driven parts (`derived/*.spec.ts`, `steps/**`) are Playwright specs
// and are excluded here — they need a running slot, which `pnpm test` never has.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "*.test.ts"],
    exclude: ["node_modules", "dist", ".features-gen", "derived/**"],
  },
});
