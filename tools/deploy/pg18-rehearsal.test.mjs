import assert from "node:assert/strict";
import test from "node:test";
import {
  namespace,
  auditedRunner,
  assertAbsent,
  databasePlan,
} from "./pg18-rehearsal.mjs";

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
