#!/usr/bin/env tsx
/**
 * tools/lint/audit-coverage-lint.ts — Universal edit-audit coverage guard
 * (010 EARS-8, #1089; STATIC_GUARDS family, sibling of migration-index-lint.ts /
 * endpoint-authz-lint.ts).
 *
 * Why this exists: spec 010 makes every domain-table mutation leave an
 * `audit_ledger` record via one generic PL/pgSQL trigger attached per table by
 * migration. The owner-confirmed requirement is that a NEW domain table (or a new
 * write path) must not silently ship WITHOUT that trigger. This guard enforces it
 * statically: every table declared in the `packages/db` schema must be EITHER
 * covered by an `audit_row_change()` trigger attached in the migration chain OR
 * present in `AUDIT_CAPTURE_ALLOWLIST` (packages/db/src/audit.ts) with a recorded
 * rationale. A table in neither set turns the guard red — allowlisting is then a
 * visible, reviewed, rationale-carrying diff, never a silent omission.
 *
 * Inputs (010-design §5):
 *   1. Schema tables — `pgTable("<name>", …)` literals across
 *      `packages/db/src/schema/*.ts` (barrel `index.ts` excluded). The schema
 *      source is the SSOT of "a domain table exists".
 *   2. Trigger attaches — `CREATE TRIGGER … ON "<table>" … EXECUTE FUNCTION
 *      audit_row_change()` across `apps/api/drizzle/*.sql`, minus any later
 *      `DROP TRIGGER`. Partition/child CREATE TABLEs in migrations are irrelevant
 *      — only schema-declared tables are enumerated, so partition noise never
 *      false-positives.
 *   3. Allowlist — the `AUDIT_CAPTURE_ALLOWLIST` TS registry (single source; the
 *      audit e2e reads the same file). Each entry MUST carry a non-empty
 *      rationale — a bare name (blank rationale) is itself a finding.
 *
 * Any schema table in neither (2) nor (3) ⇒ red, naming the table and both
 * remedies (attach the trigger, or allowlist it with a rationale).
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6; new guard lands WARN, promote to
 * BLOCK once stable) — the CI job uses `continue-on-error`. The guard itself
 * still exits 1 on a finding so `pnpm pr:preflight --static` surfaces it at the
 * developer's keyboard.
 *
 * TEST SEAM: with `LINT_FIXTURE_ROOT` set, all three inputs are read from a
 * minimal mirror under the fixture root (`packages/db/src/schema/*.ts`,
 * `packages/db/src/audit.ts`, `apps/api/drizzle/*.sql`) instead of the real repo.
 * Inert in production.
 *
 * Run: `pnpm lint:audit-coverage`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[audit-coverage]";

const SCHEMA_DIR = join(REPO_ROOT, "packages", "db", "src", "schema");
const AUDIT_REGISTRY = join(REPO_ROOT, "packages", "db", "src", "audit.ts");
const MIGRATIONS_DIR = join(REPO_ROOT, "apps", "api", "drizzle");

interface AllowlistEntry {
  table: string;
  rationale: string;
}

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}
function err(msg: string): void {
  process.stderr.write(`${TAG} ${msg}\n`);
}

/** Strip line comments (`//` for TS, `--` for SQL) and block comments so prose never matches. */
function stripComments(src: string, lineToken: "//" | "--"): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  const esc = lineToken === "//" ? "\\/\\/" : "--";
  return noBlock.replace(new RegExp(`${esc}[^\\n]*`, "g"), "");
}

/** Enumerate SQL table names from every `pgTable("<name>", …)` in the schema dir. */
function enumerateSchemaTables(): string[] {
  if (!existsSync(SCHEMA_DIR)) return [];
  const files = readdirSync(SCHEMA_DIR).filter(
    (f) => f.endsWith(".ts") && f !== "index.ts",
  );
  const tables = new Set<string>();
  const re = /pgTable\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const f of files) {
    const src = stripComments(readFileSync(join(SCHEMA_DIR, f), "utf8"), "//");
    for (const m of src.matchAll(re)) tables.add(m[1]);
  }
  return [...tables].sort();
}

/**
 * The set of tables carrying a live `audit_row_change()` trigger — every attach
 * across the (filename-sorted) migration chain, minus any later matching DROP.
 */
