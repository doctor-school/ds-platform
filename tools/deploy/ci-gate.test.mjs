// tools/deploy/ci-gate.test.mjs — unit tests for the deploy pre-flight CI
// provenance filter (Issue #2077). `node --test` (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";

import {
  repoWorkflowSuiteFilter,
  filterCheckRunsToRepoWorkflows,
  classifyDeployCheckRuns,
} from "./ci-gate.mjs";

// Suite ids mirror the live board of main a0ddf421 (#2077 recon facts 2/3).
const SUITE_CI = 92749280171;
const SUITE_RELEASE = 92749280166;
const SUITE_DEPENDABOT = 92749348689;

const WORKFLOW_RUNS = [
  {
    id: 34239037573,
    name: "npm_and_yarn in /. for fast-uri - Update #1",
    path: "dynamic/dependabot/dependabot-updates",
    event: "dynamic",
    conclusion: "failure",
    check_suite_id: SUITE_DEPENDABOT,
  },
  {
    id: 34239014209,
    name: "release",
    path: ".github/workflows/release.yml",
    event: "push",
    conclusion: "success",
    check_suite_id: SUITE_RELEASE,
  },
  {
    id: 34239014210,
    name: "CI",
    path: ".github/workflows/ci.yml",
    event: "push",
    conclusion: "success",
    check_suite_id: SUITE_CI,
  },
];

function run(name, suiteId, extra = {}) {
  return {
    name,
    status: "completed",
    conclusion: "success",
    started_at: "2026-09-08T10:00:00Z",
    completed_at: "2026-09-08T10:10:00Z",
    check_suite: { id: suiteId },
    ...extra,
  };
}

const REPO_ROWS = [
  run("ci", SUITE_CI),
  run("core", SUITE_CI),
  run("guards-block", SUITE_CI),
  run("release", SUITE_RELEASE),
];

const DEPENDABOT_ROW = run("Dependabot", SUITE_DEPENDABOT, {
  conclusion: "failure",
});

// -- repoWorkflowSuiteFilter -----------------------------------------------

test("EARS-7: suites of `.github/workflows/*` runs are kept, `dynamic/*` dropped", () => {
  const { keep, dropped } = repoWorkflowSuiteFilter(WORKFLOW_RUNS);
  assert.equal(keep.has(SUITE_CI), true);
  assert.equal(keep.has(SUITE_RELEASE), true);
  assert.equal(keep.has(SUITE_DEPENDABOT), false);
  assert.equal(
    dropped.get(SUITE_DEPENDABOT),
    "dynamic/dependabot/dependabot-updates",
  );
  assert.equal(dropped.size, 1);
});

test("EARS-7.1: a check-run whose suite has no workflow run is KEPT (fail-closed)", () => {
  const rows = [...REPO_ROWS, run("mystery", 999999)];
  const { runs, dropped } = filterCheckRunsToRepoWorkflows(rows, WORKFLOW_RUNS);
  assert.equal(runs.length, rows.length);
  assert.deepEqual(dropped, []);
});

test("EARS-7.2: a flat `check_suite_id` row (the jq projection prod.mjs uses) filters too", () => {
  const flat = (name, suiteId, extra = {}) => {
    const rest = { ...run(name, suiteId, extra) };
    delete rest.check_suite;
    return { ...rest, check_suite_id: suiteId };
  };
  const v = classifyDeployCheckRuns(
    [
      flat("ci", SUITE_CI),
      flat("Dependabot", SUITE_DEPENDABOT, { conclusion: "failure" }),
    ],
    WORKFLOW_RUNS,
  );
  assert.equal(v.state, "green");
  assert.deepEqual(v.dropped, [
    "Dependabot (dynamic/dependabot/dependabot-updates)",
  ]);
});

// -- classifyDeployCheckRuns -----------------------------------------------

test("EARS-1: a failing foreign dynamic-workflow row does not red an otherwise green board", () => {
  const v = classifyDeployCheckRuns(
    [...REPO_ROWS, DEPENDABOT_ROW],
    WORKFLOW_RUNS,
  );
  assert.equal(v.state, "green");
  assert.deepEqual(v.red, []);
  assert.deepEqual(v.pending, []);
  assert.deepEqual(v.dropped, [
    "Dependabot (dynamic/dependabot/dependabot-updates)",
  ]);
  assert.equal(v.count, REPO_ROWS.length);
});

test("EARS-2: a failing repo-workflow row reds the board while the foreign row is still dropped", () => {
  const rows = [
    ...REPO_ROWS.slice(1),
    run("ci", SUITE_CI, { conclusion: "failure" }),
    DEPENDABOT_ROW,
  ];
  const v = classifyDeployCheckRuns(rows, WORKFLOW_RUNS);
  assert.equal(v.state, "red");
  assert.deepEqual(v.red, ["ci=failure"]);
  assert.deepEqual(v.dropped, [
    "Dependabot (dynamic/dependabot/dependabot-updates)",
  ]);
});

test("EARS-3: an in-progress repo-workflow row yields pending", () => {
  const rows = [
    ...REPO_ROWS.slice(1),
    run("ci", SUITE_CI, { status: "in_progress", conclusion: null }),
    DEPENDABOT_ROW,
  ];
  const v = classifyDeployCheckRuns(rows, WORKFLOW_RUNS);
  assert.equal(v.state, "pending");
  assert.deepEqual(v.pending, ["ci"]);
});

test("EARS-4: a failing check-run of unknown provenance still reds the board", () => {
  const rows = [
    ...REPO_ROWS,
    DEPENDABOT_ROW,
    run("mystery", 999999, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, WORKFLOW_RUNS);
  assert.equal(v.state, "red");
  assert.deepEqual(v.red, ["mystery=failure"]);
});

test("EARS-5: no check-runs, or a board consisting only of dropped rows, is empty", () => {
  assert.equal(classifyDeployCheckRuns([], WORKFLOW_RUNS).state, "empty");
  const onlyForeign = classifyDeployCheckRuns([DEPENDABOT_ROW], WORKFLOW_RUNS);
  assert.equal(onlyForeign.state, "empty");
  assert.equal(onlyForeign.count, 0);
  assert.deepEqual(onlyForeign.dropped, [
    "Dependabot (dynamic/dependabot/dependabot-updates)",
  ]);
});

test("EARS-6: the latest run per check name wins over a superseded one", () => {
  const rows = [
    ...REPO_ROWS,
    run("ci", SUITE_CI, {
      conclusion: "cancelled",
      started_at: "2026-09-08T09:00:00Z",
      completed_at: "2026-09-08T09:05:00Z",
    }),
  ];
  const v = classifyDeployCheckRuns(rows, WORKFLOW_RUNS);
  assert.equal(v.state, "green");
  assert.deepEqual(v.red, []);
});

test("EARS-6.1: `neutral` and `skipped` stay green conclusions", () => {
  const rows = [
    run("ci", SUITE_CI, { conclusion: "neutral" }),
    run("core", SUITE_CI, { conclusion: "skipped" }),
  ];
  assert.equal(classifyDeployCheckRuns(rows, WORKFLOW_RUNS).state, "green");
});
