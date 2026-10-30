// tools/deploy/idp-lockout-policy.test.mjs — provision.sh step 8.octies: the
// Zitadel password lockout is OFF (003 EARS-15, #3539).
//
// A tripped Zitadel lockout appends `user.locked`, which deletes every Zitadel
// session of the person and refuses their refresh — so ten wrong guesses by
// anyone who knows the address sign the person out everywhere (lockout-DoS).
// Guessing is bounded by the EARS-13 windows and captcha instead, so the
// instance lockout policy must carry `maxPasswordAttempts = 0`.
//
// provision.sh is the one converge path of all three environments: the dev
// stand runs it directly, the stage box and `pnpm deploy:prod` run the target
// commit's copy (tools/deploy/idp-policy.mjs, tools/staging/idp.mjs). The step
// therefore must be unconditional — no environment branch can skip it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { test } from "node:test";

const source = readFileSync(
  new URL("../../infra/dev-stand/idp/provision.sh", import.meta.url),
  "utf8",
).replace(/\r/g, "");
const helpers = source.slice(
  source.indexOf("api() {"),
  source.indexOf('echo "Provisioning Zitadel'),
);
const stepStart = source.indexOf("# ── 8.octies.");
const step = source.slice(stepStart, source.indexOf("# ── 9. MFA capability"));

/**
 * Run step 8.octies against a fake Admin API holding `initial` as the instance
 * lockout policy. `lagReads` GETs after a PUT still serve the pre-write row
 * (Zitadel's read model is an asynchronous projection); `applyAs` is what the
 * store records instead of the PUT body.
 */
async function provisionLockout({ initial, lagReads = 0, applyAs }) {
  let stored = { ...initial };
  let served = { ...initial };
  let pendingLag = 0;
  const puts = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url !== "/admin/v1/policies/lockout") {
        res.statusCode = 404;
        res.end('{"code":5}');
        return;
      }
      if (req.method === "PUT") {
        const written = JSON.parse(body);
        puts.push(written);
        stored = applyAs ?? written;
        pendingLag = lagReads;
        res.end('{"details":{"sequence":"11"}}');
        return;
      }
      if (pendingLag > 0) pendingLag -= 1;
      else served = stored;
      // proto3 JSON: a zero uint is omitted, a uint64 is a string.
      const policy = { isDefault: true };
      for (const [k, v] of Object.entries(served)) if (v) policy[k] = String(v);
      res.end(JSON.stringify({ policy }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.platform === "win32"
          ? "C:/Program Files/Git/bin/bash.exe" // no-hardcoded-path-ok: fixture requires Git Bash rather than WSL bash on Windows
          : "bash",
        ["--noprofile", "--norc", "-s"],
        {
          env: {
            ...process.env,
            BASE_URL: `http://127.0.0.1:${server.address().port}`,
            PAT_VALUE: "fixture-token",
          },
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      // Advance only this shell's clock on a wait; no real test wait.
      child.stdin.end(
        `set -euo pipefail\nsleep() { SECONDS=$((SECONDS+1)); }\n${helpers}\n${step}\nprintf 'SUCCESS\\n'\n`,
      );
    });
    return { ...result, puts };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("003 EARS-15: the lockout step is in provision.sh, before step 9, and no environment branch gates it", () => {
  assert.ok(stepStart > 0, "provision.sh has no step 8.octies");
  assert.ok(step.includes("/admin/v1/policies/lockout"));
  assert.doesNotMatch(
    step,
    /\b(ENVIRONMENT|DEPLOY_ENV|STAGE|PROD|NODE_ENV|IDP_ENV)\b/,
    "the lockout step must not branch on the environment",
  );
});

test("003 EARS-15: an instance with a password lockout converges to maxPasswordAttempts = 0, keeping the OTP setting", async () => {
  const result = await provisionLockout({
    initial: { maxPasswordAttempts: 10, maxOtpAttempts: 5 },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS/);
  assert.deepEqual(result.puts, [
    { maxPasswordAttempts: 0, maxOtpAttempts: 5 },
  ]);
  assert.match(
    result.stderr,
    /lockout policy: read-back ok \(maxPasswordAttempts=0\)/,
  );
});

test("003 EARS-15: an instance already at maxPasswordAttempts = 0 is not written", async () => {
  const result = await provisionLockout({ initial: {} });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.puts, []);
  assert.match(
    result.stderr,
    /lockout policy: read-back ok \(maxPasswordAttempts=0\)/,
  );
});

test("003 EARS-15: a read model that lags the write is re-read until it shows the write", async () => {
  const result = await provisionLockout({
    initial: { maxPasswordAttempts: 10 },
    lagReads: 2,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /read-back ok/);
});

test("003 EARS-15: a write that leaves a password lockout in force fails the run (fail-closed)", async () => {
  const result = await provisionLockout({
    initial: { maxPasswordAttempts: 10 },
    applyAs: { maxPasswordAttempts: 10 },
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /SUCCESS/);
  assert.match(result.stderr, /FATAL: lockout policy read-back/);
});
