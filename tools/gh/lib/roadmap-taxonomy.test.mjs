// tools/gh/lib/roadmap-taxonomy.test.mjs — unit checks for the PURE roadmap
// taxonomy classifiers (#1729, spec §7.1). No I/O: the module is side-effect
// free, so importing it spawns nothing. Platform-agnostic (CI is Linux).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EARS_KIND_LABEL,
  classifyIssueTaxonomy,
  isEpicTitle,
  isReleaseGateTitle,
  featureTitlePrefix,
  milestoneTrack,
  ownsBoardDates,
  roadmapFindingsFor,
  roadmapHygiene,
  roadmapRuleCounts,
  formatRoadmapHygiene,
  roadmapHygieneWarnings,
  parseIssueBoardNode,
  boardDateValues,
} from "./roadmap-taxonomy.mjs";

// ── title shapes ────────────────────────────────────────────────────────────
test("isEpicTitle / isReleaseGateTitle match their prefixes, case-insensitively", () => {
  assert.equal(isEpicTitle("epic: academy roadmap"), true);
  assert.equal(isEpicTitle("Epic: academy roadmap"), true);
  assert.equal(isEpicTitle("  epic: padded"), true);
  assert.equal(isEpicTitle("[Академия][012] not an epic"), false);
  assert.equal(isEpicTitle(undefined), false);
  assert.equal(isReleaseGateTitle("gate: Академия R1 — Архив записей"), true);
  assert.equal(isReleaseGateTitle("gateway rework"), false);
});

test("featureTitlePrefix recognises both track prefixes only", () => {
  assert.equal(featureTitlePrefix("[Академия][012] Архив записей"), "[Академия]");
  assert.equal(featureTitlePrefix("[Витрина][017] MVP"), "[Витрина]");
  assert.equal(featureTitlePrefix("[012] EARS-3: something"), null);
  assert.equal(featureTitlePrefix("plain platform task"), null);
});

test("milestoneTrack maps the Russian milestone prefixes to track labels", () => {
  assert.equal(milestoneTrack("Академия R1 — Архив записей"), "track:academy");
  assert.equal(milestoneTrack("Академия · Позже"), "track:academy");
  assert.equal(milestoneTrack("Витрина R1 — MVP витрины"), "track:doctor");
  assert.equal(milestoneTrack("Platform ops & hardening"), null);
  assert.equal(milestoneTrack(null), null);
});

// ── taxonomy classification (spec §7.1 table) ───────────────────────────────
test("classifyIssueTaxonomy assigns each shape its kind, epic winning first", () => {
  assert.equal(classifyIssueTaxonomy({ title: "epic: academy" }), "epic");
  assert.equal(classifyIssueTaxonomy({ title: "gate: Витрина R1 — MVP витрины" }), "release-gate");
  assert.equal(
    classifyIssueTaxonomy({ title: "[012] EARS-3: x", labels: [EARS_KIND_LABEL] }),
    "ears-task",
  );
  assert.equal(classifyIssueTaxonomy({ title: "[Академия][012] Архив" }), "feature");
  assert.equal(classifyIssueTaxonomy({ title: "bump drizzle", labels: ["chore"] }), "platform-task");
  // The EARS label wins over a feature-shaped title (a mis-titled EARS task is
  // still an EARS task for the parent rule).
  assert.equal(
    classifyIssueTaxonomy({ title: "[Академия][012] x", labels: [EARS_KIND_LABEL] }),
    "ears-task",
  );
  assert.equal(classifyIssueTaxonomy(undefined), "platform-task");
});

test("ownsBoardDates is true only for feature-level work", () => {
  assert.equal(ownsBoardDates("feature"), true);
  assert.equal(ownsBoardDates("release-gate"), true);
  assert.equal(ownsBoardDates("ears-task"), false);
  assert.equal(ownsBoardDates("epic"), false);
  assert.equal(ownsBoardDates("platform-task"), false);
});

