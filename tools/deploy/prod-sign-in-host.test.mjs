// tools/deploy/prod-sign-in-host.test.mjs — Issue #3171: the sign-in host in
// production (ADR-0015 §4). The api's sign-in-host module needs the storefront
// client ids the pre-swap IdP converge reads back, the smoke probes the new vhost
// only for a target that ships it, and the release refuses to run without the
// owner-placed record key — counted on the box, never printed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  apiEnvRecordKeyProbeScript,
  apiEnvRecordKeyVerdict,
  smokeEnvFor,
  storefrontClientIdsEnvScript,
} from "./prod.mjs";
import { OPTIONAL_VHOST_PROBES, isLoginProbeSkipped } from "./smoke-prod.mjs";

const bash = spawnSync("bash", ["-c", "command -v grep && command -v mv"], { encoding: "utf8" });
const SKIP_SHELL = bash.status !== 0 && "needs bash";

test("3171: the converge's storefront client ids land in the compose .env; other lines survive", { skip: SKIP_SHELL }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-3171-"));
  try {
    writeFileSync(join(dir, ".env"), "DEPLOY_SHA=abc\nSMARTCAPTCHA_SITE_KEY=ysc1\nIDP_ACADEMY_CLIENT_ID=stale\n");
    writeFileSync(
      join(dir, "ids"),
      "IDP_CLIENT_ID=headless\nIDP_ACADEMY_CLIENT_ID=111@ds\nIDP_DOCTOR_CLIENT_ID=222@ds\n",
    );
    const run = spawnSync("bash", ["-c", storefrontClientIdsEnvScript("ids")], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      readFileSync(join(dir, ".env"), "utf8"),
      "DEPLOY_SHA=abc\nSMARTCAPTCHA_SITE_KEY=ysc1\nIDP_ACADEMY_CLIENT_ID=111@ds\nIDP_DOCTOR_CLIENT_ID=222@ds\n",
    );
    // A converge that printed no storefront pair fails the deploy pre-swap: the api
    // would otherwise boot with its sign-in host disabled.
    writeFileSync(join(dir, "ids"), "IDP_CLIENT_ID=headless\n");
    const refused = spawnSync("bash", ["-c", storefrontClientIdsEnvScript("ids")], { cwd: dir, encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.match(readFileSync(join(dir, ".env"), "utf8"), /IDP_DOCTOR_CLIENT_ID=222@ds/, ".env untouched on refusal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("3171: the smoke probes the sign-in host only for a target that ships ds-login", () => {
  assert.equal(OPTIONAL_VHOST_PROBES["ds-login"], "PROD_LOGIN_HOST");
  const all = ["ds-api", "ds-portal", "ds-admin", "ds-doctor", "ds-login"].map((image) => ({ image }));
  assert.equal(smokeEnvFor(all, {}).PROD_LOGIN_HOST, undefined);
  const preLogin = all.filter((s) => s.image !== "ds-login");
  assert.equal(smokeEnvFor(preLogin, {}).PROD_LOGIN_HOST, "skip");
  assert.equal(smokeEnvFor(preLogin, {}).PROD_DOCTOR_HOST, undefined);
  assert.equal(isLoginProbeSkipped(undefined), false, "probe-on by default");
  assert.equal(isLoginProbeSkipped("skip"), true);
});

test("3171: the record key probe counts SIGN_IN_RECORD_KEY assignments and never prints the file", () => {
  const script = apiEnvRecordKeyProbeScript();
  assert.match(script, /grep -cE/);
  assert.doesNotMatch(script, /\bcat\b/);
  assert.equal(apiEnvRecordKeyVerdict("api-env=readable\nrecord-key-lines=1\n").ok, true);
  for (const output of ["api-env=readable\nrecord-key-lines=0\n", "api-env=unreadable\n", "", "garbage"]) {
    const verdict = apiEnvRecordKeyVerdict(output);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /SIGN_IN_RECORD_KEY/);
  }
});
