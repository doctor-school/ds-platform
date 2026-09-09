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
const ensure = source.slice(
  source.indexOf("ensure_smtp_provider()"),
  source.indexOf("# Mailpit (intercept)"),
);
const activate = source.slice(
  source.indexOf("# Activate the boot-time default (EMAIL_DELIVERY_MODE)"),
  source.lastIndexOf("\n", source.indexOf("7. ensure BOTH HTTP")),
);

async function fixture(mode) {
  const state = {
    id: "stable-real",
    description: "real transactional sender",
    host: "smtp.mail.ru:465",
    tls: true,
    senderAddress: "noreply@example.test",
    senderName: "Doctor.School",
    user: "old-user",
    state: "SMTP_CONFIG_ACTIVE",
  };
  const writes = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.method === "PUT") {
      writes.push({ path: req.url, body });
      if (mode === "reject") {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            code: 3,
            message: "invalid update",
            rejected: body,
          }),
        );
        return;
      }
      if (mode !== "unchanged" && !req.url.endsWith("/password"))
        Object.assign(state, body);
      res.end('{"details":{"sequence":"42"}}');
      return;
    }
    const publicState = { ...state };
    delete publicState.password;
    if (mode === "wrong-active" && req.url === "/admin/v1/smtp")
      publicState.id = "sink";
    res.end(
      JSON.stringify(
        req.url.endsWith("/_search")
          ? { result: [publicState] }
          : { smtpConfig: publicState },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.platform === "win32"
          ? "C:/Program Files/Git/bin/bash.exe"
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
      child.stdin.end(
        `set -euo pipefail\n${helpers}\n${ensure}\nid="$(ensure_smtp_provider 'real transactional sender' 'postbox.cloud.yandex.net:465' 'noreply@example.test' 'Doctor.School' 'new-user' 'fixture-secret' true)"\nEMAIL_DELIVERY_MODE=real\nSMTP_REAL_ID="$id"\nSMTP_MAILPIT_ID=sink\n${activate}\nprintf 'SUCCESS %s\\n' "$id"\n`,
      );
    });
    return { ...result, writes, state };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("EARS-31: rejected SMTP update fails inside command substitution without false success", async () => {
  const result = await fixture("reject");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /SUCCESS|ensured SMTP/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
});
test("EARS-31: successful HTTP response with unchanged metadata fails readback", async () => {
  const result = await fixture("unchanged");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /SUCCESS|ensured SMTP|fixture-secret/,
  );
});
test("EARS-31: existing identity switches host and credentials and is read back", async () => {
  const result = await fixture("converge");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS stable-real/);
  assert.equal(result.state.host, "postbox.cloud.yandex.net:465");
  assert.equal(result.state.user, "new-user");
  assert.equal(result.writes[0].body.password, "fixture-secret");
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
});

test("EARS-31: activation success with a different active identity fails before app startup", async () => {
  const result = await fixture("wrong-active");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /SUCCESS/);
  assert.match(result.stderr, /active-provider readback failed/);
});

test("EARS-31: deployment converges IdP before migrating or replacing the application", () => {
  const deploy = readFileSync(new URL("./prod.mjs", import.meta.url), "utf8");
  const start = deploy.indexOf("async function deploy(");
  const converge = deploy.indexOf("await provisionIdp(sha)", start);
  const swap = deploy.indexOf('step("api-prod: migrate → up -d")', start);
  assert.ok(
    converge > start && converge < swap,
    "IdP readback must pass while the old application is still serving",
  );
});
