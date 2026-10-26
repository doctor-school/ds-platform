// tools/deploy/prod-durable.test.mjs — `pnpm deploy:prod` runs every long box step
// through ds-release (Issue #2982; tech spec 2026-10-16 release pipeline §5).
// prod.mjs's `deploy()` is one long ssh-driven function with no injectable seam,
// so its wiring is pinned on the source text, the way prod-images.test.mjs pins
// the pull-not-build order; the units themselves are tested in ds-release.test.mjs
// and lib/remote-durable.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { committedReleaseSource, committedReleaseSources } from "./prod.mjs";

const SOURCE = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
const deployBody = SOURCE.slice(
  SOURCE.indexOf("async function deploy("),
  SOURCE.indexOf("function cutReleaseAtDeployedSha("),
);

test("2982: data-prod up, the pre-migrate backup, the pull, migrate+up and the prune are durable units", () => {
  for (const step of ["migrate", "prune"]) {
    assert.match(deployBody, new RegExp(`boxStep\\(\\s*API_PROD,\\s*sha,\\s*"${step}"`), step);
  }
  // #3313: ds-data-prod's units start through its verbs, their scripts fixed box-side.
  for (const step of ["up", "backup"]) {
    assert.match(deployBody, new RegExp(`dataProdStep\\(sha, "${step}",`), step);
  }
  for (const boxSide of ["backup.sh incr", "up -d --no-build --pull never", "pgbackrest --stanza=ds info"]) {
    assert.ok(!SOURCE.includes(boxSide), `${boxSide} lives in ds-deploy-entrypoint only`);
  }
  assert.match(
    SOURCE,
    /if \(durable\) await boxStep\(API_PROD, sha, "pull", script, label\);/,
  );
  for (const streamed of [
    "migrateAndUpScript()",
    "retentionScript()",
  ]) {
    const at = deployBody.indexOf(streamed);
    assert.ok(at > 0, streamed);
    assert.doesNotMatch(
      deployBody.slice(Math.max(0, at - 400), at),
      /sshScript\(\s*(API_PROD|DATA_PROD)[^)]*$/,
      `${streamed} is no longer streamed`,
    );
  }
});

