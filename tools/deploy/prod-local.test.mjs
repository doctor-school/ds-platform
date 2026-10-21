// tools/deploy/prod-local.test.mjs — `prod.mjs --local`, the prod release driver's run
// on ds-api-prod (Issue #3157; tech spec 2026-10-16-release-pipeline-off-workstation-en.md
// §5 «Prod release driver»). The plan is a pure list `deploy()` walks with a cursor that
// refuses any other order, so the plan tests below pin the order the run executes; the
// walk itself is pinned on the source text, as prod-durable.test.mjs pins its wiring.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEPLOY_PLAN,
  OPERATOR_ONLY_STEPS,
  deployPlan,
  localProdHosts,
  parseLocalFlags,
  planWalker,
  recordPreviousShaScript,
} from "./prod.mjs";
import {
  readPostgresTarget,
  readPostgresTargetFromTree,
} from "./postgres-guard.mjs";
import {
  DATA_PROD_HOP_KEY,
  LOCAL_EXECUTOR,
  RELEASE_DRIVER_BIN,
  sshBaseArgs,
} from "./lib/remote.mjs";

const SOURCE = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
const deployBody = SOURCE.slice(
  SOURCE.indexOf("async function deploy("),
  SOURCE.indexOf("function cutReleaseAtDeployedSha("),
);
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("3157: the local plan is the operator plan minus the pre-flight, the release cut and the Deployment record", () => {
  assert.deepEqual(
    [...OPERATOR_ONLY_STEPS],
    ["preflight", "release-cut", "deployment-record"],
  );
  assert.deepEqual(deployPlan(), [...DEPLOY_PLAN]);
  assert.deepEqual(
    deployPlan({ local: true }),
    DEPLOY_PLAN.filter((id) => !OPERATOR_ONLY_STEPS.includes(id)),
  );
  for (const id of [
    "test-token",
    "postgres-verify",
    "previous-sha",
    "ship",
    "install",
    "data-prod-env",
    "data-prod-up",
    "backup",
    "pull",
    "boot-verify",
    "idp",
    "migrate",
    "runtime-configs",
    "verify-running-sha",
    "prune",
    "smoke",
    "finish",
  ]) {
    assert.ok(
      deployPlan({ local: true }).includes(id),
      `the box-local run keeps ${id}`,
    );
  }
});

test("3157: the smoke runs inside the release, before finish, on both paths", () => {
  for (const plan of [deployPlan(), deployPlan({ local: true })]) {
    assert.equal(plan.indexOf("finish"), plan.indexOf("smoke") + 1);
  }
  assert.equal(
    deployPlan({ local: true }).at(-1),
    "finish",
    "nothing runs on the box after finish",
  );
});