// ── rule (a): child milestone ≠ parent milestone ────────────────────────────
test("rule (a) fires only when the child's milestone differs from its parent's", () => {
  const base = {
    number: 10,
    title: "[012] EARS-1: x",
    labels: [EARS_KIND_LABEL],
    startDate: null,
    targetDate: null,
  };
  const mismatch = roadmapFindingsFor({
    ...base,
    milestone: "Витрина R1 — MVP витрины",
    parent: { number: 9, milestone: "Академия R1 — Архив записей" },
  });
  assert.deepEqual(
    mismatch.filter((f) => f.rule === "parent-milestone").length,
    1,
  );
  const inherited = roadmapFindingsFor({
    ...base,
    milestone: "Академия R1 — Архив записей",
    parent: { number: 9, milestone: "Академия R1 — Архив записей" },
  });
  assert.deepEqual(inherited.filter((f) => f.rule === "parent-milestone"), []);
  // An unset CHILD milestone under a milestoned parent is still a mismatch.
  const unset = roadmapFindingsFor({
    ...base,
    milestone: null,
    parent: { number: 9, milestone: "Академия R1 — Архив записей" },
  });
  assert.equal(unset.filter((f) => f.rule === "parent-milestone").length, 1);
  assert.match(unset[0].message, /\(unset\)/);
  // A parent with no milestone supplies nothing to compare against.
  assert.deepEqual(
    roadmapFindingsFor({ ...base, milestone: null, parent: { number: 9, milestone: null } })
      .filter((f) => f.rule === "parent-milestone"),
    [],
  );
});

// ── rule (b): feature-level Issue without Start/Target dates ────────────────
test("rule (b) fires for dateless features + gates only", () => {
  const feature = {
    number: 20,
    title: "[Академия][012] Архив",
    labels: ["track:academy"],
    milestone: "Академия R1 — Архив записей",
    parent: null,
  };
  const missingBoth = roadmapFindingsFor({ ...feature, startDate: null, targetDate: null });
  assert.equal(missingBoth.filter((f) => f.rule === "missing-dates").length, 1);
  assert.match(missingBoth[0].message, /Start date \+ Target date/);
  const missingOne = roadmapFindingsFor({
    ...feature,
    startDate: "2026-09-01",
    targetDate: null,
  });
  assert.match(
    missingOne.find((f) => f.rule === "missing-dates").message,
    /without Target date/,
  );
  assert.deepEqual(
    roadmapFindingsFor({ ...feature, startDate: "2026-09-01", targetDate: "2026-10-01" })
      .filter((f) => f.rule === "missing-dates"),
    [],
  );
  // A platform task is deliberately dateless — never flagged.
  assert.deepEqual(
    roadmapFindingsFor({
      number: 21,
      title: "bump drizzle",
      labels: ["chore", "track:platform"],
      milestone: "Platform ops & hardening",
      parent: null,
      startDate: null,
      targetDate: null,
    }),
    [],
  );
});

// ── rule (c): kind:ears-handler without a parent ────────────────────────────
test("rule (c) fires for a parentless EARS task", () => {
  const orphan = roadmapFindingsFor({
    number: 30,
    title: "[012] EARS-3: x",
    labels: [EARS_KIND_LABEL, "track:academy"],
    milestone: "Академия R1 — Архив записей",
    parent: null,
    startDate: null,
    targetDate: null,
  });
  assert.equal(orphan.filter((f) => f.rule === "ears-no-parent").length, 1);
  assert.deepEqual(
    roadmapFindingsFor({
      number: 31,
      title: "[012] EARS-3: x",
      labels: [EARS_KIND_LABEL, "track:academy"],
      milestone: "Академия R1 — Архив записей",
      parent: { number: 30, milestone: "Академия R1 — Архив записей" },
      startDate: null,
      targetDate: null,
    }),
    [],
  );
});

// ── rule (d): track label ≠ the milestone's track ───────────────────────────
test("rule (d) fires when the track label names the other track", () => {
  const crossed = roadmapFindingsFor({
    number: 40,
    title: "[012] something",
    labels: ["track:doctor", "chore"],
    milestone: "Академия R1 — Архив записей",
    parent: null,
    startDate: null,
    targetDate: null,
  });
  assert.equal(crossed.filter((f) => f.rule === "track-milestone").length, 1);
  // Agreement is silent; `track:platform` on a track milestone is still a
  // mismatch (a track release is track-owned work).
  assert.deepEqual(
    roadmapFindingsFor({
      number: 41,
      title: "x",
      labels: ["track:academy"],
      milestone: "Академия · Позже",
      parent: null,
      startDate: null,
      targetDate: null,
    }),
    [],
  );
  assert.equal(
    roadmapFindingsFor({
      number: 42,
      title: "x",
      labels: ["track:platform"],
      milestone: "Витрина R1 — MVP витрины",
      parent: null,
      startDate: null,
      targetDate: null,
    }).filter((f) => f.rule === "track-milestone").length,
    1,
  );
  // The fallback milestone belongs to no track — never flagged.
  assert.deepEqual(
    roadmapFindingsFor({
      number: 43,
      title: "x",
      labels: ["track:academy"],
      milestone: "Platform ops & hardening",
      parent: null,
      startDate: null,
      targetDate: null,
    }),
    [],
  );
});

