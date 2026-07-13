#!/usr/bin/env tsx
/**
 * tools/lint/migration-index-lint.ts — Drizzle migration-index collision guard
 * (#799, STATIC_GUARDS family).
 *
 * Why this exists: parallel sessions each author migrations on their own branch
 * off `origin/main`. Two branches independently generate the SAME next index
 * (both `0011_*`), and the collision is silent — `drizzle-kit generate` numbers
 * from the branch's stale base, so on merge one branch's `_journal.json` entry /
 * snapshot chain overwrites or drops the sibling. A dropped sibling migration =
 * a column/table that never applies in some environments. Observed 2026-07-12
 * (#705): branch `0011_neat_vapor` vs main's `0011_users_deactivated_at` —
 * caught only by manual vigilance during rebase.
 *
 * Checks (any hit ⇒ exit 1). `base` = origin/main journal entries, `local` =
 * this tree's journal entries, `branchNew` = local entries whose tag is absent
 * from base:
 *
 *   1. duplicate-idx         (always on) — two local entries share an `idx`.
 *   2. duplicate-file-prefix (always on) — two `apps/api/drizzle/*.sql` files
 *      share the same numeric `NNNN` prefix.
 *   3. index-collision       (branchNew only) — a branch-new entry has
 *      `idx <= max(base idx)`.
 *   4. dropped-base-entry    (branchNew only) — a base entry (idx+tag) is
 *      missing from local: the branch generated from a stale base and would
 *      drop a sibling migration on merge.
 *
 * A branch merely BEHIND main (no new migrations) is fine — checks 3–4 engage
 * only when the branch introduces migrations of its own.
 *
 * Base journal source:
 *   - Normal mode: `git show origin/main:apps/api/drizzle/meta/_journal.json`.
 *     If the ref is missing (shallow CI checkout), fall back to
 *     `git fetch --depth=1 origin main` + `git show FETCH_HEAD:…`. If the base
 *     is still unobtainable, print SKIP and exit 0 — never a false red.
 *   - TEST SEAM: with `LINT_FIXTURE_ROOT` set, the base journal is read from
 *     `<root>/origin-main/_journal.json` (fixture-only file; git is never run
 *     in fixture mode). Inert in production.
 *
 * Severity: WARN in Phase 0 (ADR-0007 §2.6; new guard lands WARN, promote to
 * BLOCK once stable). The CI job uses `continue-on-error`.
 *
 * Run: `pnpm lint:migration-index`. Failures: stderr + exit 1. Clean: exit 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_MODE = Boolean(process.env.LINT_FIXTURE_ROOT);
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[migration-index]";

const JOURNAL_REL = "apps/api/drizzle/meta/_journal.json";
const DRIZZLE_DIR = join(REPO_ROOT, "apps", "api", "drizzle");
const FIXTURE_BASE_JOURNAL = join(REPO_ROOT, "origin-main", "_journal.json");

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Finding {
  kind:
    | "duplicate-idx"
    | "duplicate-file-prefix"
    | "index-collision"
    | "dropped-base-entry";
  detail: string;
}

const REMEDY =
  `${TAG} Remedy: rebase onto origin/main, delete the colliding migration artifacts ` +
  `(the SQL file, its _journal.json entry, and its meta snapshot), then rerun ` +
  `\`pnpm --filter @ds/api drizzle:generate\` so the new migration numbers above ` +
  `main's max and its snapshot builds on main's latest.\n`;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function parseJournal(raw: string, source: string): JournalEntry[] {
  const parsed = JSON.parse(raw) as { entries?: JournalEntry[] };
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${source}: journal has no \`entries\` array`);
  }
  return parsed.entries.map((e) => ({ idx: e.idx, tag: e.tag }));
}

/** git helper (normal mode only): returns stdout, or null on non-zero exit. */
function git(...args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

/** The origin/main base journal, or null when unobtainable (⇒ SKIP). */
function readBaseJournal(): JournalEntry[] | null {
  if (FIXTURE_MODE) {
    // TEST SEAM — fixture-only base journal; never run git against a fixture tree.
    if (!existsSync(FIXTURE_BASE_JOURNAL)) return null;
    return parseJournal(
      readFileSync(FIXTURE_BASE_JOURNAL, "utf8"),
      FIXTURE_BASE_JOURNAL,
    );
  }
  const direct = git("show", `origin/main:${JOURNAL_REL}`);
  if (direct !== null) return parseJournal(direct, `origin/main:${JOURNAL_REL}`);
  // Shallow CI checkout: fetch the ref, then read it from FETCH_HEAD.
  if (git("fetch", "--depth=1", "origin", "main") !== null) {
    const fetched = git("show", `FETCH_HEAD:${JOURNAL_REL}`);
    if (fetched !== null) return parseJournal(fetched, `FETCH_HEAD:${JOURNAL_REL}`);
  }
  return null;
}

function main(): void {
  const localJournalPath = join(REPO_ROOT, JOURNAL_REL);
  if (!existsSync(localJournalPath)) {
    info("SKIP (no local journal at apps/api/drizzle/meta/_journal.json)");
    process.exit(0);
  }
  const local = parseJournal(readFileSync(localJournalPath, "utf8"), JOURNAL_REL);

  const findings: Finding[] = [];

  // (1) duplicate-idx — two local journal entries share the same idx.
  const byIdx = new Map<number, string[]>();
  for (const e of local) {
    byIdx.set(e.idx, [...(byIdx.get(e.idx) ?? []), e.tag]);
  }
  for (const [idx, tags] of byIdx) {
    if (tags.length > 1) {
      findings.push({
        kind: "duplicate-idx",
        detail: `journal idx ${idx} used by ${tags.length} entries: ${tags.join(", ")}`,
      });
    }
  }

  // (2) duplicate-file-prefix — two migration SQL files share a numeric prefix.
  const sqlFiles = existsSync(DRIZZLE_DIR)
    ? readdirSync(DRIZZLE_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f))
    : [];
  const byPrefix = new Map<string, string[]>();
  for (const f of sqlFiles) {
    const prefix = f.slice(0, 4);
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
  }
  for (const [prefix, files] of byPrefix) {
    if (files.length > 1) {
      findings.push({
        kind: "duplicate-file-prefix",
        detail: `SQL prefix ${prefix} used by ${files.length} files: ${files.join(", ")}`,
      });
    }
  }

  // (3)+(4) need the origin/main base journal.
  const base = readBaseJournal();
  if (base === null) {
    if (findings.length === 0) {
      info("SKIP (no origin/main base)");
      process.exit(0);
    }
    info("no origin/main base — base-relative checks skipped");
  } else {
    const baseTags = new Set(base.map((e) => e.tag));
    const branchNew = local.filter((e) => !baseTags.has(e.tag));
    if (branchNew.length > 0) {
      const baseMax = base.reduce((m, e) => Math.max(m, e.idx), -1);

      // (3) index-collision — a branch-new entry numbered at/below main's max.
      for (const e of branchNew) {
        if (e.idx <= baseMax) {
          findings.push({
            kind: "index-collision",
            detail:
              `branch migration \`${e.tag}\` has idx ${e.idx} ≤ origin/main max ${baseMax} — ` +
              `a sibling on main already owns this index`,
          });
        }
      }

      // (4) dropped-base-entry — a main entry (idx+tag) missing from the branch.
      const localKeys = new Set(local.map((e) => `${e.idx}:${e.tag}`));
      for (const e of base) {
        if (!localKeys.has(`${e.idx}:${e.tag}`)) {
          findings.push({
            kind: "dropped-base-entry",
            detail:
              `origin/main migration \`${e.tag}\` (idx ${e.idx}) is missing from this ` +
              `branch's journal — merging would drop it`,
          });
        }
      }
    }
    info(
      `journal: ${local.length} local entr(ies), ${base.length} on origin/main, ` +
        `${branchNew.length} branch-new; ${sqlFiles.length} SQL file(s)`,
    );
  }

  if (findings.length === 0) {
    info("PASS — no migration-index collisions.");
    process.exit(0);
  }

  for (const f of findings) {
    process.stderr.write(`${TAG} ${f.kind}  ${f.detail}\n`);
  }
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} migration-index finding(s).\n`,
  );
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
