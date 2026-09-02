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
  ownsRoadmapLabel,
  ROADMAP_LABEL,
  ROADMAP_RULES,
  roadmapFindingsFor,
  roadmapHygiene,
  roadmapRuleCounts,
  formatRoadmapHygiene,
  roadmapHygieneWarnings,
  parseIssueBoardNode,
  boardDateValues,
  boardStatusValue,
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

// ── rule (b): the two date rules and their spec §3.2 preconditions ───────
const feature = {
  number: 20,
  title: "[Академия][012] Архив",
  labels: ["track:academy"],
  milestone: "Академия R1 — Архив записей",
  parent: null,
  startDate: null,
  targetDate: null,
  milestoneDueOn: null,
  subIssuesCompleted: 0,
  boardStatus: null,
};
const dateRules = (row) =>
  roadmapFindingsFor(row)
    .filter((f) => f.rule === "missing-target" || f.rule === "missing-start")
    .map((f) => f.rule);

test("missing-target fires only when the milestone itself carries a due date", () => {
  // Dateless milestone («· Позже» backlog) — no Target is forecastable.
  assert.deepEqual(dateRules(feature), []);
  // Dated milestone, no Target — the forecast is genuinely missing.
  const dated = { ...feature, milestoneDueOn: "2026-11-30T00:00:00Z" };
  assert.deepEqual(dateRules(dated), ["missing-target"]);
  assert.match(
    roadmapFindingsFor(dated).find((f) => f.rule === "missing-target").message,
    /due 2026-11-30.*without a Target date/,
  );
  // Target set — clean.
  assert.deepEqual(dateRules({ ...dated, targetDate: "2026-11-20" }), []);
});

test("missing-start fires only once work has demonstrably started", () => {
  // Nothing started — a Start date is not owed yet (spec §3.2).
  assert.deepEqual(dateRules({ ...feature, boardStatus: "Todo" }), []);
  assert.deepEqual(dateRules({ ...feature, subIssuesCompleted: 0 }), []);
  // A closed child Issue proves work started.
  assert.deepEqual(dateRules({ ...feature, subIssuesCompleted: 2 }), ["missing-start"]);
  assert.match(
    roadmapFindingsFor({ ...feature, subIssuesCompleted: 2 }).find(
      (f) => f.rule === "missing-start",
    ).message,
    /2 closed child Issue\(s\)/,
  );
  // So does the Issue's own board Status past Todo.
  for (const status of ["In Progress", "Review", "Done"])
    assert.deepEqual(dateRules({ ...feature, boardStatus: status }), ["missing-start"]);
  // Start already set — clean whatever the progress.
  assert.deepEqual(
    dateRules({ ...feature, startDate: "2026-09-01", subIssuesCompleted: 2 }),
    [],
  );
});

