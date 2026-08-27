// tools/gh/sync-pr-track.test.mjs — unit checks for the PURE, side-effect-free
// helpers of sync-pr-track.mjs (#1600). No `gh` is spawned: main() is guarded
// behind the direct-invocation check, so importing the module runs no I/O.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRACK_LABELS,
  extractClosedIssues,
  trackLabelsOf,
  planTrackSync,
} from "./sync-pr-track.mjs";

test("TRACK_LABELS is the #1583 taxonomy", () => {
  assert.deepEqual(TRACK_LABELS, [
    "track:academy",
    "track:doctor",
    "track:platform",
  ]);
});

// ── extractClosedIssues — the auto-close keyword shape shared with
//    tools/lint/spec-link-lint.ts:44. ─────────────────────────────────────────

test("extractClosedIssues: every auto-close keyword form", () => {
  assert.deepEqual(extractClosedIssues("Closes #12"), [12]);
  assert.deepEqual(extractClosedIssues("closed #12"), [12]);
  assert.deepEqual(extractClosedIssues("Fixes #7"), [7]);
  assert.deepEqual(extractClosedIssues("fixed #7"), [7]);
  assert.deepEqual(extractClosedIssues("Resolves #9"), [9]);
  assert.deepEqual(extractClosedIssues("resolved #9"), [9]);
});

test("extractClosedIssues: dedupes and keeps every distinct Issue", () => {
  assert.deepEqual(
    extractClosedIssues("Closes #3\nFixes #4\nCloses #3"),
    [3, 4],
  );
});

test("extractClosedIssues: no keyword, empty body, bare ref → nothing", () => {
  assert.deepEqual(extractClosedIssues(""), []);
  assert.deepEqual(extractClosedIssues(undefined), []);
  assert.deepEqual(extractClosedIssues("Part of #55"), []);
  assert.deepEqual(extractClosedIssues("see #55 for context"), []);
});

// ── planTrackSync — the whole decision, as data. ────────────────────────────

const issue = (number, ...labels) => ({ number, labels });

test("planTrackSync: no linked Issue → none (bot PRs: Version Packages, Dependabot)", () => {
  const plan = planTrackSync({ prLabels: ["docs"], issues: [] });
  assert.equal(plan.action, "none");
});

test("planTrackSync: a hand-set track on a PR with no linked Issue is left alone", () => {
  // Nothing to contradict it with — never red on an unverifiable label.
  const plan = planTrackSync({ prLabels: ["track:doctor"], issues: [] });
  assert.equal(plan.action, "none");
});

test("planTrackSync: linked Issue carries no track (pre-#1583) → none", () => {
  const plan = planTrackSync({ prLabels: [], issues: [issue(900, "feature")] });
  assert.equal(plan.action, "none");
});

test("planTrackSync: one track on the Issue, absent on the PR → apply", () => {
  const plan = planTrackSync({
    prLabels: ["feature"],
    issues: [issue(1578, "feature", "track:doctor")],
  });
  assert.equal(plan.action, "apply");
  assert.equal(plan.label, "track:doctor");
});

test("planTrackSync: several linked Issues agreeing on one track → apply once", () => {
  const plan = planTrackSync({
    prLabels: [],
    issues: [issue(1, "track:academy"), issue(2, "track:academy")],
  });
  assert.equal(plan.action, "apply");
  assert.equal(plan.label, "track:academy");
});

test("planTrackSync: PR already carries the derived track → ok, no mutation", () => {
  const plan = planTrackSync({
    prLabels: ["feature", "track:academy"],
    issues: [issue(1590, "bug", "track:academy")],
  });
  assert.equal(plan.action, "ok");
});

test("planTrackSync: a hand-set track contradicting the Issue → conflict naming both", () => {
  const plan = planTrackSync({
    prLabels: ["track:academy"],
    issues: [issue(1578, "track:doctor")],
  });
  assert.equal(plan.action, "conflict");
  assert.match(plan.reason, /track:academy/);
  assert.match(plan.reason, /track:doctor/);
  assert.match(plan.reason, /#1578/);
});

test("planTrackSync: two track labels on the PR → conflict", () => {
  const plan = planTrackSync({
    prLabels: ["track:doctor", "track:platform"],
    issues: [issue(1578, "track:doctor")],
  });
  assert.equal(plan.action, "conflict");
});

test("planTrackSync: linked Issues disagreeing on the track → conflict, no guess", () => {
  const plan = planTrackSync({
    prLabels: [],
    issues: [issue(10, "track:academy"), issue(11, "track:doctor")],
  });
  assert.equal(plan.action, "conflict");
  assert.match(plan.reason, /#10/);
  assert.match(plan.reason, /#11/);
});

test("planTrackSync: an unknown track:* value on the Issue is not propagated", () => {
  // A typo'd label must never be copied onto the PR — it would spread a value
  // outside the #1583 taxonomy across the board.
  const plan = planTrackSync({
    prLabels: [],
    issues: [issue(12, "track:mobile")],
  });
  assert.equal(plan.action, "conflict");
  assert.match(plan.reason, /track:mobile/);
});

// ── trackLabelsOf ──────────────────────────────────────────────────────────

test("trackLabelsOf: filters to the track axis only", () => {
  assert.deepEqual(
    trackLabelsOf(["feature", "track:doctor", "feature:017-x", "source:spec"]),
    ["track:doctor"],
  );
  assert.deepEqual(trackLabelsOf([]), []);
});
