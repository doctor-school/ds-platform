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
 * Two checks, in this order:
 *
 *   1. schema-coverage — every `packages/db/src/schema/*.ts` that declares a
 *      table (`pgTable(`) must be listed in the `schema:` array of
 *      `packages/db/drizzle.config.ts`. That array enumerates concrete files by
 *      hand (the barrel cannot be used — see the config's own comment), so a
 *      NEW table file that nobody appends there is invisible to drizzle-kit:
 *      `generate` diffs the old set, emits nothing, and check (2) would go
 *      green while the migration is genuinely missing. A new table is the most
 *      likely drift shape there is, so it gets an explicit check rather than
 *      relying on the diff. Files declaring no table (helpers, enums, the
 *      `index.ts` barrel) are exempt by construction.
 *   2. regenerate-and-assert-clean — run drizzle-kit `generate` into the
 *      committed `out` dir and assert the working tree did not change:
 *      a. record which paths under `apps/api/drizzle/` are already dirty (in
 *         CI the checkout is clean, so the set is empty; locally it is whatever
 *         migration work the developer has in flight);
 *      b. run `drizzle-kit generate --config ../../packages/db/drizzle.config.ts`
 *         with CWD `apps/api` — the config's `schema`/`out` paths are relative
 *         to that invocation dir, not to the config file. `generate` DIFFS the
 *         schema files against the latest `meta/` snapshot; it opens no
 *         database connection (only `push`/`migrate` do), so this runs on a
 *         plain runner with no services;
 *      c. any path dirty AFTER but not BEFORE ⇒ FAIL. Pre-existing local dirt
 *         is never reported, so the guard cannot false-red a developer
 *         mid-migration.
 *
 * `drizzle-kit generate` prompts interactively when it cannot tell a rename
 * from a drop+add, so stdin is closed and the run is time-boxed: a prompt (or
 * a hang) becomes a deterministic failure with a named cause, never a stuck
 * CI job.
 *
 * SKIP (exit 0, "nothing to check") when the config or the `out` dir is
 * absent — evaluated emptiness, not a hardcoded pass.
 *
 * Severity: BLOCK. The defect it catches is a prod-only runtime failure that
 * no other check in the pipeline can see, and the remedy is always the same
 * one command. Its step lives in the `guards-block` batch of
 * `.github/workflows/ci.yml` (plain step — a red fails the batch, which fails
 * the required `ci` check).
 *
 * KNOWN FALSE-POSITIVE CLASS (one, and it is routine): a `drizzle-kit` version
 * bump that changes snapshot shape or generated-SQL formatting reds this guard
 * on an unrelated PR (Dependabot included), because generated output is
 * compared byte-wise against output committed by an OLDER generator. That is
 * not a schema desync; the remedy is still "regenerate and commit", which is
 * why the posture stays BLOCK — but read a red on a dep-bump PR as this, not
 * as a missing migration.
 *
 * TEST SEAM: with `LINT_FIXTURE_ROOT` set, the repo root is the fixture dir and
 * BOTH subprocess boundaries are replaced by fixture files, so every branch is
 * drivable without git or drizzle-kit (git is never run against a fixture tree):
 *   <root>/generate.json          — the canned `generate` outcome
 *                                   ({ status, signal?, stdout?, stderr? });
 *                                   absent ⇒ a clean `{ status: 0 }`.
 *   <root>/git-status/before.txt  — porcelain lines before `generate`
 *   <root>/git-status/after.txt   — porcelain lines after it (absent ⇒ empty)
 * Inert in production.
 *
 * Run: `pnpm lint:db-drift`. Findings: stderr + exit 1. Clean: exit 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_MODE = Boolean(process.env.LINT_FIXTURE_ROOT);
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[db-drift]";

const API_DIR = join(REPO_ROOT, "apps", "api");
const OUT_REL = "apps/api/drizzle";
const OUT_ABS = join(REPO_ROOT, "apps", "api", "drizzle");
const CONFIG_REL = "../../packages/db/drizzle.config.ts";
const CONFIG_ABS = join(REPO_ROOT, "packages", "db", "drizzle.config.ts");
const SCHEMA_DIR = join(REPO_ROOT, "packages", "db", "src", "schema");
const GENERATE_TIMEOUT_MS = 120_000;

const REMEDY =
  `${TAG} Remedy: run \`pnpm --filter @ds/api drizzle:generate\` and COMMIT the ` +
  `generated migration (the new \`${OUT_REL}/NNNN_*.sql\`, its \`meta/\` snapshot, ` +
  `and the \`meta/_journal.json\` entry). If the schema edit was accidental, ` +
  `revert it in \`packages/db/src/schema/\` instead.\n`;

interface GenerateOutcome {
  status: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  failedToSpawn?: boolean;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Porcelain status of the migration dir, as a set of `XY path` lines. */
function dirtyPaths(phase: "before" | "after"): Set<string> {
  let raw: string;
  if (FIXTURE_MODE) {
    // TEST SEAM — canned porcelain; git is never spawned against a fixture tree.
    const file = join(REPO_ROOT, "git-status", `${phase}.txt`);
    raw = existsSync(file) ? readFileSync(file, "utf8") : "";
  } else {
    const r = spawnSync("git", ["status", "--porcelain", "--", OUT_REL], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      throw new Error(
        `git status failed (${String(r.status)}): ${r.stderr?.trim() ?? "no stderr"}`,
      );
    }
    raw = r.stdout;
  }
  return new Set(
    raw
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0),
  );
}

/** Run (or, in fixture mode, read the canned outcome of) `drizzle-kit generate`. */
function runGenerate(): GenerateOutcome {
  if (FIXTURE_MODE) {
    // TEST SEAM — canned outcome; drizzle-kit is never spawned in fixture mode.
    const file = join(REPO_ROOT, "generate.json");
    if (!existsSync(file)) return { status: 0 };
    return JSON.parse(readFileSync(file, "utf8")) as GenerateOutcome;
  }
  const r = spawnSync(
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
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout,
    stderr: r.stderr,
    failedToSpawn: r.error !== undefined,
  };
}

/**
 * The basenames listed in the config's `schema:` array. Parsed from the source
 * text rather than by importing the config: importing would execute
 * drizzle-kit's `defineConfig` (and the `process.env.DATABASE_URL!` read) for
 * what is a purely lexical question.
 */
function configuredSchemaFiles(source: string): string[] {
  const block = /schema\s*:\s*\[([\s\S]*?)\]/.exec(source);
  if (block === null) return [];
  return [...block[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) =>
    m[1].split("/").pop()!,
  );
}

/** Table-declaring schema files on disk, by basename. */
function schemaFilesOnDisk(): string[] {
  if (!existsSync(SCHEMA_DIR)) return [];
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .filter((f) =>
      readFileSync(join(SCHEMA_DIR, f), "utf8").includes("pgTable("),
    );
}

function main(): void {
  if (!existsSync(CONFIG_ABS)) {
    info("SKIP (no packages/db/drizzle.config.ts)");
    process.exit(0);
  }
  if (!existsSync(OUT_ABS)) {
    info(`SKIP (no committed migration dir at ${OUT_REL})`);
    process.exit(0);
  }

  // (1) schema-coverage — a table file absent from the config's explicit list is
  // invisible to `generate`, so its drift would pass check (2) green.
  const configured = new Set(
    configuredSchemaFiles(readFileSync(CONFIG_ABS, "utf8")),
  );
  const onDisk = schemaFilesOnDisk();
  const unlisted = onDisk.filter((f) => !configured.has(f));
  if (unlisted.length > 0) {
    process.stderr.write(
      `${TAG} FAIL — ${unlisted.length} table file(s) under packages/db/src/schema/ are ` +
        `NOT listed in the \`schema:\` array of packages/db/drizzle.config.ts, so ` +
        `drizzle-kit never sees them and their migrations would silently go missing:\n`,
    );
    for (const f of unlisted) process.stderr.write(`${TAG}   ${f}\n`);
    process.stderr.write(
      `${TAG} Remedy: append \`"../../packages/db/src/schema/<file>"\` to that array ` +
        `(paths are spelled relative to apps/api), then run ` +
        `\`pnpm --filter @ds/api drizzle:generate\` and commit the migration.\n`,
    );
    process.exit(1);
  }
  info(
    `schema-coverage OK — ${onDisk.length} table file(s), all listed in drizzle.config.ts`,
  );

  // (2) regenerate-and-assert-clean.
  const before = dirtyPaths("before");
  if (before.size > 0) {
    info(
      `${before.size} pre-existing dirty path(s) under ${OUT_REL} — those are ignored, ` +
        `only NEW changes are reported`,
    );
  }

  const gen = runGenerate();
  if (gen.stdout) process.stdout.write(gen.stdout);
  if (gen.failedToSpawn === true || gen.status !== 0) {
    if (gen.stderr) process.stderr.write(gen.stderr);
    process.stderr.write(
      `${TAG} FAIL — \`drizzle-kit generate\` did not complete ` +
        `(status ${String(gen.status)}${gen.signal ? `, signal ${gen.signal}` : ""}). ` +
        `A timeout here usually means drizzle-kit hit its interactive ` +
        `rename-vs-drop prompt: generate the migration locally and commit it.\n`,
    );
    process.exit(1);
  }

  const after = dirtyPaths("after");
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
  if (!FIXTURE_MODE) {
    const diff = spawnSync("git", ["diff", "--", OUT_REL], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (diff.stdout) process.stderr.write(`${diff.stdout}\n`);
  }
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
