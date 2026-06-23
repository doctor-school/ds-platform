import { defineConfig } from "vitest/config";

// Scope the run to the guard exit-code specs in this folder. No environment is
// needed — each spec spawns the real guard as a subprocess and asserts its exit
// code, so the test process itself only needs node + child_process.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.ts"],
    // A guard subprocess (tsx cold-start) is slower than a unit test; give it room.
    testTimeout: 30000,
  },
});