// ── aggregation + rendering ─────────────────────────────────────────────────
test("roadmapHygiene sorts by number then rule, and counts per rule", () => {
  const rows = [
    {
      number: 50,
      title: "[Витрина][017] MVP",
      labels: ["track:academy"],
      milestone: "Витрина R1 — MVP витрины",
      parent: null,
      startDate: null,
      targetDate: null,
    },
    {
      number: 45,
      title: "[012] EARS-1: x",
      labels: [EARS_KIND_LABEL],
      milestone: null,
      parent: null,
      startDate: null,
      targetDate: null,
    },
  ];
  const findings = roadmapHygiene(rows);
  assert.deepEqual(
    findings.map((f) => [f.number, f.rule]),
    [
      [45, "ears-no-parent"],
      [50, "missing-dates"],
      [50, "track-milestone"],
    ],
  );
  assert.deepEqual(roadmapRuleCounts(findings), {
    "parent-milestone": 0,
    "missing-dates": 1,
    "ears-no-parent": 1,
    "track-milestone": 1,
  });
});

test("formatRoadmapHygiene is silent when clean and headed with the count", () => {
  assert.equal(formatRoadmapHygiene([]), "");
  assert.equal(formatRoadmapHygiene(undefined), "");
  const out = formatRoadmapHygiene([
    { number: 7, rule: "ears-no-parent", message: "no parent" },
  ]);
  assert.match(out, /^## Roadmap hygiene \(1\)/);
  assert.match(out, /- #7: no parent/);
});

test("roadmapHygieneWarnings rolls up to ONE facts-only row per rule", () => {
  const rows = roadmapHygieneWarnings([
    { number: 7, rule: "ears-no-parent", message: "no parent" },
    { number: 8, rule: "parent-milestone", message: "mismatch" },
    { number: 9, rule: "parent-milestone", message: "mismatch" },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((r) => r.source)), new Set(["roadmap hygiene"]));
  assert.match(
    rows.find((r) => r.message.startsWith("parent-milestone")).message,
    /child milestone ≠ parent milestone ×2 — see `pnpm backlog:triage`/,
  );
  assert.match(rows.find((r) => r.message.startsWith("ears-no-parent")).message, /×1/);
  // No Issue number leaks into the SessionStart block — that list is triage's.
  for (const r of rows) assert.doesNotMatch(r.message, /#\d/);
  assert.deepEqual(roadmapHygieneWarnings([]), []);
});

// ── board node adapter ──────────────────────────────────────────────────────
test("boardDateValues picks the Start/Target date field values", () => {
  assert.deepEqual(
    boardDateValues({
      fieldValues: {
        nodes: [
          {},
          { date: "2026-09-01", field: { name: "Start date" } },
          { date: "2026-10-01", field: { name: "Target date" } },
          { date: "2026-01-01", field: { name: "Some other date" } },
        ],
      },
    }),
    { startDate: "2026-09-01", targetDate: "2026-10-01" },
  );
  assert.deepEqual(boardDateValues({}), { startDate: null, targetDate: null });
});

test("parseIssueBoardNode maps an OPEN Issue node, skipping PRs and closed Issues", () => {
  const node = {
    id: "PVTI_x",
    fieldValues: { nodes: [{ date: "2026-09-01", field: { name: "Start date" } }] },
    content: {
      __typename: "Issue",
      number: 60,
      state: "OPEN",
      title: "[Академия][012] Архив",
      milestone: { title: "Академия R1 — Архив записей" },
      labels: { nodes: [{ name: "feature" }, { name: "track:academy" }] },
      parent: { number: 59, milestone: { title: "Академия R1 — Архив записей" } },
    },
  };
  assert.deepEqual(parseIssueBoardNode(node), {
    number: 60,
    title: "[Академия][012] Архив",
    labels: ["feature", "track:academy"],
    milestone: "Академия R1 — Архив записей",
    parent: { number: 59, milestone: "Академия R1 — Архив записей" },
    startDate: "2026-09-01",
    targetDate: null,
  });
  assert.equal(
    parseIssueBoardNode({ content: { __typename: "PullRequest", number: 1 } }),
    null,
  );
  assert.equal(
    parseIssueBoardNode({ content: { __typename: "Issue", number: 2, state: "CLOSED" } }),
    null,
  );
  assert.equal(parseIssueBoardNode({}), null);
});
