// tools/gh/create-issue.test.mjs — unit checks for the PURE, side-effect-free
// helpers of create-issue.mjs (#1137 field gates + #1009 provenance gate). No
// `gh` is spawned: main() is guarded behind the direct-invocation check, so
// importing the module runs no I/O. Platform-agnostic — no drive-letter or
// path literals.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KIND_LABELS,
  SOURCE_LABELS,
  FALLBACK_MILESTONE,
  collectLabels,
  collectSourceLabels,
  collectKindLabels,
  kindLabelError,
  sourceLabelError,
  hasMilestone,
  milestoneError,
  deriveType,
  hasTypeFlag,
  ensureTypeFlag,
  hasAssignee,
  ensureAssigneeFlag,
} from "./create-issue.mjs";

// ── collectLabels: every flag form + comma lists ────────────────────────────
test("collectLabels handles --label, --label=, -l, and comma lists", () => {
  assert.deepEqual(collectLabels(["--label", "tooling"]), ["tooling"]);
  assert.deepEqual(collectLabels(["--label=tooling"]), ["tooling"]);
  assert.deepEqual(collectLabels(["-l", "bug"]), ["bug"]);
  assert.deepEqual(collectLabels(["--label", "a,b , c"]), ["a", "b", "c"]);
  assert.deepEqual(
    collectLabels(["--label", "source:agent", "--label=tooling", "-l", "feature:003-x"]),
    ["source:agent", "tooling", "feature:003-x"],
  );
  assert.deepEqual(collectLabels([]), []);
  assert.deepEqual(collectLabels(undefined), []);
  // A dangling --label with no value is ignored, not a crash.
  assert.deepEqual(collectLabels(["--label"]), []);
});

// ── source labels (#1009 regression) ────────────────────────────────────────
test("collectSourceLabels filters to source:* only", () => {
  assert.deepEqual(
    collectSourceLabels(["--label", "source:agent", "--label", "tooling"]),
    ["source:agent"],
  );
  assert.deepEqual(collectSourceLabels(["--label", "tooling"]), []);
});

test("sourceLabelError enforces exactly one known source label", () => {
  assert.match(sourceLabelError(["--label", "tooling"]), /exactly ONE/);
  assert.equal(
    sourceLabelError(["--label", "source:agent", "--label", "tooling"]),
    null,
  );
  assert.match(
    sourceLabelError(["--label", "source:agent", "--label", "source:spec"]),
    /exactly ONE source:\* label is allowed/,
  );
  assert.match(
    sourceLabelError(["--label", "source:bogus"]),
    /unknown source label/,
  );
  for (const s of SOURCE_LABELS) {
    assert.equal(sourceLabelError(["--label", s]), null);
  }
});

// ── kind labels (#1137) ─────────────────────────────────────────────────────
test("collectKindLabels ignores non-kind labels across all flag forms", () => {
  assert.deepEqual(
    collectKindLabels([
      "--label",
      "source:agent",
      "--label=tooling",
      "-l",
      "feature:003-x",
      "--label",
      "agent-ready",
    ]),
    ["tooling"],
  );
  assert.deepEqual(collectKindLabels(["--label", "bug,source:owner"]), ["bug"]);
});

test("kindLabelError requires exactly one kind label", () => {
  assert.match(kindLabelError(["--label", "source:agent"]), /exactly ONE kind label/);
  assert.match(kindLabelError([]), /exactly ONE kind label/);
  assert.match(
    kindLabelError(["--label", "bug", "--label", "chore"]),
    /exactly ONE kind label is allowed/,
  );
  for (const k of KIND_LABELS) {
    assert.equal(kindLabelError(["--label", k]), null);
  }
  // Extra non-kind labels alongside exactly one kind are fine.
  assert.equal(
    kindLabelError(["--label", "tooling", "--label", "source:agent", "--label", "agent-ready"]),
    null,
  );
});

// ── milestone (#1137) ───────────────────────────────────────────────────────
test("hasMilestone detects every flag form", () => {
  assert.equal(hasMilestone(["--milestone", "Platform ops & hardening"]), true);
  assert.equal(hasMilestone(["--milestone=Auth foundations v1"]), true);
  assert.equal(hasMilestone(["-m", "Platform ops & hardening"]), true);
  assert.equal(hasMilestone(["--label", "tooling"]), false);
  assert.equal(hasMilestone([]), false);
});

test("milestoneError names the standing fallback when absent", () => {
  const err = milestoneError(["--label", "tooling"]);
  assert.match(err, /needs a milestone/);
  assert.ok(err.includes(FALLBACK_MILESTONE));
  assert.equal(milestoneError(["-m", "Platform ops & hardening"]), null);
});

// ── type derivation + auto-append (#1137) ───────────────────────────────────
test("deriveType maps kind label to org Issue Type", () => {
  assert.equal(deriveType("bug"), "Bug");
  assert.equal(deriveType("feature"), "Feature");
  assert.equal(deriveType("chore"), "Task");
  assert.equal(deriveType("refactor"), "Task");
  assert.equal(deriveType("docs"), "Task");
  assert.equal(deriveType("tooling"), "Task");
});

test("ensureTypeFlag appends the derived type only when none is passed", () => {
  assert.deepEqual(ensureTypeFlag(["--label", "bug"]), [
    "--label",
    "bug",
    "--type",
    "Bug",
  ]);
  assert.deepEqual(ensureTypeFlag(["--label", "tooling"]), [
    "--label",
    "tooling",
    "--type",
    "Task",
  ]);
  // An explicit --type is never overridden.
  assert.equal(hasTypeFlag(["--type", "Bug"]), true);
  assert.deepEqual(ensureTypeFlag(["--label", "bug", "--type", "Feature"]), [
    "--label",
    "bug",
    "--type",
    "Feature",
  ]);
  assert.deepEqual(ensureTypeFlag(["--label", "bug", "--type=Feature"]), [
    "--label",
    "bug",
    "--type=Feature",
  ]);
  // Returns a fresh array (no in-place mutation of the caller's argv).
  const argv = ["--label", "docs"];
  const out = ensureTypeFlag(argv);
  assert.notEqual(out, argv);
  assert.deepEqual(argv, ["--label", "docs"]);
});

// ── assignee default (#1137) ────────────────────────────────────────────────
test("ensureAssigneeFlag defaults to @me only when none is passed", () => {
  assert.deepEqual(ensureAssigneeFlag(["--label", "bug"]), [
    "--label",
    "bug",
    "--assignee",
    "@me",
  ]);
  assert.equal(hasAssignee(["--assignee", "someone"]), true);
  assert.equal(hasAssignee(["-a", "someone"]), true);
  assert.equal(hasAssignee(["--assignee=someone"]), true);
  assert.deepEqual(ensureAssigneeFlag(["-a", "someone"]), ["-a", "someone"]);
  assert.deepEqual(ensureAssigneeFlag(["--assignee", "x"]), ["--assignee", "x"]);
});
