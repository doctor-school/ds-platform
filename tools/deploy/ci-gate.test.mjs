// tools/deploy/ci-gate.test.mjs — unit tests for the deploy pre-flight CI
// provenance filter (Issue #2077). `node --test` (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";

import {
  repoWorkflowSuiteFilter,
  filterCheckRunsToRepoWorkflows,
  classifyDeployCheckRuns,
  ciVerdictProblem,
  DEPLOY_PROD_WORKFLOW_PATH,
  RELEASE_WORKFLOW_PATH,
  REGISTRY_RETENTION_WORKFLOW_PATH,
  NON_CI_WORKFLOW_PATHS,
  fetchDeployCiBoard,
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

// -- #3158: the deploy workflow's own runs are not CI ------------------------

const SUITE_DEPLOY = 92749399999;
const DEPLOY_RUN = {
  id: 34239099999,
  name: "Deploy prod",
  path: ".github/workflows/deploy-prod.yml",
  event: "workflow_dispatch",
  conclusion: null,
  check_suite_id: SUITE_DEPLOY,
};

test("3158: check-runs of the deploy workflow's own path are dropped, selected by path", () => {
  const rows = [
    ...REPO_ROWS,
    // The running release's own job (in progress) and an earlier failed attempt
    // on the same SHA: neither is a statement about the code.
    run("preflight", SUITE_DEPLOY, { status: "in_progress", conclusion: null }),
    run("deploy", SUITE_DEPLOY, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, [...WORKFLOW_RUNS, DEPLOY_RUN], {
    ignoreWorkflowPaths: [DEPLOY_PROD_WORKFLOW_PATH],
  });
  assert.equal(v.state, "green");
  assert.deepEqual(v.dropped, [
    "preflight (.github/workflows/deploy-prod.yml)",
    "deploy (.github/workflows/deploy-prod.yml)",
  ]);
  assert.equal(DEPLOY_PROD_WORKFLOW_PATH, ".github/workflows/deploy-prod.yml");
});

test("3158: a check named like the deploy job but in a CI suite still counts (names never decide)", () => {
  const rows = [
    ...REPO_ROWS,
    run("deploy", SUITE_CI, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, [...WORKFLOW_RUNS, DEPLOY_RUN], {
    ignoreWorkflowPaths: [DEPLOY_PROD_WORKFLOW_PATH],
  });
  assert.equal(v.state, "red");
  assert.deepEqual(v.red, ["deploy=failure"]);
});

test("3158: without the option the deploy workflow's runs still block (default unchanged)", () => {
  const rows = [
    ...REPO_ROWS,
    run("deploy", SUITE_DEPLOY, { conclusion: "failure" }),
  ];
  assert.equal(
    classifyDeployCheckRuns(rows, [...WORKFLOW_RUNS, DEPLOY_RUN]).state,
    "red",
  );
});

// -- #3684: the changesets `release` workflow is not CI ------------------------

const SUITE_RUNTIME_IMAGES = 92749280199;
const RUNTIME_IMAGES_RUN = {
  id: 34239014299,
  name: "runtime-images",
  path: ".github/workflows/runtime-images.yml",
  event: "push",
  conclusion: "failure",
  check_suite_id: SUITE_RUNTIME_IMAGES,
};

test("3684: a red changesets `release` check-run (release.yml) no longer refuses the gate, selected by path", () => {
  const rows = [
    ...REPO_ROWS.filter((r) => r.name !== "release"),
    run("release", SUITE_RELEASE, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, WORKFLOW_RUNS, {
    ignoreWorkflowPaths: NON_CI_WORKFLOW_PATHS,
  });
  assert.equal(v.state, "green");
  assert.deepEqual(v.red, []);
  assert.deepEqual(v.dropped, ["release (.github/workflows/release.yml)"]);
  assert.equal(RELEASE_WORKFLOW_PATH, ".github/workflows/release.yml");
});

test("3684: with the non-CI paths ignored, a red `ci` (ci.yml) check-run still refuses", () => {
  const rows = [
    ...REPO_ROWS.filter((r) => r.name !== "ci"),
    run("ci", SUITE_CI, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, WORKFLOW_RUNS, {
    ignoreWorkflowPaths: NON_CI_WORKFLOW_PATHS,
  });
  assert.equal(v.state, "red");
  assert.deepEqual(v.red, ["ci=failure"]);
});

test("3684: with the non-CI paths ignored, a red runtime-images.yml check-run still refuses", () => {
  const rows = [
    ...REPO_ROWS,
    run("build", SUITE_RUNTIME_IMAGES, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, [...WORKFLOW_RUNS, RUNTIME_IMAGES_RUN], {
    ignoreWorkflowPaths: NON_CI_WORKFLOW_PATHS,
  });
  assert.equal(v.state, "red");
  assert.deepEqual(v.red, ["build=failure"]);
});

const SUITE_RETENTION = 92749280211;
const RETENTION_RUN = {
  id: 34239014311,
  name: "Registry retention",
  path: ".github/workflows/registry-retention.yml",
  event: "workflow_run",
  conclusion: "failure",
  check_suite_id: SUITE_RETENTION,
};
const SUITE_STAGE = 92749280222;
const STAGE_RUN = {
  id: 34239014322,
  name: "Stage",
  path: ".github/workflows/stage.yml",
  event: "workflow_run",
  conclusion: "failure",
  check_suite_id: SUITE_STAGE,
};

test("3684: a red registry-retention.yml check-run no longer refuses the gate, selected by path", () => {
  const rows = [
    ...REPO_ROWS,
    run("prune", SUITE_RETENTION, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, [...WORKFLOW_RUNS, RETENTION_RUN], {
    ignoreWorkflowPaths: NON_CI_WORKFLOW_PATHS,
  });
  assert.equal(v.state, "green");
  assert.deepEqual(v.dropped, [
    "release (.github/workflows/release.yml)",
    "prune (.github/workflows/registry-retention.yml)",
  ]);
  assert.equal(
    REGISTRY_RETENTION_WORKFLOW_PATH,
    ".github/workflows/registry-retention.yml",
  );
});

test("3684: with the non-CI paths ignored, a red stage.yml check-run still refuses", () => {
  const rows = [
    ...REPO_ROWS,
    run("stage-deploy", SUITE_STAGE, { conclusion: "failure" }),
  ];
  const v = classifyDeployCheckRuns(rows, [...WORKFLOW_RUNS, STAGE_RUN], {
    ignoreWorkflowPaths: NON_CI_WORKFLOW_PATHS,
  });
  assert.equal(v.state, "red");
  assert.deepEqual(v.red, ["stage-deploy=failure"]);
});

test("3684: the non-CI workflow set is exactly deploy-prod.yml + release.yml + registry-retention.yml", () => {
  assert.deepEqual(
    [...NON_CI_WORKFLOW_PATHS].sort(),
    [
      DEPLOY_PROD_WORKFLOW_PATH,
      RELEASE_WORKFLOW_PATH,
      REGISTRY_RETENTION_WORKFLOW_PATH,
    ].sort(),
  );
  assert.equal(Object.isFrozen(NON_CI_WORKFLOW_PATHS), true);
});

test("3158: fetchDeployCiBoard reads both boards through the injected gh and parses the lines", () => {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (args[2].includes("/check-runs"))
      return `${JSON.stringify({ name: "ci", status: "completed", conclusion: "success", check_suite_id: 1 })}
`;
    return `${JSON.stringify({ name: "CI", path: ".github/workflows/ci.yml", check_suite_id: 1 })}
`;
  };
  const board = fetchDeployCiBoard({
    sha: "a".repeat(40),
    repo: "o/r",
    run: exec,
  });
  assert.equal(board.checkRuns.length, 1);
  assert.equal(board.workflowRuns[0].path, ".github/workflows/ci.yml");
  assert.match(
    calls[0],
    /^gh api --paginate repos\/o\/r\/commits\/a{40}\/check-runs/,
  );
  assert.match(
    calls[1],
    /^gh api --paginate repos\/o\/r\/actions\/runs\?head_sha=a{40}/,
  );
});

test("3158: fetchDeployCiBoard fails closed when the provenance query fails", () => {
  const exec = (cmd, args) => {
    if (args[2].includes("/check-runs")) return "";
    throw new Error("HTTP 502");
  };
  assert.throws(
    () => fetchDeployCiBoard({ sha: "a".repeat(40), repo: "o/r", run: exec }),
    /workflow runs .*provenance unknown.*HTTP 502/,
  );
});

test("3158: ciVerdictProblem names the refusal per state, null when green", () => {
  const sha = "b".repeat(40);
  assert.equal(ciVerdictProblem({ state: "green", count: 3 }, sha), null);
  assert.match(
    ciVerdictProblem({ state: "empty" }, sha),
    /no repo-owned CI check-runs/,
  );
  assert.match(
    ciVerdictProblem({ state: "pending", pending: ["ci"] }, sha),
    /CI still running for bbbbbbbbbbbb: ci/,
  );
  assert.match(
    ciVerdictProblem({ state: "red", red: ["ci=failure"] }, sha),
    /CI is RED for bbbbbbbbbbbb: ci=failure/,
  );
});
