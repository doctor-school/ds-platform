#!/usr/bin/env tsx
/**
 * tools/lint/db-drift-lint.ts — Drizzle schema↔migration drift guard
 * (ADR-0006 §7 "DB drift" row; #1236).
 *
 * Why this exists: `packages/db/src/schema/*.ts` is the DB SSOT (AGENTS.md §8),
 * and `apps/api/drizzle/` holds the committed migration chain + drizzle-kit
 * snapshots generated from it. Editing a table definition WITHOUT running
 * `pnpm --filter @ds/api drizzle:generate` leaves the two out of sync: the ORM
 * types a column that no environment's database actually has. The desync is
 * invisible to typecheck, unit tests, and e2e (which run against a database
 * migrated from the SAME stale chain) — it only surfaces at runtime, in prod,
 * as a missing-column error.
 *
 * The check: regenerate into the committed `out` dir and assert the working
 * tree did not change.
 *
 *   1. Record which paths under `apps/api/drizzle/` are already dirty (in CI
 *      the checkout is clean, so the set is empty; locally it is whatever
 *      migration work the developer has in flight).
 *   2. Run `drizzle-kit generate --config ../../packages/db/drizzle.config.ts`
 *      with CWD `apps/api` — the config's `schema`/`out` paths are relative to
 *      that invocation dir, not to the config file. `generate` DIFFS the schema
 *      files against the latest `meta/` snapshot; it opens no database
 *      connection (only `push`/`migrate` do), so this runs on a plain runner
 *      with no services.
 *   3. Any path dirty AFTER but not BEFORE ⇒ the schema had un-generated
 *      changes ⇒ FAIL. Pre-existing local dirt is never reported, so the guard
 *      cannot false-red a developer mid-migration.
 *
 * `drizzle-kit generate` prompts interactively when it cannot tell a rename
 * from a drop+add, so stdin is closed and the run is time-boxed: a prompt (or
 * a hang) becomes a deterministic failure with a named cause, never a stuck
 * CI job.
 *
 * SKIP (exit 0, "nothing to check") when the config or the `out` dir is
 * absent — evaluated emptiness, not a hardcoded pass.
 *
 * Severity: BLOCK. It is a byte-for-byte comparison of generated output
 * against committed output with no heuristic and no false-positive class, and
 * the defect it catches is a prod-only runtime failure. Its step lives in the
 * `guards-block` batch of `.github/workflows/ci.yml` (plain step — a red fails
 * the batch, which fails the required `ci` check).
 *
 * Run: `pnpm lint:db-drift`. Findings: stderr + exit 1. Clean: exit 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[db-drift]";

const API_DIR = join(REPO_ROOT, "apps", "api");
const OUT_REL = "apps/api/drizzle";
const CONFIG_REL = "../../packages/db/drizzle.config.ts";
const CONFIG_ABS = join(REPO_ROOT, "packages", "db", "drizzle.config.ts");
const GENERATE_TIMEOUT_MS = 120_000;

const REMEDY =
  `${TAG} Remedy: run \`pnpm --filter @ds/api drizzle:generate\` and COMMIT the ` +
  `generated migration (the new \`${OUT_REL}/NNNN_*.sql\`, its \`meta/\` snapshot, ` +
  `and the \`meta/_journal.json\` entry). If the schema edit was accidental, ` +
  `revert it in \`packages/db/src/schema/\` instead.\n`;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Porcelain status of the migration dir, as a set of `XY path` lines. */
function dirtyPaths(): Set<string> {
  const r = spawnSync("git", ["status", "--porcelain", "--", OUT_REL], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(
      `git status failed (${r.status}): ${r.stderr?.trim() ?? "no stderr"}`,
    );
  }
  return new Set(
    r.stdout
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0),
  );
}

function main(): void {
  if (!existsSync(CONFIG_ABS)) {
    info("SKIP (no packages/db/drizzle.config.ts)");
    process.exit(0);
  }
  if (!existsSync(join(REPO_ROOT, "apps", "api", "drizzle"))) {
    info(`SKIP (no committed migration dir at ${OUT_REL})`);
    process.exit(0);
  }

  const before = dirtyPaths();
  if (before.size > 0) {
    info(
      `${before.size} pre-existing dirty path(s) under ${OUT_REL} — those are ignored, ` +
        `only NEW changes are reported`,
    );
  }

  const gen = spawnSync(
    "pnpm",
    ["exec", "drizzle-kit", "generate", "--config", CONFIG_REL],
    {
      cwd: API_DIR,
      encoding: "utf8",
      // No TTY and no stdin: drizzle-kit's rename/drop disambiguation prompt
      // must fail fast rather than block a runner forever.
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GENERATE_TIMEOUT_MS,
      shell: process.platform === "win32",
    },
  );
  if (gen.stdout) process.stdout.write(gen.stdout);
  if (gen.error !== undefined || gen.status !== 0) {
    if (gen.stderr) process.stderr.write(gen.stderr);
    process.stderr.write(
      `${TAG} FAIL — \`drizzle-kit generate\` did not complete ` +
        `(status ${String(gen.status)}${gen.signal ? `, signal ${gen.signal}` : ""}). ` +
        `A timeout here usually means drizzle-kit hit its interactive ` +
        `rename-vs-drop prompt: generate the migration locally and commit it.\n`,
    );
    process.exit(1);
  }

  const after = dirtyPaths();
  const introduced = [...after].filter((line) => !before.has(line));

  if (introduced.length === 0) {
    info(`PASS — ${OUT_REL} is in sync with packages/db/src/schema.`);
    process.exit(0);
  }

  process.stderr.write(
    `${TAG} FAIL — regenerating produced ${introduced.length} uncommitted change(s) ` +
      `under ${OUT_REL}: the Drizzle schema and the committed migration chain have drifted.\n`,
  );
  for (const line of introduced) process.stderr.write(`${TAG}   ${line}\n`);
  const diff = spawnSync("git", ["diff", "--", OUT_REL], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (diff.stdout) process.stderr.write(`${diff.stdout}\n`);
  process.stderr.write(REMEDY);
  process.exit(1);
}

try {
  main();
} catch (e) {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
}
