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
  const mailru = {
    id: "stable-mailru",
    description: "real transactional sender",
    host: "smtp.mail.ru:465",
    tls: true,
    senderAddress: "noreply@example.test",
    senderName: "Doctor.School",
    user: "old-user",
    state: "SMTP_CONFIG_ACTIVE",
  };
  const candidate = {
    ...mailru,
    id: "postbox",
    description: "real transactional sender:postbox",
    host: "postbox.cloud.yandex.net:465",
    user: "new-user",
    state: "SMTP_CONFIG_INACTIVE",
  };
  const original = { ...mailru };
  let created = !["create", "lost-create", "delayed"].includes(mode),
    active = false,
    reads = 0;
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ method: req.method, path: req.url, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url.endsWith("/_search")) {
      if (mode === "malformed") {
        res.end("{}");
        return;
      }
      const profiles = [
        mailru,
        ...(created ? [candidate] : []),
        ...(mode === "duplicate" ? [{ ...candidate, id: "duplicate" }] : []),
      ];
      const offset = Number(body.query?.offset ?? 0);
      res.end(
        JSON.stringify({
          result: profiles.slice(offset, offset + 1),
          details: { totalResult: String(profiles.length) },
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === "/admin/v1/smtp") {
      created = true;
      Object.assign(candidate, body);
      if (mode === "lost-create") {
        req.socket.destroy();
        return;
      }
      res.end('{"id":"postbox"}');
      return;
    }
    if (req.url.endsWith("/_activate")) {
      active = true;
      res.end("{}");
      return;
    }
    if (req.method === "PUT") {
      res.statusCode = 400;
      res.end('{"code":3,"message":"fixture-secret must never be updated"}');
      return;
    }
    if (mode === "delayed" && reads++ === 0) {
      res.statusCode = 404;
      res.end('{"code":5}');
      return;
    }
    const publicState = { ...candidate, state: active ? 2 : 3 };
    if (mode === "mismatch") publicState.host = "wrong.test:465";
    if (mode === "wrong-active" && req.url === "/admin/v1/smtp")
      publicState.id = "stable-mailru";
    res.end(JSON.stringify({ smtpConfig: publicState }));
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
      // Advance only this shell's clock on repeated failed reads; no real 120s test wait.
      child.stdin.end(
        `set -euo pipefail\nsleep() { SECONDS=$((SECONDS+61)); }\n${helpers}\n${ensure}\nid="$(ensure_smtp_provider 'real transactional sender:postbox' 'postbox.cloud.yandex.net:465' 'noreply@example.test' 'Doctor.School' 'new-user' 'fixture-secret' true)"\nEMAIL_DELIVERY_MODE=real\nSMTP_REAL_ID="$id"\nSMTP_MAILPIT_ID=sink\n${activate}\nprintf 'SUCCESS %s\\n' "$id"\n`,
      );
    });
    assert.deepEqual(mailru, original, "mail.ru profile must remain intact");
    return { ...result, requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const mode of ["reuse", "create", "delayed"]) {
  test(`EARS-31: ${mode} preserves mail.ru and converges the separate Postbox ID without PUT`, async () => {
    const result = await fixture(mode);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SUCCESS postbox/);
    assert.equal(result.requests.filter((r) => r.method === "PUT").length, 0);
    assert.equal(
      result.requests.filter(
        (r) => r.method === "POST" && r.path === "/admin/v1/smtp",
      ).length,
      mode === "reuse" ? 0 : 1,
    );
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
  });
}
for (const mode of [
  "duplicate",
  "mismatch",
  "malformed",
  "lost-create",
  "wrong-active",
]) {
  test(`EARS-31: ${mode} refuses false success without changing mail.ru`, async () => {
    const result = await fixture(mode);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /SUCCESS|fixture-secret/,
    );
    assert.equal(result.requests.filter((r) => r.method === "PUT").length, 0);
    if (mode !== "wrong-active")
      assert.equal(
        result.requests.filter((r) => r.path.endsWith("/_activate")).length,
        0,
      );
    assert.ok(
      result.requests.filter(
        (r) => r.method === "POST" && r.path === "/admin/v1/smtp",
      ).length <= 1,
    );
  });
}
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
