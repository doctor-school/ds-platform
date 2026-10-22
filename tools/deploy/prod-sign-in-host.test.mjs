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
  API_SIGN_IN_ENV_FILE,
  INTERNAL_ENV_FILE,
  STOREFRONT_SECRET_NAMES,
  apiEnvRecordKeyProbeScript,
  apiEnvRecordKeyVerdict,
  provisionWritesStorefrontSecrets,
  storefrontSecretsProbeScript,
  storefrontSecretsVerdict,
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

// --- #3172: the storefront redeem secrets, split by who may read them ---

test("3172: the prod converge writes the keys to the api-only file and the token alone to internal.env", () => {
  const deploy = readFileSync(new URL("./prod.mjs", import.meta.url), "utf8");
  const start = deploy.indexOf("async function provisionIdp(");
  const command = deploy.slice(start, deploy.indexOf("./provision.sh --pat-file", start));
  assert.ok(command.includes("IDP_SECRET_ENV_FILE=${API_SIGN_IN_ENV_FILE}"));
  assert.ok(command.includes("IDP_INTERNAL_ENV_FILE=${INTERNAL_ENV_FILE}"));
  assert.ok(!command.includes("IDP_SECRET_ENV_FILE=${API_PROD_ENV_FILE}"), "never the api.env portal/doctor load");
  assert.equal(API_SIGN_IN_ENV_FILE, "/etc/ds-platform/api-sign-in.env");
  assert.equal(INTERNAL_ENV_FILE, "/etc/ds-platform/internal.env");
  const provision = readFileSync(new URL("../../infra/dev-stand/idp/provision.sh", import.meta.url), "utf8");
  assert.equal(provisionWritesStorefrontSecrets(provision), true);
  assert.equal(provisionWritesStorefrontSecrets('SECRET_ENV_FILE="${IDP_SECRET_ENV_FILE:-}"\n'), false);
  assert.equal(provisionWritesStorefrontSecrets("#!/usr/bin/env bash\nset -euo pipefail\n"), false);
});

test("3172: in the prod compose only the api mounts the client keys; portal and doctor get internal.env", () => {
  const compose = readFileSync(new URL("../../infra/deploy/compose/api-prod/compose.yml", import.meta.url), "utf8");
  const serviceBlock = (name) => {
    const start = compose.search(new RegExp(`^  ${name}:\\s*$`, "m"));
    assert.ok(start >= 0, `service ${name}`);
    const rest = compose.slice(start + 1);
    const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\s*$/m);
    return next < 0 ? rest : rest.slice(0, next);
  };
  const envFiles = (block) => /^\s+env_file:\s*\[([^\]]*)\]/m.exec(block)?.[1].split(",").map((f) => f.trim()) ?? [];
  assert.ok(envFiles(serviceBlock("api")).includes(API_SIGN_IN_ENV_FILE));
  for (const storefront of ["portal", "doctor"]) {
    const files = envFiles(serviceBlock(storefront));
    assert.ok(!files.includes(API_SIGN_IN_ENV_FILE), `${storefront} must not load the client keys`);
    assert.ok(files.includes(INTERNAL_ENV_FILE), `${storefront} loads internal.env`);
  }
  const elsewhere = compose
    .split(/^ {2}(?=[a-z][a-z0-9-]*:\s*$)/m)
    .filter((block) => !/^api:/.test(block))
    .filter((block) => block.includes(API_SIGN_IN_ENV_FILE));
  assert.deepEqual(elsewhere, [], "the api-only file is mounted by the api alone");
});

test("3172: the storefront secrets probe counts per file, compares tokens in-shell and never prints a value", { skip: SKIP_SHELL }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ds-3172-"));
  const at = (name) => join(dir, name).replace(/\\/g, "/");
  const files = { apiEnv: at("api.env"), signInEnv: at("api-sign-in.env"), internalEnv: at("internal.env") };
  const probe = () => {
    const script = storefrontSecretsProbeScript(files);
    assert.doesNotMatch(script, /\bcat\b/);
    const run = spawnSync("bash", ["-c", script.replace(/sudo /g, "")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /SECRET-|TOKEN-VALUE/);
    return run.stdout;
  };
  try {
    writeFileSync(files.apiEnv, "DATABASE_URL=postgres://x\n# IDP_ACADEMY_CLIENT_KEY=<tool-written>\n");
    writeFileSync(
      files.signInEnv,
      "IDP_ACADEMY_CLIENT_KEY=SECRET-A\nexport IDP_DOCTOR_CLIENT_KEY=SECRET-D\nINTERNAL_API_TOKEN=TOKEN-VALUE-1\n",
    );
    writeFileSync(files.internalEnv, "# token only\nINTERNAL_API_TOKEN=TOKEN-VALUE-1\n");
    let out = probe();
    assert.match(out, /^token-match=yes$/m);
    assert.match(out, /^internal:other=0$/m);
    assert.match(out, /^api:IDP_ACADEMY_CLIENT_KEY=0$/m);
    assert.match(out, /^sign-in:IDP_DOCTOR_CLIENT_KEY=1$/m);

    writeFileSync(files.internalEnv, "INTERNAL_API_TOKEN=TOKEN-VALUE-2\nIDP_ACADEMY_CLIENT_KEY=SECRET-A\n");
    writeFileSync(files.apiEnv, "IDP_DOCTOR_CLIENT_KEY=SECRET-D\n");
    out = probe();
    assert.match(out, /^token-match=no$/m);
    assert.match(out, /^internal:other=1$/m);
    assert.match(out, /^api:IDP_DOCTOR_CLIENT_KEY=1$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("3172: the storefront secrets verdict refuses any unreadable file, missing name, extra line, leaked key or token mismatch", () => {
  const good = [
    "sign-in=readable",
    ...STOREFRONT_SECRET_NAMES.map((name) => `sign-in:${name}=1`),
    "internal=readable",
    "internal:INTERNAL_API_TOKEN=1",
    "internal:other=0",
    "api=readable",
    "api:IDP_ACADEMY_CLIENT_KEY=0",
    "api:IDP_DOCTOR_CLIENT_KEY=0",
    "token-match=yes",
  ].join("\n");
  assert.deepEqual(storefrontSecretsVerdict(good), { ok: true });
  const cases = {
    "": /unreadable/,
    garbage: /unreadable/,
    [good.replace("internal=readable", "internal=unreadable")]: /internal\.env is unreadable/,
    [good.replace("sign-in:IDP_DOCTOR_CLIENT_KEY=1", "sign-in:IDP_DOCTOR_CLIENT_KEY=0")]: /api-sign-in\.env has no IDP_DOCTOR_CLIENT_KEY/,
    [good.replace("internal:INTERNAL_API_TOKEN=1", "internal:INTERNAL_API_TOKEN=0")]: /internal\.env has no INTERNAL_API_TOKEN/,
    [good.replace("internal:other=0", "internal:other=2")]: /holds more than INTERNAL_API_TOKEN/,
    [good.replace("api:IDP_ACADEMY_CLIENT_KEY=0", "api:IDP_ACADEMY_CLIENT_KEY=1")]: /api\.env \(loaded by portal and doctor\) carries IDP_ACADEMY_CLIENT_KEY/,
    [good.replace("token-match=yes", "token-match=no")]: /INTERNAL_API_TOKEN differs/,
  };
  for (const [output, reason] of Object.entries(cases)) {
    const verdict = storefrontSecretsVerdict(output);
    assert.equal(verdict.ok, false, output);
    assert.match(verdict.reason, reason);
  }
});
