import { configDefaults, defineConfig } from "vitest/config";

// Scope the run to the guard exit-code specs in this folder. No environment is
// needed — each spec spawns the real guard as a subprocess and asserts its exit
// code, so the test process itself only needs node + child_process.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.ts"],
    // `fixtures/**` holds sample `*.spec.ts` files the guards SCAN (e.g. the
    // ears-naming / form fixtures) — they are inputs, not tests, so vitest must
    // not collect them as suites.
    exclude: [...configDefaults.exclude, "**/fixtures/**"],
    // A guard subprocess (tsx cold-start) is slower than a unit test; give it room.
    testTimeout: 30000,
  },
});
