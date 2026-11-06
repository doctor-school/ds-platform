// tools/deploy/lib/rehearsal-gate.mjs — the release driver's `rehearse` phase (Issue
// #3648; tech spec 2026-10-16-release-pipeline-off-workstation-en.md §5 «Migration
// rehearsal.» → «Release gate.», «Durable unit.», «Runtime budget.»).
//
// The phase sends the target tree's migration archive — the shape ds-read-entrypoint's
// `rehearse_archive` builds: `drizzle/<tag>.sql` and `drizzle/meta/_journal.json` — through
// the hop's data verb `rehearse <sha>` and polls `rehearsal-status <sha>` to a terminal
// report. Its verdict is one line a public failure note may carry: the failed migration's
// tag and SQLSTATE, or one fixed reason; never a message, which can quote a row value.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** The phase's whole budget: the rehearsal unit's runtime cap (`RuntimeMaxSec=900`). */
export const REHEARSAL_GATE_BUDGET_MS = 15 * 60 * 1000;
export const REHEARSAL_POLL_MS = 10_000;

/** The report reason of a unit that ended without a verdict (rehearse-migration.py UNFINISHED). */
export const REHEARSAL_UNFINISHED = "the rehearsal did not finish";
/** The verdict of a rehearsal that could not run for a reason outside the fixed list. */
export const REHEARSAL_CANNOT_RUN = "the rehearsal could not run";
const BUSY = "a rehearsal is running";

/**
 * The fixed reasons a rehearsal fails or refuses with (ds-deploy-entrypoint READ_REASONS,
 * rehearse-migration.py READ_REASONS + UNFINISHED): the only reason texts the gate passes on.
 */
export const REHEARSAL_REASONS = Object.freeze([
  "a release step is running",
  BUSY,
  "the read-only transaction check failed",
  "the read timed out",
  "insufficient headroom (disk)",
  "insufficient headroom (memory)",
  "copy behind prod",
  "copy exited before promotion",
  "copy did not promote in time",
  "archive check failed",
  "the read failed",
  REHEARSAL_UNFINISHED,
]);

const TAG_RE = /^[A-Za-z0-9_]{1,128}$/;
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const SQL_FILE_RE = /^[A-Za-z0-9_]{1,128}\.sql$/;
const JOURNAL = "drizzle/meta/_journal.json";

// ── break-glass ─────────────────────────────────────────────────────────────

/** The break-glass exception (`pnpm deploy:prod` only; `--local` takes no flag). */
export const SKIP_REHEARSAL_FLAG = "--skip-rehearsal";

/** Parse `--skip-rehearsal "<reason>"`: a non-empty reason is mandatory, as for `--release-gate-exempt`. */
export function parseSkipRehearsal(args) {
  const list = Array.isArray(args) ? args : [];
  const i = list.indexOf(SKIP_REHEARSAL_FLAG);
  if (i === -1) return { skip: false, reason: null };
  const raw = list[i + 1];
  if (typeof raw !== "string" || raw.trim() === "" || raw.startsWith("--")) {
    return {
      skip: false,
      reason: null,
      error:
        `${SKIP_REHEARSAL_FLAG} requires a non-empty reason, e.g. ` +
        `${SKIP_REHEARSAL_FLAG} "owner go: <why the migration ships without a rehearsal>"`,
    };
  }
  return { skip: true, reason: raw.trim() };
}

// ── the archive ─────────────────────────────────────────────────────────────

/** The migration files of an extracted tree, as archive members (bytes untouched). */
export function readTreeMigrations(tree) {
  const dir = join(tree, "apps", "api", "drizzle");
  const sql = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && SQL_FILE_RE.test(e.name))
    .map((e) => ({
      name: `drizzle/${e.name}`,
      data: readFileSync(join(dir, e.name)),
    }));
  return [
    ...sql,
    { name: JOURNAL, data: readFileSync(join(dir, "meta", "_journal.json")) },
  ];
}

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function ustarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, "latin1");
  header.write(octal(0, 8), 108, "latin1");
  header.write(octal(0, 8), 116, "latin1");
  header.write(octal(size, 12), 124, "latin1");
  header.write(octal(0, 12), 136, "latin1");
  header.fill(0x20, 148, 156); // the checksum field counts as spaces
  header.write("0", 156, "latin1");
  header.write("ustar\0", 257, "latin1");
  header.write("00", 263, "latin1");
  const sum = header.reduce((s, b) => s + b, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return header;
}

