// tools/deploy/rollback-floor.test.mjs — EARS-24 rollback compatibility floor
// (Issue #1633). Pure-seam tests: no ssh, no psql, no provider call. Every
// I/O boundary of the guard is injected, so the whole decision table runs
// deterministically on any platform (CI is Linux — no drive-letter literals).
//
// Run: pnpm test:tools   (node --test)

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertRollbackAllowed,
  evaluateRollbackFloor,
  parseFloorRow,
  releaseOrdinalFor,
} from "./rollback-floor.mjs";

// --- parseFloorRow (psql -At output → floor marker) ------------------------

test("parseFloorRow reads a source_closed marker with its SHA/ordinal pair", () => {
  const row = parseFloorRow(
    "source_closed|expandsha0000000000000000000000000000000|42|3\n",
  );
  assert.deepEqual(row, {
    phase: "source_closed",
    minimumCompatibleReleaseSha: "expandsha0000000000000000000000000000000",
    minimumCompatibleReleaseOrdinal: 42,
    version: 3,
  });
});

test("parseFloorRow reads a review_open marker with no floor recorded yet", () => {
  const row = parseFloorRow("review_open|||1\n");
  assert.deepEqual(row, {
    phase: "review_open",
    minimumCompatibleReleaseSha: null,
    minimumCompatibleReleaseOrdinal: null,
    version: 1,
  });
});

test("parseFloorRow returns null for empty output (singleton row absent)", () => {
  assert.equal(parseFloorRow(""), null);
  assert.equal(parseFloorRow("   \n"), null);
});

test("parseFloorRow returns null for an unparseable line", () => {
  assert.equal(parseFloorRow("source_closed\n"), null);
  assert.equal(parseFloorRow("ERROR:  relation does not exist\n"), null);
});

test("parseFloorRow rejects more than one row — the SSOT is a singleton", () => {
  assert.equal(parseFloorRow("review_open|||1\nsource_closed|abc|1|2\n"), null);
});

// --- releaseOrdinalFor (authoritative release ordinal) ---------------------

const TAGS = [
  { tag: "release-2026.08.30-1", sha: "a".repeat(40) },
  { tag: "release-2026.08.31-1", sha: "b".repeat(40) },
  { tag: "release-2026.08.31-2", sha: "c".repeat(40) },
  { tag: "release-2026.09.01-1", sha: "d".repeat(40) },
];

test("releaseOrdinalFor ranks releases chronologically, same-day ordinal breaking ties", () => {
  assert.equal(releaseOrdinalFor("a".repeat(40), TAGS), 1);
  assert.equal(releaseOrdinalFor("b".repeat(40), TAGS), 2);
  assert.equal(releaseOrdinalFor("c".repeat(40), TAGS), 3);
  assert.equal(releaseOrdinalFor("d".repeat(40), TAGS), 4);
});

test("releaseOrdinalFor is order-independent and ignores non-release tags", () => {
  const shuffled = [
    { tag: "v1.2.3", sha: "e".repeat(40) },
    TAGS[3],
    TAGS[0],
    { tag: "release-bad", sha: "f".repeat(40) },
    TAGS[2],
    TAGS[1],
  ];
  assert.equal(releaseOrdinalFor("d".repeat(40), shuffled), 4);
  assert.equal(releaseOrdinalFor("e".repeat(40), shuffled), null);
});

test("releaseOrdinalFor returns null for a SHA carrying no release tag", () => {
  assert.equal(releaseOrdinalFor("9".repeat(40), TAGS), null);
});

// --- evaluateRollbackFloor (the decision table) ----------------------------

const EXPAND_SHA = "b".repeat(40);
const PRE_EXPAND_SHA = "a".repeat(40);

/** source_closed marker whose floor is the 2026.08.31-1 release (ordinal 2). */
const CLOSED_FLOOR = {
  phase: "source_closed",
  minimumCompatibleReleaseSha: EXPAND_SHA,
  minimumCompatibleReleaseOrdinal: 2,
  version: 2,
};

test("EARS-24: a retained pre-expand rollback is rejected below the floor", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: CLOSED_FLOOR,
    floorShaOrdinal: 2,
    target: { sha: PRE_EXPAND_SHA, ordinal: 1 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "TARGET_BELOW_FLOOR");
  assert.match(verdict.message, /ordinal 1/);
  assert.match(verdict.message, /floor .*2/);
});

test("EARS-24: app-only rollback TO the expand image (at the floor) is allowed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: CLOSED_FLOOR,
    floorShaOrdinal: 2,
    target: { sha: EXPAND_SHA, ordinal: 2 },
  });
  assert.deepEqual(verdict, { ok: true, reason: "at-or-above-floor" });
});

test("EARS-24: rollback above the floor is allowed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: CLOSED_FLOOR,
    floorShaOrdinal: 2,
    target: { sha: "c".repeat(40), ordinal: 3 },
  });
  assert.equal(verdict.ok, true);
});

test("EARS-24: an unreadable marker fails closed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: null,
    floorShaOrdinal: null,
    target: { sha: EXPAND_SHA, ordinal: 2 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "FLOOR_UNREADABLE");
});

