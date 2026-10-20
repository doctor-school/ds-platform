// tools/deploy/prod-durable.test.mjs — `pnpm deploy:prod` runs every long box step
// through ds-release (Issue #2982; tech spec 2026-10-16 release pipeline §5).
// prod.mjs's `deploy()` is one long ssh-driven function with no injectable seam,
// so its wiring is pinned on the source text, the way prod-images.test.mjs pins
// the pull-not-build order; the units themselves are tested in ds-release.test.mjs
// and lib/remote-durable.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
const deployBody = SOURCE.slice(
  SOURCE.indexOf("async function deploy("),
  SOURCE.indexOf("function cutReleaseAtDeployedSha("),
);

test("2982: data-prod up, the pre-migrate backup, the pull, migrate+up and the prune are durable units", () => {
  for (const [host, step] of [
    ["DATA_PROD", "up"],
    ["DATA_PROD", "backup"],
    ["API_PROD", "migrate"],
    ["API_PROD", "prune"],
  ]) {
    assert.match(
      deployBody,
      new RegExp(`boxStep\\(\\s*${host},\\s*sha,\\s*"${step}"`),
      `${host} ${step}`,
    );
  }
  assert.match(
    SOURCE,
    /if \(durable\) await boxStep\(API_PROD, sha, "pull", script, label\);/,
  );
  for (const streamed of [
    "migrateAndUpScript()",
    "retentionScript()",
    "backup.sh incr",
    "up -d --no-build --pull never",
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
  const install = deployBody.indexOf("releaseInstallScript()");
  const opened = deployBody.indexOf("openReleaseSha = sha;");
  const firstStep = deployBody.indexOf("boxStep(");
  const shipped = deployBody.indexOf("shipTree(sha, DATA_PROD)");
  const smoke = deployBody.indexOf("await runSmoke(sha, services);");
  const finish = deployBody.indexOf("await finishReleaseSucceeded(sha);");
  assert.ok(
    shipped > 0 && shipped < install && install < opened && opened < firstStep,
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
  const check = rollback.indexOf("releaseCheckScript(RELEASE_ENV)");
  const pull = rollback.indexOf('label: "rollback pull"');
  const up = rollback.search(/releaseSupersedeScript\(\s*RELEASE_ENV,/);
  assert.ok(check > 0, "a read-only live-unit check on both boxes");
  assert.ok(check < pull, "the check runs before the first state change");
  assert.ok(pull < up, "the up -d runs inside `ds-release supersede` (env lock held)");
  assert.match(rollback, /for \(const host of \[API_PROD, DATA_PROD\]\)[\s\S]{0,200}releaseCheckScript/);
  assert.match(rollback, /releaseSupersedeScript\(RELEASE_ENV\)[\s\S]{0,80}DATA_PROD|DATA_PROD[\s\S]{0,200}releaseSupersedeScript\(RELEASE_ENV\)/);
});

test("3054: the rollback installs ds-release on both boxes from the operator checkout before its first check", () => {
  const rollback = SOURCE.slice(SOURCE.indexOf("async function rollback("));
  const install = rollback.indexOf("releaseInstallFromSourceScript(");
  const check = rollback.indexOf("releaseCheckScript(RELEASE_ENV)");
  assert.ok(install > 0, "the rollback installs the entrypoint");
  assert.ok(install < check, "the install precedes the first ds-release call");
  const beforeCheck = rollback.slice(0, check);
  assert.doesNotMatch(beforeCheck, /releaseInstallScript\(|shipTree\(/, "never from a shipped tree");
  assert.match(
    beforeCheck,
    /for \(const host of \[API_PROD, DATA_PROD\]\)[\s\S]{0,200}releaseInstallFromSourceScript\(/,
  );
  assert.match(
    SOURCE,
    /const DS_RELEASE_SOURCE = join\(\s*import\.meta\.dirname,\s*"\.\.",\s*"\.\.",\s*"infra",\s*"deploy",\s*"bin",\s*"ds-release",?\s*\);/,
  );
  assert.match(beforeCheck, /readFileSync\(DS_RELEASE_SOURCE\)/);
});
