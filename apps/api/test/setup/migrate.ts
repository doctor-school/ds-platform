import { spawnSync } from "node:child_process";

// Vitest globalSetup — applies the Drizzle migration against the configured
// DATABASE_URL before the e2e suite runs, so the pgvector extension and
// idempotency_keys table the readiness probes assert on actually exist.
//
// Local runs go through `drizzle:migrate`, which first takes a pre-migration
// dev-stand snapshot (setup-design §9.2 — a soft guardrail). CI has no
// dev-stand to snapshot, and the snapshot wrapper hard-fails when no
// `.env.local` is present, so on CI we run `drizzle:migrate:ci`, which invokes
// drizzle-kit directly with no snapshot step (#66). GitHub Actions sets CI=true;
// turbo passes DATABASE_URL + CI through to this task (turbo.json passThroughEnv).
//
// spawnSync with the argv form (NOT execSync with a stringified command): the
// repo security guard rejects exec/execSync on native binaries because they
// pass through a shell unconditionally. `shell: true` on Windows is required
// because pnpm is pnpm.cmd and Node's spawnSync does not resolve .cmd without it.
export default function globalSetup(): void {
  const script = process.env.CI ? "drizzle:migrate:ci" : "drizzle:migrate";
  const result = spawnSync("pnpm", [script], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `${script} failed with exit code ${result.status}; e2e suite cannot continue`,
    );
  }
}
