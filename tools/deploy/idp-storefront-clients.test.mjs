import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// 003 EARS-60 / ADR-0015 §4 req. 1 — the prod deploy's IdP converge registers the two
// storefront clients with exactly the production URIs. The env the deploy passes is
// read from prod.mjs and fed to provision.sh's own input + payload fragment, so the
// two files cannot drift apart.
const deploy = readFileSync(
  new URL("./prod.mjs", import.meta.url),
  "utf8",
).replace(/\r/g, "");
const script = readFileSync(
  new URL("../../infra/dev-stand/idp/provision.sh", import.meta.url),
  "utf8",
).replace(/\r/g, "");
const inputs = script.slice(
  script.lastIndexOf("\n", script.indexOf("storefront clients: inputs")),
  script.lastIndexOf("\n", script.indexOf("http helper")),
);

function storefrontEnv() {
  const block =
    /const IDP_STOREFRONT_CLIENT_ENV = \[([\s\S]*?)\]\.join\(" "\);/.exec(
      deploy,
    );
  assert.ok(block, "prod.mjs declares IDP_STOREFRONT_CLIENT_ENV");
  return Object.fromEntries(
    [...block[1].matchAll(/"([A-Z_]+)=([^"]+)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

test("003 EARS-60: the prod provision invocation carries the storefront client env", () => {
  const start = deploy.indexOf("async function provisionIdp(");
  const command = deploy.slice(
    start,
    deploy.indexOf("./provision.sh --pat-file", start),
  );
  assert.ok(command.includes("${IDP_STOREFRONT_CLIENT_ENV}"));
});

test("003 EARS-60: prod registers exactly one callback and one post-logout URI per storefront", () => {
  const bash =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe" // no-hardcoded-path-ok: fixture requires Git Bash rather than WSL bash on Windows
      : "bash";
  const result = spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    input: `set -euo pipefail
${inputs}
storefront_client_payload "$ACADEMY_APP_NAME" "$ACADEMY_REDIRECT_URI" "$ACADEMY_POST_LOGOUT_URI"
storefront_client_payload "$DOCTOR_APP_NAME" "$DOCTOR_REDIRECT_URI" "$DOCTOR_POST_LOGOUT_URI"`,
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ...storefrontEnv(),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const [academy, doctor] = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(academy.redirectUris, [
    "https://academy.doctor.school/auth/callback",
  ]);
  assert.deepEqual(academy.postLogoutRedirectUris, [
    "https://academy.doctor.school/",
  ]);
  assert.deepEqual(doctor.redirectUris, [
    "https://new.doctor.school/auth/callback",
  ]);
  assert.deepEqual(doctor.postLogoutRedirectUris, [
    "https://new.doctor.school/",
  ]);
  for (const client of [academy, doctor]) {
    assert.deepEqual(client.loginVersion, {
      loginV2: { baseUri: "https://login.doctor.school" },
    });
    assert.equal(
      client.backChannelLogoutUri,
      "https://api.doctor.school/v1/auth/back-channel-logout",
    );
    assert.equal(
      client.authMethodType,
      "OIDC_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT",
    );
    assert.equal(client.devMode, false);
  }
});
