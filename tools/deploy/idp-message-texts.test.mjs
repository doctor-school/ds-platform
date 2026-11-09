// tools/deploy/idp-message-texts.test.mjs — provision.sh writes the custom
// message texts encoding-safely (#3595).
//
// A run from a shell that cannot carry non-ASCII arguments (Windows-native jq /
// argv conversion) turned the Cyrillic copy into `?` and the em-dash into an
// invalid byte, and Zitadel stored the mangled text without complaint (#877 on
// verifysmsotp/ru, #3595 on passwordreset/ru). Two guards close that:
//   - a pre-flight round-trips a Cyrillic + em-dash sample through the same
//     `jq -nc --arg` path the writes use and refuses to run on a mismatch,
//     before the first write;
//   - every message-text write is read back and compared with its source;
//     a difference fails the run, naming the type and language.
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
const preflightStart = source.indexOf("# ── pre-flight: non-ASCII round-trip");
const preflight = source.slice(
  preflightStart,
  source.indexOf("# ── pre-flight: delivery-mode"),
);

const bash =
  process.platform === "win32"
    ? "C:/Program Files/Git/bin/bash.exe" // no-hardcoded-path-ok: fixture requires Git Bash rather than WSL bash on Windows
    : "bash";

function runBash(script, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bash, ["--noprofile", "--norc", "-s"], {
      env: { ...process.env, ...env },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(script);
  });
}

// Simulates the Windows argv conversion: every non-ASCII byte of every jq
// argument arrives as `?`.
const manglingJq = `jq() {
  local a out=()
  for a in "$@"; do out+=("$(printf '%s' "$a" | LC_ALL=C tr '\\200-\\377' '?')"); done
  command jq "\${out[@]}"
}
`;

/**
 * Run `script` (after the provision.sh helpers) against a fake Admin API for
 * message texts. `mangle` rewrites what the store records for a PUT; `lagReads`
 * GETs after a PUT still serve the previous row (asynchronous read model).
 */
async function provisionTexts(script, { mangle, lagReads = 0 } = {}) {
  const stored = new Map();
  const served = new Map();
  let pendingLag = 0;
  const puts = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const match = /^\/admin\/v1\/text\/message\/([a-z]+)\/([a-z]+)$/.exec(
        req.url,
      );
      if (!match) {
        res.statusCode = 404;
        res.end('{"code":5}');
        return;
      }
      const key = `${match[1]}/${match[2]}`;
      if (req.method === "PUT") {
        const written = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        puts.push({ key, written });
        stored.set(key, mangle ? mangle(written) : written);
        pendingLag = lagReads;
        res.end('{"details":{"sequence":"7"}}');
        return;
      }
      if (pendingLag > 0) pendingLag -= 1;
      else served.set(key, stored.get(key));
      res.end(
        JSON.stringify({
          customText: { ...(served.get(key) ?? {}), language: match[2] },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runBash(
      `set -euo pipefail\nsleep() { SECONDS=$((SECONDS+1)); }\n${helpers}\n${script}\nprintf 'SUCCESS\\n'\n`,
      {
        BASE_URL: `http://127.0.0.1:${server.address().port}`,
        PAT_VALUE: "fixture-token",
      },
    );
    return { ...result, puts };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const RU_RESET =
  "Doctor.School: код для сброса пароля - {{.Code}}, никому его не сообщайте";

test("#3595: every message-text write in provision.sh goes through the read-back helper", () => {
  const writes = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .filter(
      (line) =>
        line.includes("/admin/v1/text/message/") && /\bPUT\b/.test(line),
    );
  const raw = writes.filter((line) => !line.includes("put_message_text"));
  assert.ok(
    source.includes("put_message_text verifysmsotp ru") &&
      source.includes("put_message_text passwordreset ru"),
    "the message texts are written via put_message_text",
  );
  assert.deepEqual(raw, [], "a message-text PUT bypasses put_message_text");
});

test("#3595: the non-ASCII pre-flight runs before step 0 and passes in a UTF-8-safe shell", async () => {
  assert.ok(preflightStart > 0, "provision.sh has no non-ASCII pre-flight");
  assert.ok(
    preflightStart < source.indexOf("# ── 0. instance-identity pre-flight"),
    "the pre-flight must run before the first Admin API call",
  );
  const result = await runBash(
    `set -euo pipefail\n${preflight}\nprintf 'SUCCESS\\n'\n`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS/);
});

test("#3595: a shell whose jq mangles non-ASCII arguments is refused before any write", async () => {
  const result = await runBash(
    `set -euo pipefail\n${manglingJq}${preflight}\nprintf 'SUCCESS\\n'\n`,
  );
  assert.equal(result.status, 4);
  assert.doesNotMatch(result.stdout, /SUCCESS/);
  assert.match(result.stderr, /FATAL: this shell mangles non-ASCII/);
  assert.match(result.stderr, /Linux\/macOS/);
});

test("#3595: a correct write reads back and the run continues", async () => {
  const result = await provisionTexts(
    `put_message_text passwordreset ru "reset SMS text" text '${RU_RESET}'\n` +
      `put_message_text init ru "neutral greeting" greeting 'Здравствуйте!'`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS/);
  assert.deepEqual(result.puts, [
    { key: "passwordreset/ru", written: { text: RU_RESET } },
    { key: "init/ru", written: { greeting: "Здравствуйте!" } },
  ]);
  assert.match(
    result.stderr,
    /ensured passwordreset\/ru reset SMS text \(read-back ok\)/,
  );
});

test("#3595: a read model that lags the write is re-read until it shows the write", async () => {
  const result = await provisionTexts(
    `put_message_text passwordreset ru "reset SMS text" text '${RU_RESET}'`,
    { lagReads: 2 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /read-back ok/);
});

test("#3595: a stored text that differs from the source fails the run, naming type and language", async () => {
  const result = await provisionTexts(
    `put_message_text passwordreset ru "reset SMS text" text '${RU_RESET}'`,
    { mangle: (w) => ({ ...w, text: w.text.replace(/\P{ASCII}/gu, "?") }) },
  );
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /SUCCESS/);
  assert.match(
    result.stderr,
    /FATAL: message text passwordreset\/ru read-back/,
  );
});

test("#3595: every field a multi-field write sets is compared", async () => {
  const result = await provisionTexts(
    `put_message_text verifyemailotp ru "login-OTP email" subject '{{.OTP}} — код' text 'Ваш код'`,
    { mangle: (w) => ({ ...w, subject: "{{.OTP}} ? ???" }) },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /FATAL: message text verifyemailotp\/ru read-back.*subject/,
  );
});
