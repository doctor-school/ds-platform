// tools/staging/golden-db.test.mjs — Issue #2063.
//
// The regressions these lock: the template is BUILT beside the live one and only
// published when the fill succeeded, exactly one previous generation survives,
// and no database name reaches raw SQL unvalidated. All of it runs offline — the
// executor is injected, so the tests never open a connection.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DB_NAME_RE,
  GOLDEN_DB_BASE,
  GoldenDbError,
  assertDatabaseName,
  buildCommands,
  parseArgs,
  planGoldenDbBuild,
  prepareStatements,
  renameCycleStatements,
  runGoldenDbBuild,
  templateDatabaseNames,
  terminateBackendsStatement,
  withDatabase,
} from "./golden-db.mjs";

const ADMIN_URL = "postgres://ops:secret@staging.internal:5432/postgres";

test("the three generations are derived from one base name", () => {
  const names = templateDatabaseNames();
  assert.deepEqual(
    { ...names },
    { current: "ds_golden", next: "ds_golden_next", prev: "ds_golden_prev" },
  );
  assert.equal(names.current, GOLDEN_DB_BASE);
});

test("a database name that cannot be safely interpolated is refused", () => {
  for (const bad of [
    'ds_golden"; DROP DATABASE postgres; --',
    "ds golden",
    "1golden",
    "DS_GOLDEN",
    "",
    undefined,
  ]) {
    assert.throws(() => assertDatabaseName(bad), GoldenDbError);
  }
  assert.match("ds_golden", DB_NAME_RE);
});

test("the fill connects to ds_golden_next, never to the live template", () => {
  const nextUrl = withDatabase(ADMIN_URL, "ds_golden_next");
  assert.equal(new URL(nextUrl).pathname, "/ds_golden_next");
  // Credentials and host survive the rewrite — one operator-supplied URL.
  assert.equal(new URL(nextUrl).host, "staging.internal:5432");
  assert.equal(new URL(nextUrl).username, "ops");
});

test("a non-postgres URL is refused rather than silently rewritten", () => {
  assert.throws(
    () => withDatabase("https://example.test/db", "ds_golden_next"),
    GoldenDbError,
  );
  assert.throws(
    () => withDatabase("not a url", "ds_golden_next"),
    GoldenDbError,
  );
});

test("a leftover ds_golden_next from a dead build is cleared before create", () => {
  const statements = prepareStatements(templateDatabaseNames());
  assert.match(statements[0], /pg_terminate_backend/);
  assert.match(statements[1], /^DROP DATABASE IF EXISTS "ds_golden_next"$/);
  assert.match(statements[2], /^CREATE DATABASE "ds_golden_next"$/);
  // Nothing in the prepare phase may touch the live template.
  for (const statement of statements.slice(1)) {
    assert.doesNotMatch(statement, /"ds_golden"/);
  }
});

test("the publish cycle keeps exactly one previous generation", () => {
  const statements = renameCycleStatements(templateDatabaseNames());
  const ddl = statements.filter((s) => !s.startsWith("SELECT"));
  assert.deepEqual(ddl, [
    'DROP DATABASE IF EXISTS "ds_golden_prev"',
    'ALTER DATABASE "ds_golden" RENAME TO "ds_golden_prev"',
    'ALTER DATABASE "ds_golden_next" RENAME TO "ds_golden"',
  ]);
});

test("the first build has nothing to rotate and still publishes", () => {
  const statements = renameCycleStatements(templateDatabaseNames(), {
    hasCurrent: false,
  });
  const ddl = statements.filter((s) => !s.startsWith("SELECT"));
  assert.deepEqual(ddl, [
    'DROP DATABASE IF EXISTS "ds_golden_prev"',
    'ALTER DATABASE "ds_golden_next" RENAME TO "ds_golden"',
  ]);
});

test("every rename is preceded by a disconnect of that database", () => {
  const statements = renameCycleStatements(templateDatabaseNames());
  for (const [index, statement] of statements.entries()) {
    if (!statement.startsWith("ALTER DATABASE")) continue;
    const name = statement.match(/^ALTER DATABASE "([^"]+)"/)[1];
    assert.equal(statements[index - 1], terminateBackendsStatement(name));
  }
});

test("the migrate is the same entry point the api image runs", () => {
  const [migrate, seed] = buildCommands("postgres://x/ds_golden_next");
  assert.deepEqual(migrate.args, [
    "--filter",
    "@ds/api",
    "run",
    "drizzle:migrate:ci",
  ]);
  assert.deepEqual(seed.args, ["--filter", "@ds/db", "run", "seed:golden"]);
  for (const command of [migrate, seed]) {
    assert.equal(command.env.DATABASE_URL, "postgres://x/ds_golden_next");
  }
});

test("the plan runs prepare → fill → publish", async () => {
  const plan = planGoldenDbBuild({ adminUrl: ADMIN_URL });
  const trace = [];
  await runGoldenDbBuild(plan, {
    sql: (statement) => {
      trace.push(`sql:${statement.slice(0, 24)}`);
      return Promise.resolve();
    },
    run: (command) => {
      trace.push(`run:${command.label}`);
      return Promise.resolve();
    },
  });
  const phases = trace.map((entry) =>
    entry.startsWith("run:") ? "fill" : "sql",
  );
  const firstFill = phases.indexOf("fill");
  const lastFill = phases.lastIndexOf("fill");
  assert.ok(firstFill > 0, "prepare statements run before the fill");
  assert.ok(
    lastFill < phases.length - 1,
    "publish statements run after the fill",
  );
  assert.deepEqual(trace.slice(firstFill, lastFill + 1), [
    "run:migrate",
    "run:seed:golden",
  ]);
});

test("a failed fill leaves the live template untouched", async () => {
  const plan = planGoldenDbBuild({ adminUrl: ADMIN_URL });
  const executed = [];
  await assert.rejects(
    runGoldenDbBuild(plan, {
      sql: (statement) => {
        executed.push(statement);
        return Promise.resolve();
      },
      run: () => Promise.reject(new Error("migration failed")),
    }),
    /migration failed/,
  );
  // The only DDL that ran is the preparation of the scratch database.
  for (const statement of executed) {
    assert.doesNotMatch(statement, /ALTER DATABASE/);
    assert.doesNotMatch(statement, /DROP DATABASE IF EXISTS "ds_golden_prev"/);
  }
});

test("argument parsing accepts only the two documented flags", () => {
  assert.deepEqual(parseArgs([]), { base: "ds_golden", dryRun: false });
  assert.deepEqual(parseArgs(["--dry-run"]), {
    base: "ds_golden",
    dryRun: true,
  });
  assert.deepEqual(parseArgs(["--base", "ds_golden_ci"]), {
    base: "ds_golden_ci",
    dryRun: false,
  });
  assert.throws(() => parseArgs(["--base"]), GoldenDbError);
  assert.throws(() => parseArgs(["--wipe-prod"]), GoldenDbError);
  assert.throws(() => parseArgs(["--base", 'x"; DROP']), GoldenDbError);
});