test("neither date rule touches deliberately dateless kinds", () => {
  // A platform task is deliberately dateless — never flagged.
  assert.deepEqual(
    dateRules({
      ...feature,
      number: 21,
      title: "bump drizzle",
      labels: ["chore", "track:platform"],
      milestone: "Platform ops & hardening",
      milestoneDueOn: "2026-11-30T00:00:00Z",
      subIssuesCompleted: 3,
      boardStatus: "In Progress",
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
  // Agreement is silent.
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
  // `track:platform` on a track release is the DOCUMENTED shape — platform work
  // takes the milestone of the release it `blocked_by`-blocks (spec §7.1
  // Platform-task row; `.claude/rules/repo-conventions.md` → Issue conventions).
  // Rule (d) is about the two PRODUCT tracks cross-homing, nothing else.
  assert.deepEqual(
    roadmapFindingsFor({
      number: 42,
      title: "x",
      labels: ["track:platform"],
      milestone: "Витрина R1 — MVP витрины",
      parent: null,
      startDate: null,
      targetDate: null,
    }).filter((f) => f.rule === "track-milestone"),
    [],
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
      labels: ["track:academy", ROADMAP_LABEL],
      milestone: "Витрина R1 — MVP витрины",
      parent: null,
      startDate: null,
      targetDate: null,
      milestoneDueOn: "2026-12-01T00:00:00Z",
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
      [50, "missing-target"],
      [50, "track-milestone"],
    ],
  );
  assert.deepEqual(roadmapRuleCounts(findings), {
    "parent-milestone": 0,
    "missing-target": 1,
    "missing-start": 0,
    "ears-no-parent": 1,
    "track-milestone": 1,
    "missing-roadmap-label": 0,
    "stray-roadmap-label": 0,
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

test("boardStatusValue picks the Status single-select value", () => {
  assert.equal(
    boardStatusValue({
      fieldValues: {
        nodes: [
          { date: "2026-09-01", field: { name: "Start date" } },
          { name: "Review", field: { name: "Status" } },
          { name: "P1", field: { name: "Priority" } },
        ],
      },
    }),
    "Review",
  );
  assert.equal(boardStatusValue({}), null);
});

test("parseIssueBoardNode maps an OPEN Issue node, skipping PRs and closed Issues", () => {
  const node = {
    id: "PVTI_x",
    fieldValues: {
      nodes: [
        { date: "2026-09-01", field: { name: "Start date" } },
        { name: "In Progress", field: { name: "Status" } },
      ],
    },
    content: {
      __typename: "Issue",
      number: 60,
      state: "OPEN",
      title: "[Академия][012] Архив",
      milestone: { title: "Академия R1 — Архив записей", dueOn: "2026-11-30T00:00:00Z" },
      subIssuesSummary: { total: 4, completed: 1 },
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
    milestoneDueOn: "2026-11-30T00:00:00Z",
    subIssuesCompleted: 1,
    boardStatus: "In Progress",
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

// ── the `roadmap` view selector (#1806) ─────────────────────────────────────
test("ownsRoadmapLabel is true only for the two roadmap levels", () => {
  assert.equal(ownsRoadmapLabel("feature"), true);
  assert.equal(ownsRoadmapLabel("release-gate"), true);
  assert.equal(ownsRoadmapLabel("ears-task"), false);
  assert.equal(ownsRoadmapLabel("epic"), false);
  assert.equal(ownsRoadmapLabel("platform-task"), false);
});

test("rule (e) missing-roadmap-label fires on a roadmap level lacking the label", () => {
  const bare = (over) => ({
    number: 1,
    title: "[Академия][012] Archive",
    labels: [],
    milestone: null,
    parent: null,
    startDate: null,
    targetDate: null,
    milestoneDueOn: null,
    subIssuesCompleted: 0,
    boardStatus: null,
    ...over,
  });

  const feature = roadmapFindingsFor(bare());
  assert.equal(feature.filter((f) => f.rule === "missing-roadmap-label").length, 1);

  const gate = roadmapFindingsFor(bare({ number: 2, title: "gate: Академия R1 — Архив" }));
  assert.equal(gate.filter((f) => f.rule === "missing-roadmap-label").length, 1);

  // Present → silent, in both directions.
  const labelled = roadmapFindingsFor(bare({ labels: [ROADMAP_LABEL] }));
  assert.equal(labelled.filter((f) => f.rule.endsWith("roadmap-label")).length, 0);

  // A non-roadmap level owes nothing.
  for (const title of ["epic: academy", "[019] Stage-B design gate", "[012] EARS-3: x"]) {
    const other = roadmapFindingsFor(bare({ title, labels: [] }));
    assert.equal(other.filter((f) => f.rule === "missing-roadmap-label").length, 0);
  }
});

test("rule (e) stray-roadmap-label fires when a non-roadmap level carries it", () => {
  const bare = (over) => ({
    number: 3,
    title: "epic: academy",
    labels: [ROADMAP_LABEL],
    milestone: null,
    parent: { number: 9, milestone: null },
    startDate: null,
    targetDate: null,
    milestoneDueOn: null,
    subIssuesCompleted: 0,
    boardStatus: null,
    ...over,
  });

  for (const title of ["epic: academy", "Refactor the deploy script"]) {
    const stray = roadmapFindingsFor(bare({ title }));
    assert.equal(stray.filter((f) => f.rule === "stray-roadmap-label").length, 1);
  }

  const ears = roadmapFindingsFor(
    bare({ title: "[012] EARS-3: x", labels: [ROADMAP_LABEL, EARS_KIND_LABEL] }),
  );
  assert.equal(ears.filter((f) => f.rule === "stray-roadmap-label").length, 1);

  // A feature carrying it is correct, not stray.
  const ok = roadmapFindingsFor(bare({ title: "[Витрина][018] Feed" }));
  assert.equal(ok.filter((f) => f.rule === "stray-roadmap-label").length, 0);
});

test("both roadmap-label rules are named in ROADMAP_RULES", () => {
  assert.ok(ROADMAP_RULES["missing-roadmap-label"]);
  assert.ok(ROADMAP_RULES["stray-roadmap-label"]);
});
