// tools/deploy/idp-code-generators.test.mjs — provision.sh step 8.septies
// read-back against a Zitadel whose read model lags its writes (#2752).
//
// Zitadel is CQRS: a PUT /admin/v1/secretgenerators/{type} appends an event and
// returns that event's instance sequence in `details.sequence`; the GET reads an
// asynchronously updated projection whose row carries the sequence of the last
// event it applied. Right after a write the GET can still serve the previous
// row (CI runs 37760727588, 37723651738; reproduced on the dev stand: every
// stale read had `sequence` below the PUT's). The fake below models exactly
// that: the event store applies a PUT at once, the projection serves the old
// row for `lagReads` GETs of that generator.
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
const step = source.slice(
  source.indexOf("# ── 8.septies."),
  source.indexOf("# ── 9. MFA capability"),
);

const SMS = "SECRET_GENERATOR_TYPE_OTP_SMS";

/** A fresh instance: Zitadel's shipped defaults for the four generators. */
function freshInstance() {
  return {
    SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE: { length: 6, expiry: "3600s", includeUpperLetters: true, includeDigits: true },
    SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE: { length: 6, expiry: "3600s", includeUpperLetters: true, includeDigits: true },
    SECRET_GENERATOR_TYPE_OTP_EMAIL: { length: 8, expiry: "300s", includeDigits: true },
    [SMS]: { length: 8, expiry: "300s", includeDigits: true },
  };
}

/**
 * @param {object} o
 * @param {Record<string, object>} o.initial generator rows (projection == store)
 * @param {Record<string, number>} [o.lagReads] GETs per generator that still see the pre-write row
 * @param {Record<string, object>} [o.applyAs] what the store records instead of the PUT body
 */
async function provisionGenerators({ initial, lagReads = {}, applyAs = {} }) {
  let instanceSequence = 10;
  const store = {};
  const projection = {};
  for (const [type, row] of Object.entries(initial)) {
    store[type] = { ...row, sequence: instanceSequence };
    projection[type] = store[type];
  }
  const pendingLag = {};
  const puts = [];
  const server = createServer((req, res) => {
    const type = decodeURIComponent(req.url.split("/").pop());
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (!store[type]) {
        res.statusCode = 404;
        res.end('{"code":5}');
        return;
      }
      if (req.method === "PUT") {
        puts.push(type);
        instanceSequence += 1;
        const written = applyAs[type] ?? JSON.parse(body);
        store[type] = { ...written, sequence: instanceSequence };
        pendingLag[type] = lagReads[type] ?? 0;
        res.end(JSON.stringify({ details: { sequence: String(instanceSequence) } }));
        return;
      }
      if ((pendingLag[type] ?? 0) > 0) pendingLag[type] -= 1;
      else projection[type] = store[type];
      const { sequence, ...row } = projection[type];
      res.end(
        JSON.stringify({
          secretGenerator: { generatorType: type, details: { sequence: String(sequence) }, ...row },
        }),
      );
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
      // Advance only this shell's clock on a wait; no real deadline-long test wait.
      child.stdin.end(
        `set -euo pipefail\nsleep() { SECONDS=$((SECONDS+30)); }\n${helpers}\n${step}\nprintf 'SUCCESS\\n'\n`,
      );
    });
    return { ...result, puts, store };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("#2752: a read-back that lags the write waits for the write's sequence, then verifies the shape", async () => {
  const result = await provisionGenerators({ initial: freshInstance(), lagReads: { [SMS]: 2 } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS/);
  assert.equal(result.puts.length, 4);
  assert.match(result.stderr, new RegExp(`${SMS}: read-back ok \\(6 digits, expiry 300s\\)`));
  assert.doesNotMatch(result.stderr, /FATAL/);
});

test("#2752: a read model that never reaches the write's sequence fails as STALE, not as a mismatch", async () => {
  const result = await provisionGenerators({ initial: freshInstance(), lagReads: { [SMS]: 1e9 } });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /SUCCESS/);
  assert.match(result.stderr, new RegExp(`FATAL: ${SMS} read-back is STALE`));
  assert.doesNotMatch(result.stderr, /did NOT converge/);
});

test("#2752: an applied write that left the wrong shape fails as did NOT converge", async () => {
  const result = await provisionGenerators({
    initial: freshInstance(),
    applyAs: { [SMS]: { length: 8, expiry: "300s", includeDigits: true } },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`FATAL: ${SMS} read-back did NOT converge`));
  assert.doesNotMatch(result.stderr, /STALE/);
});

test("#2752: generators already at six digits are not written and read back ok", async () => {
  const digits = (expiry) => ({ length: 6, expiry, includeDigits: true });
  const result = await provisionGenerators({
    initial: {
      SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE: digits("3600s"),
      SECRET_GENERATOR_TYPE_PASSWORD_RESET_CODE: digits("3600s"),
      SECRET_GENERATOR_TYPE_OTP_EMAIL: digits("300s"),
      [SMS]: digits("300s"),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.puts, []);
  assert.equal((result.stderr.match(/read-back ok/g) ?? []).length, 4);
});
