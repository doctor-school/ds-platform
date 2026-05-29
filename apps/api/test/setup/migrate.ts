import { spawnSync } from "node:child_process";

// Vitest globalSetup — applies the Drizzle migration against the configured
// DATABASE_URL before the e2e suite runs, so the pgvector extension and
// idempotency_keys table the readiness probes assert on actually exist.
//
// spawnSync with the argv form (NOT execSync with a stringified command): the
// repo security guard rejects exec/execSync on native binaries because they
// pass through a shell unconditionally. `shell: true` on Windows is required
// because pnpm is pnpm.cmd and Node's spawnSync does not resolve .cmd without it.
export default function globalSetup(): void {
  // No dev-stand configured (e.g. CI) — skip the migration instead of failing.
  // The DB-dependent e2e suites self-skip via describe.skipIf(!DATABASE_URL).
  // Spec 002 §9: apps/api e2e runs locally only until the CI Postgres-service
  // follow-up (#64 notes).
  if (!process.env.DATABASE_URL) {
    return;
  }

  const result = spawnSync("pnpm", ["drizzle:migrate"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `drizzle:migrate failed with exit code ${result.status}; e2e suite cannot continue`,
    );
  }
}
