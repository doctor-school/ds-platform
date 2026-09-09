import assert from "node:assert/strict";
import test from "node:test";
import {
  namespace,
  auditedRunner,
  assertAbsent,
  databasePlan,
  bootstrapRestoreScript,
  stopOwnedSession,
  validateExtensions,
} from "./pg18-rehearsal.mjs";

test("EARS-7: exact extension contract allows tested citext transition and rejects unknown drift", () => {
  const extensions = {
    citext: "1.6",
    pg_partman: "5.5.0",
    pg_trgm: "1.6",
    plpgsql: "1.0",
    vector: "0.8.6",
  };
  validateExtensions(17, extensions);
  validateExtensions(18, { ...extensions, citext: "1.8" });
  assert.throws(() => validateExtensions(18, extensions));
  assert.throws(() =>
    validateExtensions(18, { ...extensions, citext: "1.8", vector: "0.9.0" }),
  );
  assert.throws(() => validateExtensions(17, {}));
});

test("EARS-6: rejected re-entry cannot stop an earlier run, cleanup uses only created IDs", async () => {
  await stopOwnedSession([], () => assert.fail("foreign stop"));
  const stopped = [];
  await stopOwnedSession(["owned"], async (ids) => stopped.push(...ids));
  assert.deepEqual(stopped, ["owned"]);
});

test("EARS-5: bootstrap reconciliation removes only its exact CREATE and refuses ambiguity", () => {
  const script = bootstrapRestoreScript();
  assert.match(script, /grep -cx 'CREATE ROLE source_admin;'/);
  assert.match(script, /test.*-eq 1/);
  assert.match(script, /ON_ERROR_STOP=1/);
  assert.doesNotMatch(script, /target_admin/);
});

test("EARS-1: names cannot address shared or production resources", () => {
  assert.equal(namespace("run01"), "ds-pg18-2135-run01");
  for (const bad of ["", "../prod", "foo;id", "UPPER", "a".repeat(33)]) {
    assert.throws(() => namespace(bad));
  }
});

test("EARS-2: an existing resource stops initialization including interrupted re-entry", async () => {
  await assert.rejects(
    assertAbsent(["volume"], async () => "existing"),
    /already exists/,
  );
  await assertAbsent(["volume"], async () => "");
});

test("EARS-3: audit persistence precedes effects and audit failure prevents execution", async () => {
  const events = [];
  const run = auditedRunner({
    audit: (row) => events.push(row.command),
    execute: () => events.push("executed"),
  });
  await run(["docker", "version"]);
  assert.deepEqual(events, [["docker", "version"], "executed"]);
  const denied = auditedRunner({
    audit: () => {
      throw new Error("disk full");
    },
    execute: () => assert.fail("must not execute"),
  });
  await assert.rejects(denied(["docker", "run"]), /disk full/);
});

test("EARS-4: every non-template database is restored and existing postgres is reconciled explicitly", () => {
  const plan = databasePlan([
    "postgres",
    "ds_prod",
    "zitadel",
    "glitchtip",
    "additional_db",
  ]);
  assert.equal(plan.length, 5);
  assert.equal(plan[0].create, false);
  assert.ok(plan.slice(1).every((db) => db.create));
  assert.throws(() => databasePlan(["ds_prod"]), /postgres/);
  assert.throws(() => databasePlan(["postgres", "postgres"]), /duplicate/);
  assert.throws(() => databasePlan(["postgres", "unsafe;name"]), /database/);
});