test("EARS-24: source_closed with a half-written floor pair fails closed", () => {
  for (const floor of [
    { ...CLOSED_FLOOR, minimumCompatibleReleaseSha: null },
    { ...CLOSED_FLOOR, minimumCompatibleReleaseOrdinal: null },
  ]) {
    const verdict = evaluateRollbackFloor({
      floorTablePresent: true,
      floor,
      floorShaOrdinal: 2,
      target: { sha: EXPAND_SHA, ordinal: 2 },
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "FLOOR_UNREADABLE");
  }
});

test("EARS-24: an unknown phase value fails closed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: { ...CLOSED_FLOOR, phase: "whatever" },
    floorShaOrdinal: 2,
    target: { sha: EXPAND_SHA, ordinal: 2 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "FLOOR_UNREADABLE");
});

test("EARS-24: disagreeing floor SHA/ordinal metadata fails closed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: CLOSED_FLOOR,
    // git says the floor SHA is release ordinal 5, the marker claims 2.
    floorShaOrdinal: 5,
    target: { sha: "c".repeat(40), ordinal: 9 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "FLOOR_METADATA_MISMATCH");
});

test("EARS-24: a floor SHA that carries no release tag fails closed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: CLOSED_FLOOR,
    floorShaOrdinal: null,
    target: { sha: "c".repeat(40), ordinal: 9 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "FLOOR_METADATA_MISMATCH");
});

test("EARS-24: an unresolvable target ordinal fails closed once a floor exists", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: CLOSED_FLOOR,
    floorShaOrdinal: 2,
    target: { sha: "9".repeat(40), ordinal: null },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "TARGET_ORDINAL_UNRESOLVED");
});

test("review_open with no floor recorded allows rollback and says so", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: {
      phase: "review_open",
      minimumCompatibleReleaseSha: null,
      minimumCompatibleReleaseOrdinal: null,
      version: 1,
    },
    floorShaOrdinal: null,
    target: { sha: PRE_EXPAND_SHA, ordinal: 1 },
  });
  assert.deepEqual(verdict, { ok: true, reason: "no-floor-recorded" });
});

test("review_open still enforces a floor left by an earlier closure", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: true,
    floor: { ...CLOSED_FLOOR, phase: "review_open" },
    floorShaOrdinal: 2,
    target: { sha: PRE_EXPAND_SHA, ordinal: 1 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "TARGET_BELOW_FLOOR");
});

test("a prod DB predating the cutover migration has no floor table and is allowed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: false,
    floor: null,
    floorShaOrdinal: null,
    target: { sha: PRE_EXPAND_SHA, ordinal: 1 },
  });
  assert.deepEqual(verdict, { ok: true, reason: "no-floor-table" });
});

test("an unknown floor-table presence (probe failed) fails closed", () => {
  const verdict = evaluateRollbackFloor({
    floorTablePresent: null,
    floor: null,
    floorShaOrdinal: null,
    target: { sha: PRE_EXPAND_SHA, ordinal: 1 },
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "FLOOR_UNREADABLE");
});

// --- assertRollbackAllowed (composed guard, injected I/O) ------------------

function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      readFloor: async () => {
        calls.push("readFloor");
        return { tablePresent: true, raw: `source_closed|${EXPAND_SHA}|2|2` };
      },
      listReleaseTags: async () => {
        calls.push("listReleaseTags");
        return TAGS;
      },
      ...overrides,
    },
  };
}

test("EARS-24: the guard reads the marker and resolves the ordinal BEFORE rejecting", async () => {
  const { calls, deps } = harness();
  await assert.rejects(
    () => assertRollbackAllowed({ sha: PRE_EXPAND_SHA, ...deps }),
    (err) => {
      assert.equal(err.code, "TARGET_BELOW_FLOOR");
      return true;
    },
  );
  assert.deepEqual(calls, ["readFloor", "listReleaseTags"]);
});

test("the guard resolves an at-floor target and returns its verdict", async () => {
  const { deps } = harness();
  const verdict = await assertRollbackAllowed({ sha: EXPAND_SHA, ...deps });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, "at-or-above-floor");
});

test("the guard fails closed when the marker read itself throws", async () => {
  const { deps } = harness({
    readFloor: async () => {
      throw new Error("ssh: connect to host ds-data-prod port 22: timed out");
    },
  });
  await assert.rejects(
    () => assertRollbackAllowed({ sha: EXPAND_SHA, ...deps }),
    (err) => {
      assert.equal(err.code, "FLOOR_UNREADABLE");
      assert.match(err.message, /timed out/);
      return true;
    },
  );
});

test("the guard fails closed when the release-tag listing throws", async () => {
  const { deps } = harness({
    listReleaseTags: async () => {
      throw new Error("git tag failed");
    },
  });
  await assert.rejects(
    () => assertRollbackAllowed({ sha: EXPAND_SHA, ...deps }),
    (err) => {
      assert.equal(err.code, "TARGET_ORDINAL_UNRESOLVED");
      return true;
    },
  );
});

test("the guard makes no provider mutation call — it only reads", async () => {
  const { calls, deps } = harness();
  await assertRollbackAllowed({ sha: EXPAND_SHA, ...deps });
  assert.ok(!calls.some((c) => /up|build|compose|deploy/i.test(c)));
});
