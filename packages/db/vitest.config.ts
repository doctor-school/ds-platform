import { defineConfig } from "vitest/config";

// Scope the run to the TypeScript sources under `src` only. `tsc -b` (the `^build`
// dependency of the turbo `test` task) compiles `src` into `dist`; without this
// include Vitest's default glob would also pick up the emitted `dist/**/*.spec.js`
// and run every spec twice. The pool-error-handler spec constructs a `pg.Pool`
// but never opens a real connection, so no environment or setup is needed and it
// runs in the no-DB `unit` CI job (`--filter='!@ds/api'`).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
});