test("3157: deploy() walks exactly the plan, in its order", () => {
  const walked = [
    ...deployBody.matchAll(/walk\.(phase|operatorPhase)\("([a-z-]+)"\)/g),
  ];
  assert.deepEqual(
    walked.map((m) => m[2]),
    [...DEPLOY_PLAN],
  );
  for (const [, kind, id] of walked) {
    assert.equal(
      kind === "operatorPhase",
      OPERATOR_ONLY_STEPS.includes(id),
      id,
    );
  }
  assert.match(deployBody, /walk\.done\(\);/);
  // The operator-only phases run only when the walker says so.
  assert.match(
    deployBody,
    /walk\.operatorPhase\("preflight"\)\s*\?\s*await preflight\(hotfixRef\)\s*:\s*await readLocalRelease\(local\.imagesFile\)/,
  );
  assert.match(
    deployBody,
    /if \(walk\.operatorPhase\("release-cut"\)\) \{\s*step\("[^"]*"\);\s*cutReleaseAtDeployedSha\(/,
  );
  assert.match(
    deployBody,
    /if \(walk\.operatorPhase\("deployment-record"\)\) \{\s*step\("[^"]*"\);\s*await recordDeployment\(/,
  );
});

test("3157: the walker refuses a phase out of order, and a run that leaves one out", () => {
  const operator = planWalker();
  assert.equal(operator.operatorPhase("preflight"), true);
  assert.throws(
    () => operator.phase("ship"),
    /test-token was left out before ship/,
  );

  const local = planWalker({ local: true });
  assert.equal(local.operatorPhase("preflight"), false);
  for (const id of deployPlan({ local: true })) local.phase(id);
  assert.equal(local.operatorPhase("release-cut"), false);
  assert.equal(local.operatorPhase("deployment-record"), false);
  local.done();

  const short = planWalker({ local: true });
  short.operatorPhase("preflight");
  short.phase("test-token");
  assert.throws(() => short.done(), /service-set was left out/);
  assert.throws(() => planWalker().phase("preflight"), /operator-only/);
  assert.throws(() => planWalker().operatorPhase("ship"), /runs on every path/);
  const back = planWalker({ local: true });
  back.phase("test-token");
  back.phase("service-set");
  assert.throws(() => back.phase("test-token"), /out of plan order/);
});

test("3157: on the box, api-prod is the local executor and data-prod the VPC hop with the hop key", () => {
  const hosts = localProdHosts();
  assert.equal(hosts.api, LOCAL_EXECUTOR);
  assert.equal(hosts.data, "deploy@192.168.0.10");
  assert.equal(DATA_PROD_HOP_KEY, "/etc/ds-platform/data-prod-ssh-key");
  const args = sshBaseArgs(hosts.data, ["-o", "ConnectTimeout=15"]);
  assert.deepEqual(args, [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-i",
    DATA_PROD_HOP_KEY,
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=15",
    "deploy@192.168.0.10",
  ]);
  // The operator's aliases keep their channel byte-identical.
  assert.deepEqual(sshBaseArgs("ds-data-prod"), [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "ds-data-prod",
  ]);
});

test("3157: a --local run re-points both boxes before its first step, and every data-prod step goes through DATA_PROD", () => {
  assert.match(
    SOURCE,
    /function useLocalHosts\(\) \{\s*const hosts = localProdHosts\(\);\s*API_PROD = hosts\.api;\s*DATA_PROD = hosts\.data;/,
  );
  const main = SOURCE.slice(SOURCE.indexOf("async function main("));
  assert.match(
    main,
    /if \(localUsage\.local\) \{\s*useLocalHosts\(\);\s*await deploy\(null, localUsage\.local\);/,
  );
  assert.doesNotMatch(
    deployBody,
    /"ds-data-prod"|"ds-api-prod"/,
    "no box alias is named in deploy()",
  );
  // The failure close reaches both boxes through the same transport as every step.
  assert.match(SOURCE, /spawnSync\(\s*\.\.\.boxSpawnArgs\(host, script,/);
});

test("3157: --local takes only --images-file, and no operator flag", () => {
  assert.deepEqual(parseLocalFlags([]), { local: null });
  assert.deepEqual(parseLocalFlags(["--ref", SHA]), { local: null });
  assert.deepEqual(parseLocalFlags(["--local", "--images-file", "-"]), {
    local: { imagesFile: "-" },
  });
  assert.deepEqual(
    parseLocalFlags(["--images-file", "/tmp/m.json", "--local"]),
    {
      local: { imagesFile: "/tmp/m.json" },
    },
  );
  assert.match(parseLocalFlags(["--local"]).error, /go together/);
  assert.match(parseLocalFlags(["--images-file", "-"]).error, /go together/);
  assert.match(
    parseLocalFlags(["--local", "--images-file"]).error,
    /requires a path/,
  );
  for (const extra of [
    ["--ref", SHA],
    ["--rollback", SHA],
    ["--skip-ci-check"],
    ["--allow-live-broadcast"],
    ["--release-gate-exempt", "x"],
    ["--postgres-artifacts", "c.json"],
    ["--retry-failed"],
  ]) {
    assert.match(
      parseLocalFlags(["--local", "--images-file", "-", ...extra]).error,
      /takes no other flag/,
      extra.join(" "),
    );
  }
});

test("3157: the box-local run records the previous SHA for status through the installed driver", () => {
  assert.equal(
    recordPreviousShaScript(SHA, "c".repeat(40)),
    `${RELEASE_DRIVER_BIN} record-previous prod ${SHA} ${"c".repeat(40)}\n`,
  );
  assert.equal(
    recordPreviousShaScript(SHA, null),
    `${RELEASE_DRIVER_BIN} record-previous prod ${SHA} none\n`,
  );
  const previous = deployBody.slice(
    deployBody.indexOf('walk.phase("previous-sha")'),
  );
  assert.match(
    previous.slice(0, previous.indexOf('walk.phase("ship")')),
    /if \(local\) \{[\s\S]*recordPreviousShaScript\(sha, prevSha\)/,
  );
});

test("3157: the PostgreSQL target reads the same from the extracted tree as from git", () => {
  const committed = readPostgresTarget("HEAD");
  const tree = mkdtempSync(join(tmpdir(), "ds-pg-tree-"));
  try {
    for (const [path, text] of Object.entries(committed.files)) {
      const file = join(tree, "infra/deploy/compose/data-prod", path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    const fromTree = readPostgresTargetFromTree(committed.sha, tree);
    assert.deepEqual(fromTree, committed);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
  assert.throws(
    () => readPostgresTargetFromTree(SHA, join(tmpdir(), "ds-no-such-tree")),
    /cannot read the target source tree/,
  );
});
