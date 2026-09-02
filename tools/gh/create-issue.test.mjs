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
  TRACK_LABELS,
  collectTrackLabels,
  trackLabelError,
  sourceLabelError,
  hasMilestone,
  milestoneError,
  deriveType,
  hasTypeFlag,
  ensureTypeFlag,
  hasAssignee,
  ensureAssigneeFlag,
  partitionArgs,
  titleValue,
  milestoneValue,
  epicMilestoneError,
  earsParentError,
  ensureRoadmapLabel,
  roadmapLabelError,
  milestoneConflictError,
  buildSubIssueLinkArgs,
} from "./create-issue.mjs";
import { EARS_KIND_LABEL, ROADMAP_LABEL } from "./lib/roadmap-taxonomy.mjs";

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

// ── track label (#1583) ─────────────────────────────────────────────────────
test("collectTrackLabels picks only track:* values", () => {
  assert.deepEqual(
    collectTrackLabels(["--label", "docs,track:doctor", "--label", "source:agent"]),
    ["track:doctor"],
  );
  assert.deepEqual(collectTrackLabels(["--label", "docs"]), []);
});

test("trackLabelError requires exactly one known track label", () => {
  assert.match(trackLabelError([]), /exactly ONE track label/);
  assert.match(trackLabelError(["--label", "docs"]), /exactly ONE track label/);
  assert.match(
    trackLabelError(["--label", "track:academy", "--label", "track:doctor"]),
    /exactly ONE track:\* label is allowed/,
  );
  assert.match(trackLabelError(["--label", "track:showcase"]), /unknown track label/);
  for (const t of TRACK_LABELS) {
    assert.equal(trackLabelError(["--label", t]), null);
  }
  // Extra non-track labels alongside exactly one track are fine.
  assert.equal(
    trackLabelError(["--label", "track:platform", "--label", "docs", "--label", "source:agent"]),
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

// ── --parent control flag + roadmap taxonomy gates (#1729) ──────────────────
test("partitionArgs consumes --parent without forwarding it to gh", () => {
  const both = partitionArgs(["--no-todo", "--parent", "42", "--title", "x"]);
  assert.equal(both.setTodo, false);
  assert.equal(both.parent, 42);
  assert.equal(both.parentError, null);
  assert.deepEqual(both.passthrough, ["--title", "x"]);
  assert.equal(partitionArgs(["--parent=42"]).parent, 42);
  assert.equal(partitionArgs(["--parent", "#42"]).parent, 42);
  // Absent → null, and the passthrough is untouched.
  const none = partitionArgs(["--title", "x", "--label", "bug"]);
  assert.equal(none.parent, null);
  assert.deepEqual(none.passthrough, ["--title", "x", "--label", "bug"]);
  assert.deepEqual(partitionArgs([]).passthrough, []);
});

test("partitionArgs reports a malformed --parent instead of silently dropping it", () => {
  for (const bad of ["abc", "0", "-3", ""]) {
    const p = partitionArgs(["--parent", bad]);
    assert.equal(p.parent, null);
    assert.match(p.parentError, /positive Issue number/);
  }
});

test("titleValue / milestoneValue read every flag form", () => {
  assert.equal(titleValue(["--title", "epic: x"]), "epic: x");
  assert.equal(titleValue(["--title=epic: x"]), "epic: x");
  assert.equal(titleValue(["-t", "epic: x"]), "epic: x");
  assert.equal(titleValue(["--label", "bug"]), "");
  assert.equal(milestoneValue(["--milestone", "R1"]), "R1");
  assert.equal(milestoneValue(["--milestone=R1"]), "R1");
  assert.equal(milestoneValue(["-m", "R1"]), "R1");
  assert.equal(milestoneValue(["--label", "bug"]), null);
});

test("milestoneError exempts an epic title and an inherited --parent", () => {
  // Epic: no milestone needed.
  assert.equal(milestoneError(["--title", "epic: academy roadmap"]), null);
  // Sub-issue: inherited from the parent.
  assert.equal(milestoneError(["--title", "[012] EARS-1: x"], { parent: 42 }), null);
  // Everything else still needs one.
  assert.match(milestoneError(["--title", "[012] EARS-1: x"]), /needs a milestone/);
});

test("epicMilestoneError rejects a milestone on an epic container", () => {
  assert.match(
    epicMilestoneError(["--title", "epic: academy roadmap", "-m", "Академия R1 — Архив записей"]),
    /must NOT carry a milestone/,
  );
  assert.equal(epicMilestoneError(["--title", "epic: academy roadmap"]), null);
  // A non-epic title with a milestone is untouched by this gate.
  assert.equal(epicMilestoneError(["--title", "[Академия][012] x", "-m", "R1"]), null);
});

test("earsParentError requires --parent for a kind:ears-handler Issue", () => {
  assert.match(
    earsParentError(["--label", EARS_KIND_LABEL, "--label", "feature"], null),
    /needs --parent/,
  );
  assert.equal(earsParentError(["--label", EARS_KIND_LABEL], 42), null);
  // A non-EARS Issue never needs a parent.
  assert.equal(earsParentError(["--label", "chore"], null), null);
});

test("milestoneConflictError fails closed on a child/parent milestone divergence", () => {
  assert.match(
    milestoneConflictError("Витрина R1 — MVP витрины", "Академия R1 — Архив записей", 42),
    /conflicts with parent #42/,
  );
  assert.equal(milestoneConflictError("R1", "R1", 42), null);
  // No milestone passed → inheritance, not a conflict.
  assert.equal(milestoneConflictError(null, "R1", 42), null);
  // Parent has none → nothing to diff against (main() dies separately).
  assert.equal(milestoneConflictError("R1", null, 42), null);
});

test("buildSubIssueLinkArgs targets the REST sub_issues endpoint with the child DB id", () => {
  assert.deepEqual(buildSubIssueLinkArgs(42, 9876543), [
    "api",
    "--method",
    "POST",
    "repos/doctor-school/ds-platform/issues/42/sub_issues",
    "-F",
    "sub_issue_id=9876543",
  ]);
});

test("roadmapLabelError rejects a hand-passed roadmap label off the roadmap levels", () => {
  // Owned levels: the label is allowed (and normally appended, not typed).
  assert.equal(
    roadmapLabelError(["--title", "[Академия][012] Archive", "--label", ROADMAP_LABEL]),
    null,
  );
  assert.equal(
    roadmapLabelError(["--title", "gate: Академия R1 — Архив", "--label", ROADMAP_LABEL]),
    null,
  );
  // Not passed at all → nothing to gate.
  assert.equal(roadmapLabelError(["--title", "epic: academy", "--label", "feature"]), null);
  // Passed on a level that does not own it → fail closed.
  for (const title of ["epic: academy", "Refactor the deploy script"]) {
    const err = roadmapLabelError(["--title", title, `--label=${ROADMAP_LABEL}`]);
    assert.match(err ?? "", /tooling-owned/);
  }
  const earsErr = roadmapLabelError([
    "--title",
    "[012] EARS-3: x",
    "-l",
    `${EARS_KIND_LABEL},${ROADMAP_LABEL}`,
  ]);
  assert.match(earsErr ?? "", /ears-task/);
});

test("ensureRoadmapLabel appends the label only on a roadmap level, never twice", () => {
  assert.deepEqual(
    ensureRoadmapLabel(["--title", "[Витрина][018] Feed", "--label", "feature"]),
    ["--title", "[Витрина][018] Feed", "--label", "feature", "--label", ROADMAP_LABEL],
  );
  assert.deepEqual(
    ensureRoadmapLabel(["--title", "gate: Витрина R1 — Лента", "--label", "chore"]),
    ["--title", "gate: Витрина R1 — Лента", "--label", "chore", "--label", ROADMAP_LABEL],
  );
  // Already present → untouched.
  const passed = ["--title", "[Академия][012] Archive", "--label", ROADMAP_LABEL];
  assert.deepEqual(ensureRoadmapLabel(passed), passed);
  // Non-roadmap levels stay bare.
  for (const args of [
    ["--title", "epic: academy", "--label", "feature"],
    ["--title", "Refactor the deploy script", "--label", "tooling"],
    ["--title", "[012] EARS-3: x", "--label", EARS_KIND_LABEL],
  ]) {
    assert.deepEqual(ensureRoadmapLabel(args), args);
  }
});