/** A gzip ustar stream of the members, sorted by name, regular files 0644 only. */
export function migrationArchive(files) {
  if (!files.some((f) => f.name === JOURNAL))
    throw new Error("the target tree has no migration journal");
  const blocks = [];
  for (const { name, data } of [...files].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (Buffer.byteLength(name) > 100)
      throw new Error(
        `migration member name too long for the archive: ${name}`,
      );
    blocks.push(
      ustarHeader(name, data.length),
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

// ── the verdict ─────────────────────────────────────────────────────────────

/** The one-line reason of a failed report: `migration <tag> failed (SQLSTATE <code>)` or a fixed reason. */
export function rehearsalFailureReason(report) {
  const failed = (
    Array.isArray(report?.migrations) ? report.migrations : []
  ).find((m) => m?.error);
  if (failed) {
    const { tag } = failed;
    const code = failed.error?.sqlstate;
    return TAG_RE.test(String(tag)) && SQLSTATE_RE.test(String(code))
      ? `migration ${tag} failed (SQLSTATE ${code})`
      : REHEARSAL_CANNOT_RUN;
  }
  return REHEARSAL_REASONS.includes(report?.reason)
    ? report.reason
    : REHEARSAL_CANNOT_RUN;
}

/** The fixed reason a refused data verb names on its first stderr line, else cannot-run. */
function refusalReason(error) {
  const line = String(error?.message ?? "").split(/\r?\n/)[0];
  return (
    REHEARSAL_REASONS.find((r) => line.endsWith(`: ${r}`)) ??
    REHEARSAL_CANNOT_RUN
  );
}

function parse(stdout) {
  try {
    const value = JSON.parse(String(stdout).trim());
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Run the gate. `call(words, { input })` runs one data verb and resolves to its stdout
 * (rejects on a non-zero exit). Resolves `{ ok: true, pending }` or `{ ok: false, reason }`.
 *
 * `rehearse-restore <sha>` shares the unit name and report path (spec «Restore only.»),
 * so a `running` answer or a terminal report can be a restore-only run's: such a report
 * is never this gate's verdict — it starts its own rehearsal once, and a second
 * restore-only report refuses as busy.
 */
export async function runRehearsalGate({
  sha,
  archive,
  call,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = (line) => console.log(line),
  budgetMs = REHEARSAL_GATE_BUDGET_MS,
  pollMs = REHEARSAL_POLL_MS,
}) {
  const deadline = now() + budgetMs;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let start;
    try {
      start = parse(await call(["rehearse", sha], { input: archive }));
    } catch (error) {
      return { ok: false, reason: refusalReason(error) };
    }
    if (start?.state === "no pending migrations") {
      log("rehearsal: no pending migrations");
      return { ok: true, pending: 0 };
    }
    if (start?.state !== "started" && start?.state !== "running")
      return { ok: false, reason: REHEARSAL_CANNOT_RUN };
    log(
      `rehearsal: ${start.state === "running" ? "attached to the running" : "started the"} rehearsal of ${sha.slice(0, 12)}`,
    );
    let report = null;
    while (!report) {
      if (now() + pollMs > deadline)
        return { ok: false, reason: REHEARSAL_UNFINISHED };
      await sleep(pollMs);
      let status;
      try {
        status = parse(await call(["rehearsal-status", sha]));
      } catch (error) {
        return { ok: false, reason: refusalReason(error) };
      }
      if (status?.state === "running") continue;
      if (status?.state !== "succeeded" && status?.state !== "failed")
        return { ok: false, reason: REHEARSAL_CANNOT_RUN };
      report = status;
    }
    if (report.restoreOnly === true) {
      log(
        "rehearsal: the report is a restore-only run's — starting this release's rehearsal",
      );
      continue;
    }
    if (report.restoreOnly !== false || report.sha !== sha)
      return { ok: false, reason: REHEARSAL_CANNOT_RUN };
    if (report.state === "succeeded") {
      const pending = Number.isInteger(report.pending) ? report.pending : 0;
      log(
        `rehearsal: succeeded (${pending} pending migration${pending === 1 ? "" : "s"} applied on the copy)`,
      );
      return { ok: true, pending };
    }
    return { ok: false, reason: rehearsalFailureReason(report) };
  }
  return { ok: false, reason: BUSY };
}