test("2982: the entrypoint is installed after the ship, the release opened, and closed only after the smoke", () => {
  const install = deployBody.indexOf("releaseInstallScript(PROD_LIVE_TREE, { sha })");
  const opened = deployBody.indexOf("openReleaseSha = sha;");
  const firstStep = deployBody.search(/boxStep\(|dataProdStep\(/);
  const shipped = deployBody.indexOf("shipDataProd(sha)");
  const dataInstall = deployBody.indexOf('dataProd().call(["install", sha])');
  const smoke = deployBody.indexOf("await runSmoke(sha, services);");
  const finish = deployBody.indexOf("await finishReleaseSucceeded(sha);");
  assert.ok(
    shipped > 0 && shipped < install && install < dataInstall && dataInstall < opened && opened < firstStep,
  );
  assert.ok(smoke > 0 && smoke < finish);
  // Every failure exit — die() included — closes the open release as failed.
  assert.match(
    SOURCE,
    /function die\(msg[^\n]*\n[^\n]*\n {2}closeOpenReleaseAsFailed\(\);/,
  );
});

test("2982: the rollback pull stays streamed — never behind the lease of the release it reverts", () => {
  assert.match(
    SOURCE,
    /pullRecordedImages\(sha, images, \{ label: "rollback pull" \}\)/,
  );
});

test("2982: the rollback refuses while a box step still runs, then supersedes the release under the env lock", () => {
  const rollback = SOURCE.slice(SOURCE.indexOf("async function rollback("));
  const check = rollback.indexOf("releaseCheckScript(RELEASE_ENV, own)");
  const pull = rollback.indexOf('label: "rollback pull"');
  const up = rollback.search(/releaseSupersedeScript\(\s*RELEASE_ENV,/);
  assert.ok(check > 0, "a read-only live-unit check on both boxes");
  assert.ok(check < pull, "the check runs before the first state change");
  assert.ok(pull < up, "the up -d runs inside `ds-release supersede` (env lock held)");
  assert.match(rollback, /for \(const host of \[API_PROD, DATA_PROD\]\)[\s\S]{0,200}releaseCheckScript/);
  assert.match(rollback, /host === DATA_PROD\) await dataProd\(\)\.call\(\["check", \.\.\.dataProdExcept\(own\)\]\)/);
  assert.match(rollback, /dataProd\(\)\.call\(\["supersede", \.\.\.dataProdExcept\(own\)\]/);
});

test("2987: the box-side rollback is the same rollback(): it installs nothing, reads the fetched target tree and excludes only its own unit", () => {
  const rollback = SOURCE.slice(SOURCE.indexOf("async function rollback("), SOURCE.indexOf("// --- entry"));
  assert.match(rollback, /const own = local \? \{ exceptUnit: rollbackUnitName\(sha\) \} : \{\};/);
  // Every live-unit check and both supersedes carry `own`; nothing else does.
  assert.equal((rollback.match(/releaseCheckScript\(RELEASE_ENV, own\)/g) || []).length, 1);
  assert.match(
    rollback,
    /releaseSupersedeScript\(\s*RELEASE_ENV,[\s\S]{0,400}?\n\s*own,\n\s*\),\s*\{ label: "rollback up" \}/,
  );
  // The install is the workstation path's alone.
  assert.match(rollback, /if \(!local\) \{\s*let releaseSources;/);
  // The target's files come from its fetched tree, the floor without git; a failed
  // fetch refuses before the first box read.
  const fetchAt = rollback.indexOf("LOCAL_TREE = await fetchTargetTree(sha");
  assert.ok(fetchAt > 0 && fetchAt < rollback.indexOf("resolveTargetServiceSet(sha"));
  assert.match(rollback, /if \(!LOCAL_TREE\) \{\s*die\(/);
  assert.match(
    rollback,
    /local\s*\? makeTreeCutoverMigrationProbe\(LOCAL_TREE\)\s*: makeGitCutoverMigrationProbe\(localCap\)/,
  );
  // The pull takes the digests of the manifest the driver checked.
  assert.match(rollback, /const images = local \? localRelease\.images : await resolveProdImages\(sha\);/);
  // The box-side run refuses a forward move again, before the tree is fetched.
  assert.ok(rollback.indexOf("rollbackTargetVerdict(") < fetchAt);
});

test("3054/3313: the rollback installs ds-release on ds-api-prod from the operator checkout before its first check", () => {
  const rollback = SOURCE.slice(SOURCE.indexOf("async function rollback("));
  const install = rollback.indexOf("releaseInstallFromSourceScript(");
  const check = rollback.indexOf("releaseCheckScript(RELEASE_ENV, own)");
  assert.ok(install > 0, "the rollback installs the entrypoint");
  assert.ok(install < check, "the install precedes the first ds-release call");
  const beforeCheck = rollback.slice(0, check);
  assert.doesNotMatch(beforeCheck, /releaseInstallScript\(|shipTree\(/, "never from a shipped tree");
  // #3313: ds-data-prod takes no script; it keeps its last forward release's entrypoints.
  assert.match(beforeCheck, /sshScript\(API_PROD, releaseInstallFromSourceScript\(releaseSources\)/);
  assert.doesNotMatch(beforeCheck, /sshScript\(DATA_PROD/);
  assert.match(beforeCheck, /committedReleaseSources\(\)/, "the bytes are HEAD's blobs");
  assert.doesNotMatch(beforeCheck, /readFileSync\(/, "never the working-tree file");
  // A failed install names the host through die(), like the check loop.
  assert.match(
    beforeCheck,
    /releaseInstallFromSourceScript\([\s\S]{0,200}catch \(e\) \{\s*die\(\s*`--rollback: cannot install ds-release on \$\{API_PROD\}/,
  );
});

test("3054: the rollback's ds-release bytes are the committed blob, never an uncommitted edit", () => {
  const repo = mkdtempSync(join(tmpdir(), "ds-release-src-"));
  try {
    const git = (...args) => {
      const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    };
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    mkdirSync(join(repo, "infra", "deploy", "bin"), { recursive: true });
    const file = join(repo, "infra", "deploy", "bin", "ds-release");
    const committed = Buffer.concat([
      Buffer.from("#!/usr/bin/env bash\necho committed\n"),
      Buffer.from([0x00, 0xff]),
    ]);
    writeFileSync(file, committed);
    git("add", "infra/deploy/bin/ds-release");
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "c");
    writeFileSync(file, "#!/usr/bin/env bash\necho UNCOMMITTED\n");
    assert.ok(committedReleaseSource(repo).equals(committed), "HEAD's bytes, not the edited file");
    assert.throws(
      () => committedReleaseSource(repo, "no-such-ref"),
      /cannot read no-such-ref:infra\/deploy\/bin\/ds-release/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("3054: the operator checkout's HEAD carries the entrypoint the rollback installs", () => {
  const source = committedReleaseSource();
  assert.match(source.subarray(0, 64).toString("utf8"), /^#!\/usr\/bin\/env bash\n/);
});

test("2984/2985: the rollback installs every box entrypoint, each HEAD's blob", () => {
  const sources = committedReleaseSources();
  assert.deepEqual(
    sources.map(({ dest }) => dest),
    [
      "/usr/local/bin/ds-release",
      "/usr/local/bin/ds-deploy-entrypoint",
      "/usr/local/lib/ds-platform/release-driver",
      "/usr/local/lib/ds-platform/postgres-artifact-probe.py",
      "/usr/local/lib/ds-platform/harden-ssh.sh",
    ],
  );
  for (const { source } of sources.filter(({ dest }) => !dest.endsWith(".py"))) {
    assert.match(source.subarray(0, 64).toString("utf8"), /^#!\/usr\/bin\/env bash\n/);
  }
});
