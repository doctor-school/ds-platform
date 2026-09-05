// tools/deploy/rollback-floor.test.mjs — EARS-24 rollback compatibility floor,
// re-pointed onto migration 0036 (Issue #1607). Pure-seam tests: no ssh, no
// psql, no provider call. Every I/O boundary of the guard is injected, so the
// whole decision table runs deterministically on any platform (CI is Linux — no
// drive-letter literals).
//
// Run: pnpm test:tools   (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertRollbackAllowed,
  CUTOVER_MIGRATION_PATH,
  evaluateRollbackFloor,
  makeGitCutoverMigrationProbe,
  RollbackFloorError,
} from "./rollback-floor.mjs";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";

// --- evaluateRollbackFloor (the pure decision table) -----------------------

test("EARS-24: a prod DB that still has event_speakers has no floor — allowed", () => {
  const verdict = evaluateRollbackFloor({
    legacyTablePresent: true,
    targetCarriesCutover: false,
    sha: SHA,
  });
  assert.deepEqual(verdict, { ok: true, reason: "cutover-not-applied" });
});

test("EARS-24: an unanswerable prod probe is UNREADABLE, never 'no floor'", () => {
  const verdict = evaluateRollbackFloor({
    legacyTablePresent: null,
    targetCarriesCutover: true,
    sha: SHA,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "FLOOR_UNREADABLE");
});

test("EARS-24: post-cutover prod refuses a target whose tree lacks migration 0036", () => {
  const verdict = evaluateRollbackFloor({
    legacyTablePresent: false,
    targetCarriesCutover: false,
    sha: SHA,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "TARGET_BELOW_FLOOR");
  assert.match(verdict.message, /0036_speaker_cutover\.sql/);
});

test("EARS-24: post-cutover prod refuses a target whose tree cannot be inspected", () => {
  const verdict = evaluateRollbackFloor({
    legacyTablePresent: false,
    targetCarriesCutover: null,
    sha: SHA,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "TARGET_STATE_UNRESOLVED");
});

test("EARS-24: post-cutover prod allows a target that carries migration 0036", () => {
  const verdict = evaluateRollbackFloor({
    legacyTablePresent: false,
    targetCarriesCutover: true,
    sha: SHA,
  });
  assert.deepEqual(verdict, { ok: true, reason: "at-or-above-floor" });
});

// --- assertRollbackAllowed (the composed guard) ---------------------------

test("EARS-24: the guard throws TARGET_BELOW_FLOOR on a pre-cutover target", async () => {
  await assert.rejects(
    assertRollbackAllowed({
      sha: SHA,
      readProdCutoverState: async () => ({ legacyTablePresent: false }),
      targetCarriesMigration: async () => false,
    }),
    (err) =>
      err instanceof RollbackFloorError && err.code === "TARGET_BELOW_FLOOR",
  );
});

test("EARS-24: a throwing prod reader is FLOOR_UNREADABLE, not a silent allow", async () => {
  await assert.rejects(
    assertRollbackAllowed({
      sha: SHA,
      readProdCutoverState: async () => {
        throw new Error("ssh: connection refused");
      },
      targetCarriesMigration: async () => true,
    }),
    (err) =>
      err instanceof RollbackFloorError && err.code === "FLOOR_UNREADABLE",
  );
});

test("EARS-24: a throwing target probe is TARGET_STATE_UNRESOLVED", async () => {
  await assert.rejects(
    assertRollbackAllowed({
      sha: SHA,
      readProdCutoverState: async () => ({ legacyTablePresent: false }),
      targetCarriesMigration: async () => {
        throw new Error("unknown revision");
      },
    }),
    (err) =>
      err instanceof RollbackFloorError &&
      err.code === "TARGET_STATE_UNRESOLVED",
  );
});

test("EARS-24: a pre-cutover prod DB short-circuits before the git probe", async () => {
  let probed = false;
  const verdict = await assertRollbackAllowed({
    sha: SHA,
    readProdCutoverState: async () => ({ legacyTablePresent: true }),
    targetCarriesMigration: async () => {
      probed = true;
      return false;
    },
  });
  assert.deepEqual(verdict, { ok: true, reason: "cutover-not-applied" });
  assert.equal(probed, false);
});

test("EARS-24: the guard allows a post-cutover target end to end", async () => {
  const verdict = await assertRollbackAllowed({
    sha: SHA,
    readProdCutoverState: async () => ({ legacyTablePresent: false }),
    targetCarriesMigration: async () => true,
  });
  assert.deepEqual(verdict, { ok: true, reason: "at-or-above-floor" });
});

// --- makeGitCutoverMigrationProbe (the git seam) --------------------------

test("EARS-24: the git probe reads `cat-file -e` on the migration path", async () => {
  const calls = [];
  const probe = makeGitCutoverMigrationProbe((cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return "";
  });
  assert.equal(await probe(SHA), true);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /rev-parse --verify/);
  assert.equal(calls[1], `git cat-file -e ${SHA}:${CUTOVER_MIGRATION_PATH}`);
});

test("EARS-24: a missing blob is a clean `false`, an unknown commit still throws", async () => {
  const probe = makeGitCutoverMigrationProbe((_cmd, args) => {
    if (args[0] === "cat-file") throw new Error("not found");
    return "";
  });
  assert.equal(await probe(SHA), false);

  const failing = makeGitCutoverMigrationProbe(() => {
    throw new Error("unknown revision");
  });
  await assert.rejects(failing(SHA));
});
