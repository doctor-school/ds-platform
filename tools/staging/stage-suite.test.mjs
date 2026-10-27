import test from "node:test";
import assert from "node:assert/strict";

import {
  probeStageSuite,
  renderStageSuiteSection,
  stageSuiteLandWarning,
  stageSuiteWarnings,
} from "./stage-suite.mjs";

const NOW = Date.parse("2026-10-22T18:00:00Z");
const HOUR = 3600_000;

/** Newest-first main commits `c0..c<n-1>`, `c0` committed `ageH[0]` hours ago. */
function commits(ageH) {
  return ageH.map((h, i) => ({
    sha: `c${i}x`.padEnd(40, "0"),
    subject: `commit ${i}`,
    date: new Date(NOW - h * HOUR).toISOString(),
  }));
}

/** A faked status reader: `states[i]` is commit i's `stage-suite` state (null = not posted). */
function reader(states) {
  const calls = [];
  const readState = async (sha) => {
    calls.push(sha);
    const i = Number(/^c(\d+)x/.exec(sha)[1]);
    return states[i] ?? null;
  };
  return { readState, calls };
}

test("green newest: no warning, the newest green is the newest commit, the walk stops there", async () => {
  const { readState, calls } = reader(["success", "failure"]);
  const s = await probeStageSuite({
    listCommits: async () => commits([0.2, 1]),
    readState,
    now: NOW,
  });
  assert.equal(s.newest.state, "success");
  assert.equal(s.newestGreen.sha, s.newest.sha);
  assert.equal(s.redStreak, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(stageSuiteWarnings(s), []);
  assert.equal(stageSuiteLandWarning(s), null);
});

test("red streak (2026-10-22 shape): names the first red commit and the newest green", async () => {
  const { readState } = reader([
    "failure",
    "error",
    null,
    "failure",
    "success",
  ]);
  const s = await probeStageSuite({
    listCommits: async () => commits([0.5, 1, 2, 3, 4]),
    readState,
    now: NOW,
  });
  assert.equal(s.redStreak.count, 3);
  assert.equal(s.redStreak.first.sha.slice(0, 2), "c3");
  assert.equal(s.newestGreen.sha.slice(0, 2), "c4");
  const rows = stageSuiteWarnings(s);
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /RED since c3x00000 "commit 3"/);
  assert.match(rows[0].message, /newest green c4x00000/);
  const land = stageSuiteLandWarning(s);
  assert.match(
    land,
    /^WARNING: main's newest stage-suite is RED since c3x00000/,
  );
});

test("pending newest over a red verdict: still red for both bootstrap and pr:land", async () => {
  const { readState } = reader(["pending", "failure", "success"]);
  const s = await probeStageSuite({
    listCommits: async () => commits([0.1, 1, 2]),
    readState,
    now: NOW,
  });
  assert.equal(s.newest.state, "pending");
  assert.equal(s.redStreak.first.sha.slice(0, 2), "c1");
  assert.equal(stageSuiteWarnings(s).length, 1);
  assert.notEqual(stageSuiteLandWarning(s), null);
});

test("newest pending or absent for > 1h: a Warnings row; under 1h: none", async () => {
  for (const state of ["pending", null]) {
    const old = await probeStageSuite({
      listCommits: async () => commits([1.5, 2]),
      readState: reader([state, "success"]).readState,
      now: NOW,
    });
    const rows = stageSuiteWarnings(old);
    assert.equal(rows.length, 1);
    assert.match(rows[0].message, state ? /pending/ : /not posted/);
    assert.equal(stageSuiteLandWarning(old), null);

    const fresh = await probeStageSuite({
      listCommits: async () => commits([0.5, 2]),
      readState: reader([state, "success"]).readState,
      now: NOW,
    });
    assert.deepEqual(stageSuiteWarnings(fresh), []);
  }
});

test("the walk is bounded and reports a streak older than the bound", async () => {
  const { readState, calls } = reader(Array(30).fill("failure"));
  const s = await probeStageSuite({
    listCommits: async () =>
      commits(Array.from({ length: 30 }, (_, i) => i + 1)),
    readState,
    now: NOW,
    limit: 5,
  });
  assert.equal(calls.length, 5);
  assert.equal(s.newestGreen, null);
  assert.equal(s.redStreak.truncated, true);
  assert.match(
    stageSuiteWarnings(s)[0].message,
    /no green in the last 5 main commits/,
  );
});

test("a failed fetch is a Warnings row and an unknown section, never a throw", async () => {
  const s = await probeStageSuite({
    listCommits: async () => {
      throw new Error("gh: HTTP 502\nbody");
    },
    readState: async () => "success",
    now: NOW,
  });
  assert.equal(s.error, "gh: HTTP 502");
  assert.deepEqual(stageSuiteWarnings(s), [
    { source: "stage-suite on main", message: "fetch failed — gh: HTTP 502" },
  ]);
  assert.deepEqual(renderStageSuiteSection(s), ["(unknown — see Warnings)"]);
  assert.match(stageSuiteLandWarning(s), /could not be read/);

  const partial = await probeStageSuite({
    listCommits: async () => commits([0.1, 1]),
    readState: async () => {
      throw new Error("rate limited");
    },
    now: NOW,
  });
  assert.equal(partial.error, "rate limited");
});

test("section rows: newest state with age and the newest green", async () => {
  const s = await probeStageSuite({
    listCommits: async () => commits([0.5, 3]),
    readState: reader(["failure", "success"]).readState,
    now: NOW,
  });
  assert.deepEqual(renderStageSuiteSection(s), [
    "- newest main c0x00000 (30m ago): failure",
    "- newest green: c1x00000 (3h ago)",
  ]);
});
