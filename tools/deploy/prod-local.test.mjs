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
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BREAKGLASS_API_PROD,
  DEPLOY_PLAN,
  OPERATOR_ONLY_STEPS,
  compareStatus,
  deployPlan,
  descendsFromLiveVerdict,
  fetchTargetTree,
  localProdHosts,
  parseLocalFlags,
  rollbackTargetVerdict,
  planWalker,
  prodScriptOptions,
  prodShipOptions,
  recordPreviousShaScript,
} from "./prod.mjs";
import {
  readPostgresTarget,
  readPostgresTargetFromTree,
} from "./postgres-guard.mjs";
import {
  DATA_PROD_HOP_KEY,
  LOCAL_EXECUTOR,
  PROD_LIVE_TREE,
  RELEASE_DRIVER_BIN,
  shipTreeCommand,
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
  assert.equal(DATA_PROD_HOP_KEY, "/home/deploy/.ssh/data-prod-hop");  // no-hardcoded-path-ok: a fixed path on the prod box (deploy's home), not on this machine
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
    "UserKnownHostsFile=/home/deploy/.ssh/known_hosts",  // no-hardcoded-path-ok: a fixed path on the prod box (deploy's home), not on this machine
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

test("2987: the break-glass operator path connects to ds-api-prod as breakglass", () => {
  assert.equal(BREAKGLASS_API_PROD, "breakglass@ds-api-prod");
  assert.match(
    SOURCE,
    /let API_PROD = process\.env\.DS_API_PROD_SSH \|\| BREAKGLASS_API_PROD;/,
  );
  // data-prod stays the operator's alias through its ProxyJump.
  assert.match(SOURCE, /let DATA_PROD = process\.env\.DS_DATA_PROD_SSH \|\| "ds-data-prod";/);
});

test("2987: both prod boxes use the fixed tree whatever HOME the writer has; only ds-api-prod ships as root", () => {
  assert.equal(PROD_LIVE_TREE, "/home/deploy/ds-platform");  // no-hardcoded-path-ok: the fixed prod tree on the boxes, not on this machine
  // No `~`- or `$HOME`-relative prod tree is left: the root unit runs with HOME=/root.
  assert.match(SOURCE, /const REMOTE_TREE = PROD_LIVE_TREE;/);
  assert.doesNotMatch(SOURCE, /["`]~\/ds-platform/);
  assert.doesNotMatch(SOURCE, /\$HOME\/ds-platform/);
  assert.match(SOURCE, /releaseInstallScript\(PROD_LIVE_TREE, \{ sha \}\)/);
  const box = prodShipOptions(LOCAL_EXECUTOR, { api: LOCAL_EXECUTOR, localTree: "/srv/tree" });
  assert.deepEqual(box, { liveDir: PROD_LIVE_TREE, asRoot: true, sourceDir: "/srv/tree" });
  const glass = prodShipOptions(BREAKGLASS_API_PROD, { api: BREAKGLASS_API_PROD });
  assert.deepEqual(glass, { liveDir: PROD_LIVE_TREE, asRoot: true });
  const data = prodShipOptions("ds-data-prod", { api: BREAKGLASS_API_PROD });
  assert.deepEqual(data, { liveDir: PROD_LIVE_TREE, asRoot: false });
  // The root-run ship renders the same absolute tree, never `/root/ds-platform`.
  const rootShip = shipTreeCommand(box);
  assert.ok(rootShip.startsWith("sudo -n bash -c "));
  assert.ok(rootShip.includes(`live="${PROD_LIVE_TREE}"`));
  assert.ok(!rootShip.includes("$HOME"));
});

test("2987: break-glass runs every ds-api-prod script as root; data-prod, stage and a --local run as they are", () => {
  assert.deepEqual(prodScriptOptions(BREAKGLASS_API_PROD, { api: BREAKGLASS_API_PROD }), { asRoot: true });
  assert.deepEqual(prodScriptOptions("ds-data-prod", { api: BREAKGLASS_API_PROD }), { asRoot: false });
  assert.deepEqual(prodScriptOptions("ds-stage-1", { api: BREAKGLASS_API_PROD }), { asRoot: false });
  const hosts = localProdHosts();
  assert.deepEqual(prodScriptOptions(hosts.api, { api: hosts.api }), { asRoot: false }, "the unit is root already");
  assert.deepEqual(prodScriptOptions(hosts.data, { api: hosts.api }), { asRoot: false });
  // One transport: the raw primitives are reached only through the two wrappers, and
  // the durable steps poll through the same wrapper.
  assert.equal(SOURCE.match(/\bboxScript\(/g).length, 1);
  assert.equal(SOURCE.match(/\bboxCapture\(/g).length, 1);
  assert.match(SOURCE, /return boxScript\(host, script, \{ \.\.\.options, \.\.\.prodScriptOptions\(host, \{ api: API_PROD \}\) \}\);/);
  assert.match(SOURCE, /return boxCapture\(host, script, \{ \.\.\.options, \.\.\.prodScriptOptions\(host, \{ api: API_PROD \}\) \}\);/);
  assert.match(SOURCE, /retryFailed: RETRY_FAILED,\s*capture: sshCapture,\s*\}\);/);
});

test("3157: a --local run re-points both boxes before its first step, and every data-prod step goes through DATA_PROD", () => {
  assert.match(
    SOURCE,
    /function useLocalHosts\(\) \{\s*const hosts = localProdHosts\(\);\s*API_PROD = hosts\.api;\s*DATA_PROD = hosts\.data;/,
  );
  const main = SOURCE.slice(SOURCE.indexOf("async function main("));
  assert.match(
    main,
    /if \(localUsage\.local\) \{\s*useLocalHosts\(\);\s*if \(localUsage\.local\.rollback\) await rollback\(localUsage\.local\.rollback, localUsage\.local\);\s*else await deploy\(null, localUsage\.local\);/,
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

test("3157: a box-local release refuses a SHA that does not descend from the live prod SHA", () => {
  const live = "c".repeat(40);
  for (const status of ["ahead", "identical"]) {
    assert.deepEqual(
      descendsFromLiveVerdict({ live, sha: SHA, status }),
      { ok: true },
      status,
    );
  }
  const downgrade = `${SHA} does not descend from the live prod SHA ${live.slice(0, 12)} — a downgrade is a rollback (pnpm deploy:prod --rollback)`;
  for (const status of ["behind", "diverged", null, "", "weird"]) {
    assert.deepEqual(
      descendsFromLiveVerdict({ live, sha: SHA, status }),
      { ok: false, reason: downgrade },
      String(status),
    );
  }
  assert.deepEqual(
    descendsFromLiveVerdict({ live: null, sha: SHA, status: "ahead" }),
    {
      ok: false,
      reason:
        "the live prod SHA is unknown (no running ds-api-prod-api-1) — release it from the workstation path",
    },
  );
});

test("3157: the descent is GitHub's compare <live>...<sha>, unauthenticated, failing closed", async () => {
  const live = "c".repeat(40);
  const calls = [];
  const answer = (response) => async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  const json = (status, body) => ({
    ok: status === 200,
    status,
    json: async () => body,
  });
  assert.equal(
    await compareStatus(live, SHA, {
      fetchImpl: answer(json(200, { status: "ahead" })),
    }),
    "ahead",
  );
  assert.equal(
    calls[0].url,
    `https://api.github.com/repos/doctor-school/ds-platform/compare/${live}...${SHA}`,
  );
  assert.equal(calls[0].init.headers.Authorization, undefined, "no token");
  assert.equal(
    await compareStatus(live, SHA, { fetchImpl: answer(json(404, {})) }),
    null,
  );
  assert.equal(
    await compareStatus(live, SHA, { fetchImpl: answer(json(200, [])) }),
    null,
  );
  assert.equal(
    await compareStatus(live, SHA, { fetchImpl: answer(new Error("offline")) }),
    null,
  );
});

test("3157: the --local run checks the descent right after its previous-SHA read, before it records or ships", () => {
  const previous = deployBody.slice(
    deployBody.indexOf('walk.phase("previous-sha")'),
  );
  const phase = previous.slice(0, previous.indexOf('walk.phase("ship")'));
  const guard = phase.search(
    /descendsFromLiveVerdict\(\{\s*live: prevSha,\s*sha,/,
  );
  const read = phase.indexOf("await readLiveProdSha()");
  assert.match(
    SOURCE,
    /async function readLiveProdSha\(\) \{[^}]*docker inspect ds-api-prod-api-1/,
  );
  const record = phase.indexOf("recordPreviousShaScript(sha, prevSha)");
  assert.ok(
    read > 0 && read < guard && guard < record,
    "read → guard → record",
  );
  assert.match(
    phase.slice(guard),
    /if \(!descent\.ok\) die\(descent\.reason\);/,
  );
});

// The release driver runs `prod.mjs --local` (and `slot.mjs --local` for stage-main)
// from a bare codeload tree of the target commit: no `pnpm install`, so no
// node_modules (infra/deploy/bin/release-driver `cmd_run`). Every module in their
// static import closure must therefore resolve from node: built-ins and the tree.
test("3157: the box-local entries load from a bare tree of the commit, without node_modules", () => {
  const repo = join(import.meta.dirname, "../..");
  const tree = mkdtempSync(join(tmpdir(), "ds-bare-tree-"));
  try {
    const archive = spawnSync("git", ["archive", "--format=tar", "HEAD"], {
      cwd: repo,
      maxBuffer: 1 << 30,
    });
    assert.equal(archive.status, 0, String(archive.stderr));
    const untar = spawnSync("tar", ["-x", "-C", tree], {
      input: archive.stdout,
    });
    assert.equal(untar.status, 0, String(untar.stderr));
    for (const entry of ["tools/deploy/prod.mjs", "tools/staging/slot.mjs"]) {
      const url = pathToFileURL(join(tree, entry)).href;
      const run = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`],
        { cwd: tree, encoding: "utf8" },
      );
      assert.equal(
        run.status,
        0,
        `${entry} does not load from a bare tree:
${run.stderr}`,
      );
    }
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
});

test("2987: --local admits --rollback <sha> as its one mode flag", () => {
  assert.deepEqual(
    parseLocalFlags(["--local", "--rollback", SHA, "--images-file", "-"]),
    {
      local: { imagesFile: "-", rollback: SHA },
    },
  );
  assert.match(
    parseLocalFlags(["--local", "--images-file", "-", "--rollback"]).error,
    /full 40-hex/,
  );
  assert.match(
    parseLocalFlags([
      "--local",
      "--images-file",
      "-",
      "--rollback",
      SHA.slice(0, 12),
    ]).error,
    /full 40-hex/,
  );
  assert.match(
    parseLocalFlags([
      "--local",
      "--images-file",
      "-",
      "--rollback",
      SHA,
      "--ref",
      SHA,
    ]).error,
    /takes no other flag/,
  );
  assert.match(
    parseLocalFlags([
      "--local",
      "--images-file",
      "-",
      "--rollback",
      SHA,
      "--rollback",
      SHA,
    ]).error,
    /takes no other flag/,
  );
});

test("2987: the box-side rollback moves production only backwards (compare <live>...<sha> = behind)", () => {
  const live = "d".repeat(40);
  assert.deepEqual(
    rollbackTargetVerdict({ live, sha: SHA, status: "behind" }),
    { ok: true },
  );
  for (const status of ["ahead", "identical", "diverged", null]) {
    const v = rollbackTargetVerdict({ live, sha: SHA, status });
    assert.equal(v.ok, false, String(status));
    assert.match(v.reason, /not behind the live prod SHA dddddddddddd/);
  }
  assert.match(
    rollbackTargetVerdict({ live: null, sha: SHA, status: null }).reason,
    /unknown/,
  );
});

test("2987: the target tree is fetched from codeload into a directory of its own; a failed fetch is no tree", async () => {
  const base = mkdtempSync(join(tmpdir(), "ds-target-tree-"));
  try {
    const failed = await fetchTargetTree(SHA, {
      dir: join(base, "a"),
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    assert.equal(failed, null, "an HTTP error");
    const thrown = await fetchTargetTree(SHA, {
      dir: join(base, "b"),
      fetchImpl: async () => {
        throw new Error("network");
      },
    });
    assert.equal(thrown, null, "a network error");
    let asked;
    const notTar = await fetchTargetTree(SHA, {
      dir: join(base, "c"),
      fetchImpl: async (url) => {
        asked = url;
        return {
          ok: true,
          arrayBuffer: async () =>
            Buffer.from("not a tarball"),
        };
      },
    });
    assert.equal(notTar, null, "an archive tar cannot read");
    assert.equal(
      asked,
      `https://codeload.github.com/doctor-school/ds-platform/tar.gz/${SHA}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "2987: a fetched tarball is extracted with its top directory stripped",
  { skip: spawnSync("tar", ["--version"]).status !== 0 && "no tar" },
  async () => {
    const base = mkdtempSync(join(tmpdir(), "ds-target-tree-"));
    try {
      const src = join(base, "src", `ds-platform-${SHA}`, "apps/api/drizzle");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "0036_speaker_cutover.sql"), "-- cutover");
      const archive = join(base, "t.tar.gz");
      const tar = spawnSync("tar", [
        "czf",
        archive,
        "-C",
        join(base, "src"),
        `ds-platform-${SHA}`,
      ]);
      if (tar.status !== 0) return;
      const bytes = readFileSync(archive);
      const dir = await fetchTargetTree(SHA, {
        dir: join(base, "tree"),
        fetchImpl: async () => ({
          ok: true,
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.length,
            ),
        }),
      });
      assert.equal(dir, join(base, "tree"));
      assert.equal(
        readFileSync(
          join(dir, "apps/api/drizzle/0036_speaker_cutover.sql"),
          "utf8",
        ),
        "-- cutover",
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

// --- #3313: ds-data-prod only through its verbs ----------------------------------------
import {
  DATA_VERBS,
  createDataProdClient,
  dataVerbCommand,
  servesDataVerbs,
} from "./lib/data-prod.mjs";
import { dataProdEnvPayload, dataProdExcept } from "./prod.mjs";
import { BOX_ENTRYPOINTS } from "./lib/remote.mjs";

const SHA_3313 = "0123456789abcdef0123456789abcdef01234567";
const CAPABILITIES = JSON.stringify({ role: "data", verbs: DATA_VERBS });

test("3313: a data-prod request is the ssh command itself, or the same request through sudo -n", () => {
  assert.equal(dataVerbCommand(`ship ${SHA_3313}`, "forced"), `ship ${SHA_3313}`);
  assert.equal(
    dataVerbCommand(`finish ${SHA_3313} failed`, "sudo"),
    `sudo -n env SSH_ORIGINAL_COMMAND='finish ${SHA_3313} failed' /usr/local/bin/ds-deploy-entrypoint`,
  );
  assert.equal(dataVerbCommand(`status prod ${SHA_3313}`, "forced"), `status prod ${SHA_3313}`);
  for (const bad of ["ship x'; id", "ship  x", "upload-report x", "release prod x", "check\nid", ""]) {
    assert.throws(() => dataVerbCommand(bad, "forced"), bad);
  }
  assert.throws(() => dataVerbCommand("capabilities", "shell"), /unknown data-prod command form/);
});

test("3313: only the data box's full capabilities answer counts", () => {
  assert.equal(servesDataVerbs(CAPABILITIES), true);
  assert.equal(servesDataVerbs(JSON.stringify({ role: "prod", verbs: DATA_VERBS })), false);
  assert.equal(servesDataVerbs(JSON.stringify({ role: "data", verbs: ["capabilities"] })), false);
  assert.equal(servesDataVerbs("bash: capabilities: command not found"), false);
});

function fakeDataProd(answers) {
  const calls = [];
  const run = async (host, command, options) => {
    calls.push({ host, command, input: options?.input });
    const answer = answers(command, calls.length);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, run };
}

test("3313: the hop's forced command answers, and every verb goes bare", async () => {
  const fake = fakeDataProd((command) => (command === "capabilities" ? CAPABILITIES : "ok"));
  const client = createDataProdClient({ host: "deploy@vpc", form: "forced", run: fake.run });
  assert.equal(await client.call(["postgres-checkpoint"], { input: "{}" }), "ok");
  await client.call(["install", SHA_3313]);
  assert.deepEqual(
    fake.calls.map((c) => c.command),
    ["capabilities", "postgres-checkpoint", `install ${SHA_3313}`],
  );
  assert.equal(fake.calls[1].input, "{}");
  assert.equal(client.knownCommand(["finish", SHA_3313, "failed"]), `finish ${SHA_3313} failed`);
});

test("3320: the workstation's breakglass shell login runs the same verbs through sudo -n, never the forced form", async () => {
  const fake = fakeDataProd((command) => {
    if (command === "capabilities") return assert.fail("the forced form is not asked from a shell login");
    if (command.includes("SSH_ORIGINAL_COMMAND='capabilities'")) return CAPABILITIES;
    return "ok";
  });
  const client = createDataProdClient({ host: "ds-data-prod", form: "sudo", run: fake.run });
  assert.equal(client.knownCommand(["finish", SHA_3313, "failed"]), null, "nothing known before the probe");
  await client.call(["backup-info"]);
  assert.deepEqual(
    fake.calls.map((c) => c.command),
    [
      "sudo -n env SSH_ORIGINAL_COMMAND='capabilities' /usr/local/bin/ds-deploy-entrypoint",
      "sudo -n env SSH_ORIGINAL_COMMAND='backup-info' /usr/local/bin/ds-deploy-entrypoint",
    ],
  );
});

test("3320: a --local run whose forced command does not answer refuses — no sudo attempt, no install", async () => {
  const fake = fakeDataProd((command) => (command === "capabilities" ? new Error("exited 2") : CAPABILITIES));
  const client = createDataProdClient({ host: "deploy@vpc", form: "forced", run: fake.run, log: () => {} });
  await assert.rejects(client.call(["check"]), /serves no data-prod verbs through the forced command/);
  await assert.rejects(client.converge(SHA_3313), /serves no data-prod verbs through the forced command/);
  assert.deepEqual(
    fake.calls.map((c) => c.command),
    ["capabilities", "capabilities"],
    "only the forced form is asked; no other command reaches the box",
  );
  assert.equal(client.knownCommand(["finish", SHA_3313, "failed"]), null);
});

test("3320: a client takes exactly one known command form", () => {
  for (const form of [undefined, "shell", "detect"]) {
    assert.throws(() => createDataProdClient({ host: "deploy@vpc", form }), /unknown data-prod command form/);
  }
});

// --- #3320: the release converges ds-data-prod itself -------------------------------
// The box proves the converge: every release runs the `converge <sha>` verb (the
// installed harden-ssh.sh --role data --from-release, which prints `nothing to change`
// once done), so a converge that stopped after the hop line went behind the forced
// command is finished by the next release instead of being read as converged.
const CONVERGE_FORCED = `converge ${SHA_3313}`;

test("3320: the forced command answering is not proof: an interrupted converge is finished by the next release", async () => {
  // Interrupted state: the hop line is already forced, deploy still holds the
  // cloud-init rule and its groups. Only the box can tell; the release asks it.
  let narrowed = false;
  const fake = fakeDataProd((command) => {
    if (command === CONVERGE_FORCED) {
      narrowed = true;
      return "harden-ssh: remove deploy's rule from /etc/sudoers.d/90-cloud-init-users";
    }
    if (command === "capabilities") return CAPABILITIES;
    if (command.includes("'capabilities'")) return new Error("exited 2");
    return "ok";
  });
  const lines = [];
  const client = createDataProdClient({ host: "deploy@vpc", form: "forced", run: fake.run, log: (l) => lines.push(l) });
  await client.converge(SHA_3313);
  assert.equal(narrowed, true, "the converge verb ran through the forced command");
  const commands = fake.calls.map((c) => c.command);
  assert.deepEqual(commands, ["capabilities", CONVERGE_FORCED, "capabilities"]);
  assert.doesNotMatch(lines.join("\n"), /already converged/);
  assert.match(lines.join("\n"), /converge .*harden-ssh\.sh --role data --from-release, through the forced command/);
  assert.match(lines.join("\n"), /converged: capabilities answers through the forced command/);
});

test("3320: a converged box runs the converge verb on every release and goes on when it changes nothing", async () => {
  const fake = fakeDataProd((command) => {
    if (command === CONVERGE_FORCED) return "harden-ssh: nothing to change";
    return command === "capabilities" ? CAPABILITIES : new Error("exited 2");
  });
  const client = createDataProdClient({ host: "deploy@vpc", form: "forced", run: fake.run, log: () => {} });
  await client.converge(SHA_3313);
  assert.deepEqual(fake.calls.map((c) => c.command), ["capabilities", CONVERGE_FORCED, "capabilities"]);
  assert.equal(client.knownCommand(["data-env"]), "data-env");
});

test("3320: the breakglass sudo form never converges ds-data-prod", async () => {
  const fake = fakeDataProd(() => CAPABILITIES);
  const client = createDataProdClient({ host: "ds-data-prod", form: "sudo", run: fake.run, log: () => {} });
  await assert.rejects(client.converge(SHA_3313), /only the hop's forced command converges/);
  assert.deepEqual(fake.calls, [], "nothing reaches the box");
});

test("3320: a failed converge, or one after which the forced command does not answer, fails the run", async () => {
  const refused = fakeDataProd((command) => {
    if (command === CONVERGE_FORCED) return new Error("converge on deploy@vpc exited 1: harden-ssh: no user breakglass");
    return command === "capabilities" ? CAPABILITIES : "ok";
  });
  const a = createDataProdClient({ host: "deploy@vpc", form: "forced", run: refused.run, log: () => {} });
  await assert.rejects(a.converge(SHA_3313), /no user breakglass/);
  assert.equal(a.knownCommand(["finish", SHA_3313, "failed"]), `finish ${SHA_3313} failed`, "finish … failed still lands");
  assert.equal(await a.call(["finish", SHA_3313, "failed"]), "ok");
  let converged = false;
  const unchanged = fakeDataProd((command) => {
    if (command === CONVERGE_FORCED) {
      converged = true;
      return "";
    }
    return command === "capabilities" && !converged ? CAPABILITIES : new Error("exited 255");
  });
  const b = createDataProdClient({ host: "deploy@vpc", form: "forced", run: unchanged.run, log: () => {} });
  await assert.rejects(b.converge(SHA_3313), /the forced command does not answer after the converge/);
  await assert.rejects(b.call(["data-env"]), /the forced command does not answer after the converge/, "no verb runs after it");
  assert.equal(b.knownCommand(["finish", SHA_3313, "failed"]), null);
});

test("3320: a failed converge after which the forced command does not answer leaves no verb to run", async () => {
  let ran = false;
  const fake = fakeDataProd((command) => {
    if (command === CONVERGE_FORCED) {
      ran = true;
      return new Error("converge on deploy@vpc exited 1");
    }
    return command === "capabilities" && !ran ? CAPABILITIES : new Error("exited 255");
  });
  const client = createDataProdClient({ host: "deploy@vpc", form: "forced", run: fake.run, log: () => {} });
  await assert.rejects(client.converge(SHA_3313), /converge on deploy@vpc exited 1/);
  assert.equal(client.knownCommand(["finish", SHA_3313, "failed"]), null);
  await assert.rejects(client.call(["check"]), /the forced command does not answer after the failed converge/);
});

test("3320: the probe requires every data verb, the converge verb included", () => {
  assert.ok(DATA_VERBS.includes("converge"));
  const before = DATA_VERBS.filter((v) => v !== "converge");
  assert.equal(servesDataVerbs(JSON.stringify({ role: "data", verbs: before })), false);
});

test("3320: the data install places harden-ssh.sh root-owned beside the entrypoints", () => {
  assert.ok(
    BOX_ENTRYPOINTS.some(({ dest, path }) => dest === "/usr/local/lib/ds-platform/harden-ssh.sh" && path === "infra/deploy/bin/harden-ssh.sh"),
  );
});

test("3320: the --local release converges ds-data-prod after its install and before any data-prod state change", () => {
  const source = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
  const install = source.indexOf('await dataProd().call(["install", sha]);');
  const converge = source.indexOf("if (local) await dataProd().converge(sha);");
  const env = source.indexOf('walk.phase("data-prod-env");');
  assert.ok(install > 0 && converge > install && env > converge, "install → converge → data-prod-env");
});

test("3313: prod.mjs reaches ds-data-prod only through its verbs — no script, no shell form", () => {
  const source = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
  assert.doesNotMatch(source, /(sshScript|sshCapture|boxStep)\(\s*DATA_PROD\b/);
  assert.doesNotMatch(source, /shipTree\(sha, DATA_PROD\)/);
  assert.doesNotMatch(source, /postgresStateScript\(/);
  assert.doesNotMatch(source, /postgresProbeScript\(/);
  const check = readFileSync(join(import.meta.dirname, "postgres-artifact-check.mjs"), "utf8");
  assert.match(check, /createDataProdClient\(/, "the operator check uses the data verbs");
  assert.doesNotMatch(check, /bash|spawnSync|capture/, "the operator check keeps no shell transport");
  for (const verb of ["postgres-checkpoint", "install", "data-env", "backup-info", "rollback-floor", "finish", "check", "supersede"]) {
    assert.ok(source.includes(`dataProd().call(["${verb}"`), verb);
  }
  assert.match(source, /dataProd\(\)\.command\(\["ship", sha\]\)/);
  assert.match(source, /\(client \?\? dataProd\(\)\)\.call\(\["postgres-probe"\]/);
});

test("3313: the data-env payload carries the VPC address and the immutable image ids only", () => {
  const live = { targetImages: { postgres: { id: `sha256:${"b".repeat(64)}` }, pgbackrest: { id: `sha256:${"c".repeat(64)}` } } };
  assert.deepEqual(JSON.parse(dataProdEnvPayload(live, "192.168.0.10")), {
    vpcIp: "192.168.0.10",
    images: { postgres: live.targetImages.postgres.id, pgbackrest: live.targetImages.pgbackrest.id },
  });
  assert.deepEqual(dataProdExcept({}), []);
  assert.deepEqual(dataProdExcept({ exceptUnit: "ds-prod-0123456789ab-rollback" }), ["ds-prod-0123456789ab-rollback"]);
});

test("3320: only --local takes the forced form; the workstation path keeps breakglass's sudo -n", () => {
  const source = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
  assert.match(source, /^let DATA_PROD_FORM = "sudo";$/m);
  assert.equal(source.match(/DATA_PROD_FORM = "forced";/g)?.length, 1);
  const useLocal = source.slice(source.indexOf("function useLocalHosts()"));
  assert.match(useLocal.slice(0, useLocal.indexOf("\n}\n")), /DATA_PROD_FORM = "forced";/);
  assert.match(source, /createDataProdClient\(\{ host: DATA_PROD, form: DATA_PROD_FORM \}\)/);
  assert.doesNotMatch(source, /bootstrapSources|treeReleaseSources/);
  const check = readFileSync(join(import.meta.dirname, "postgres-artifact-check.mjs"), "utf8");
  assert.match(check, /form: "sudo"/, "the operator check logs in as breakglass");
});
