#!/usr/bin/env node
// tools/staging/golden-db.mjs — builds the `ds_golden` TEMPLATE database of the
// staging box (Issue #2063, staging tech spec §4 / §8 step 3).
//
// Why a template at all. Per-PR preview slots are CLONES (`CREATE DATABASE …
// TEMPLATE ds_golden`, step 4), which is orders of magnitude cheaper than
// re-running migrations and a seed per slot. A clone is only as trustworthy as
// the template, so the template is BUILT, never patched:
//
//   ds_golden_next  ← created empty, migrated, seeded
//   ds_golden       ← renamed to ds_golden_prev   (one generation kept)
//   ds_golden_next  ← renamed to ds_golden
//
// Never migrating in place is the whole point. An in-place migration leaves a
// template that is half old and half new whenever a migration fails midway, and
// every slot cloned afterwards inherits that state. Building beside the live
// template means a failed build changes nothing: `ds_golden` keeps serving the
// previous generation until the new one is complete.
//
// This module is a pure seam plus a thin CLI. Every decision — names, guards,
// statement order — is a pure function, unit-tested in `golden-db.test.mjs`; the
// executor (`runGoldenDbBuild`) is injectable so the tests never touch Postgres.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Default base name of the template. */
export const GOLDEN_DB_BASE = "ds_golden";

/**
 * Postgres identifiers this tool is willing to emit.
 *
 * Deliberately narrow: database names reach `CREATE DATABASE` / `DROP DATABASE`
 * as raw SQL text (Postgres does not accept a bind parameter there), so anything
 * outside this shape is refused rather than quoted-and-hoped.
 */
export const DB_NAME_RE = /^[a-z][a-z0-9_]{0,45}$/;

/** Raised for an unusable input or plan — the caller must fail closed. */
export class GoldenDbError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoldenDbError";
  }
}

export function assertDatabaseName(name) {
  if (!DB_NAME_RE.test(String(name ?? ""))) {
    throw new GoldenDbError(
      `unusable database name: ${JSON.stringify(name)} — expected ${DB_NAME_RE}`,
    );
  }
  return name;
}

/** The three generations the build juggles. */
export function templateDatabaseNames(base = GOLDEN_DB_BASE) {
  assertDatabaseName(base);
  const names = {
    current: base,
    next: `${base}_next`,
    prev: `${base}_prev`,
  };
  for (const name of Object.values(names)) assertDatabaseName(name);
  return Object.freeze(names);
}

/**
 * Rewrites a libpq URL to point at another database on the same server.
 *
 * The build needs three connections — the maintenance database to issue
 * `CREATE`/`DROP`/`ALTER DATABASE`, and `ds_golden_next` for the migrate and the
 * seed. Deriving them from ONE operator-supplied URL keeps credentials in a
 * single place and out of this file.
 */
export function withDatabase(url, database) {
  assertDatabaseName(database);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new GoldenDbError("DATABASE_URL is not a valid connection URL");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new GoldenDbError(
      `expected a postgres:// connection URL, got ${parsed.protocol}//`,
    );
  }
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Statements that free `next` before it is created.
 *
 * `CREATE DATABASE` fails if the name is taken, and a previous build that died
 * between create and rename leaves exactly that. Dropping the leftover is safe:
 * `ds_golden_next` is never served to anyone — only a completed build renames it
 * into place.
 */
export function prepareStatements(names) {
  return [
    terminateBackendsStatement(names.next),
    `DROP DATABASE IF EXISTS "${names.next}"`,
    `CREATE DATABASE "${names.next}"`,
  ];
}

/**
 * The rename cycle, in the only order that is safe.
 *
 * `ds_golden_prev` is dropped FIRST: Postgres refuses to rename onto an existing
 * name, and keeping two historical generations was never the contract (§4 keeps
 * exactly one). Backends are terminated before each rename because
 * `ALTER DATABASE … RENAME TO` fails while any session is connected — a slot
 * clone or a forgotten `psql` would otherwise stall the build indefinitely.
 */