function attachedTables(): Set<string> {
  if (!existsSync(MIGRATIONS_DIR)) return new Set();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/i.test(f))
    .sort();
  // key = `${table}.${triggerName}` — a trigger name is unique per table.
  const live = new Map<string, string>();
  const attachRe =
    /^\s*CREATE\s+TRIGGER\s+"?(\w+)"?\b[\s\S]*?\bON\s+"?(\w+)"?\b[\s\S]*?\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\s+audit_row_change\b/i;
  const dropRe =
    /^\s*DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:ONLY\s+)?"?(\w+)"?/i;
  for (const f of files) {
    const sql = stripComments(readFileSync(join(MIGRATIONS_DIR, f), "utf8"), "--");
    // CREATE/DROP TRIGGER are single simple statements; splitting on `;`
    // fragments PL/pgSQL bodies harmlessly (they carry no TRIGGER DDL).
    for (const stmt of sql.split(";")) {
      const a = attachRe.exec(stmt);
      if (a) {
        live.set(`${a[2]}.${a[1]}`, a[2]);
        continue;
      }
      const d = dropRe.exec(stmt);
      if (d) live.delete(`${d[2]}.${d[1]}`);
    }
  }
  return new Set(live.values());
}

/** Load `AUDIT_CAPTURE_ALLOWLIST` from the TS registry (single source of truth). */
async function loadAllowlist(): Promise<AllowlistEntry[]> {
  if (!existsSync(AUDIT_REGISTRY)) {
    throw new Error(`audit registry not found at ${AUDIT_REGISTRY}`);
  }
  const mod = (await import(pathToFileURL(AUDIT_REGISTRY).href)) as {
    AUDIT_CAPTURE_ALLOWLIST?: AllowlistEntry[];
  };
  if (!Array.isArray(mod.AUDIT_CAPTURE_ALLOWLIST)) {
    throw new Error(`${AUDIT_REGISTRY}: no AUDIT_CAPTURE_ALLOWLIST export`);
  }
  return mod.AUDIT_CAPTURE_ALLOWLIST;
}

async function main(): Promise<void> {
  const schema = enumerateSchemaTables();
  if (schema.length === 0) {
    info("SKIP (no packages/db schema tables found)");
    process.exit(0);
  }
  const attached = attachedTables();
  const allowlist = await loadAllowlist();

  // A bare allowlist name (blank/whitespace rationale) is a finding on its own.
  const bareNames = allowlist
    .filter((e) => !e.rationale || e.rationale.trim() === "")
    .map((e) => e.table);
  const allowlisted = new Map(
    allowlist
      .filter((e) => e.rationale && e.rationale.trim() !== "")
      .map((e) => [e.table, e.rationale] as const),
  );

  const uncovered = schema.filter(
    (t) => !attached.has(t) && !allowlisted.has(t),
  );

  info(
    `${schema.length} schema table(s); ${attached.size} trigger-attached, ` +
      `${allowlisted.size} allowlisted.`,
  );
  // Surface each covering rationale on pass — allowlisting is never a bare name.
  for (const t of schema) {
    if (allowlisted.has(t)) info(`allowlisted: ${t} — ${allowlisted.get(t)}`);
  }

  if (uncovered.length === 0 && bareNames.length === 0) {
    info(`PASS — every schema table is audit-triggered or allowlisted.`);
    process.exit(0);
  }

  for (const t of uncovered) {
    err(
      `uncovered  table "${t}" has no audit_row_change() trigger in ` +
        `apps/api/drizzle/*.sql and no AUDIT_CAPTURE_ALLOWLIST entry. Remedy: ` +
        `either attach the trigger in a migration (\`CREATE TRIGGER ${t}_audit ` +
        `AFTER INSERT OR UPDATE OR DELETE ON "${t}" FOR EACH ROW EXECUTE ` +
        `FUNCTION audit_row_change();\`) OR add a rationale-carrying ` +
        `AUDIT_CAPTURE_ALLOWLIST entry in packages/db/src/audit.ts.`,
    );
  }
  for (const t of bareNames) {
    err(
      `bare-allowlist  allowlist entry "${t}" has an empty rationale — every ` +
        `AUDIT_CAPTURE_ALLOWLIST entry must carry a one-line rationale (no bare names).`,
    );
  }
  err(
    `FAIL — ${uncovered.length} uncovered table(s), ${bareNames.length} bare ` +
      `allowlist name(s). Universal audit coverage (010 EARS-8) is not satisfied.`,
  );
  process.exit(1);
}

main().catch((e) => {
  err(`unexpected error: ${(e as Error).stack ?? String(e)}`);
  process.exit(1);
});