export function renameCycleStatements(names, { hasCurrent = true } = {}) {
  const statements = [
    terminateBackendsStatement(names.prev),
    `DROP DATABASE IF EXISTS "${names.prev}"`,
  ];
  if (hasCurrent) {
    statements.push(
      terminateBackendsStatement(names.current),
      `ALTER DATABASE "${names.current}" RENAME TO "${names.prev}"`,
    );
  }
  statements.push(
    terminateBackendsStatement(names.next),
    `ALTER DATABASE "${names.next}" RENAME TO "${names.current}"`,
  );
  return statements;
}

/** Disconnects every session on `name` so a rename or drop can proceed. */
export function terminateBackendsStatement(name) {
  assertDatabaseName(name);
  return `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`;
}

/**
 * The commands that fill `ds_golden_next`.
 *
 * The migrate is the SAME entry point the api image runs on the box
 * (`@ds/api drizzle:migrate:ci` → `drizzle-kit migrate`), not a second
 * implementation: a template built by a private migrate path would prove nothing
 * about the migrations production actually applies.
 */
export function buildCommands(nextUrl) {
  return [
    {
      label: "migrate",
      command: "pnpm",
      args: ["--filter", "@ds/api", "run", "drizzle:migrate:ci"],
      env: { DATABASE_URL: nextUrl },
    },
    {
      label: "seed:golden",
      command: "pnpm",
      args: ["--filter", "@ds/db", "run", "seed:golden"],
      env: { DATABASE_URL: nextUrl },
    },
  ];
}

/**
 * The full ordered plan: prepare → fill → publish.
 *
 * Returned as data so a test can assert the ordering and a `--dry-run` can print
 * it without touching the server.
 */
export function planGoldenDbBuild({
  adminUrl,
  base = GOLDEN_DB_BASE,
  hasCurrent = true,
}) {
  const names = templateDatabaseNames(base);
  const nextUrl = withDatabase(adminUrl, names.next);
  return Object.freeze({
    names,
    nextUrl,
    prepare: prepareStatements(names),
    fill: buildCommands(nextUrl),
    publish: renameCycleStatements(names, { hasCurrent }),
  });
}

/**
 * Executes a plan through injected effects.
 *
 * `sql(statement)` and `run(command)` are supplied by the CLI below and replaced
 * wholesale in the tests, which is what keeps this file unit-testable without a
 * database and without a network.
 */
export async function runGoldenDbBuild(plan, { sql, run, log = () => {} }) {
  for (const statement of plan.prepare) {
    log(`[prepare] ${statement}`);
    await sql(statement);
  }
  for (const command of plan.fill) {
    log(`[fill] ${command.label}`);
    await run(command);
  }
  // Publish only after the fill succeeded: a throw above leaves `ds_golden`
  // untouched and still serving the previous generation.
  for (const statement of plan.publish) {
    log(`[publish] ${statement}`);
    await sql(statement);
  }
  return plan.names;
}

/** `--base <name>` / `--dry-run`, nothing else. */
export function parseArgs(argv) {
  const options = { base: GOLDEN_DB_BASE, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--base") {
      const value = argv[i + 1];
      if (!value) throw new GoldenDbError("--base requires a value");
      options.base = value;
      i += 1;
    } else throw new GoldenDbError(`unknown argument: ${arg}`);
  }
  assertDatabaseName(options.base);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new GoldenDbError(
      "DATABASE_URL is required — the maintenance connection of the staging Postgres (read it from the box env, never hardcode)",
    );
  }

  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();

  let hasCurrent;
  try {
    const names = templateDatabaseNames(options.base);
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [names.current],
    );
    hasCurrent = existing.rowCount > 0;

    const plan = planGoldenDbBuild({
      adminUrl,
      base: options.base,
      hasCurrent,
    });

    if (options.dryRun) {
      for (const statement of [...plan.prepare, ...plan.publish]) {
        console.log(statement);
      }
      for (const command of plan.fill) {
        console.log(`${command.command} ${command.args.join(" ")}`);
      }
      return;
    }

    await runGoldenDbBuild(plan, {
      sql: (statement) => admin.query(statement),
      run: (command) => {
        execFileSync(command.command, command.args, {
          stdio: "inherit",
          env: { ...process.env, ...command.env },
          shell: process.platform === "win32",
        });
      },
      log: (line) => console.log(line),
    });
    console.log(
      `${plan.names.current} rebuilt${hasCurrent ? `; previous generation kept as ${plan.names.prev}` : ""}`,
    );
  } finally {
    await admin.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
