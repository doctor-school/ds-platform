import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  new URL("../../../../infra/dev-stand/idp/provision.sh", import.meta.url),
  "utf8",
).replace(/\r/g, "");
const preflight = script.slice(
  script.lastIndexOf("\n", script.indexOf("pre-flight: delivery-mode")),
  script.lastIndexOf("\n", script.indexOf("http helper")),
);
const smtp = script.slice(
  script.indexOf("ensure_smtp_provider()"),
  script.lastIndexOf("\n", script.indexOf("7. ensure BOTH HTTP")),
);
const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const valid = {
  EMAIL_DELIVERY_MODE: "real",
  SMS_DELIVERY_MODE: "sink",
  IDP_SMTP_REAL_PROVIDER: "postbox",
  IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:465",
  IDP_SMTP_REAL_USER: "fixture-user",
  IDP_SMTP_REAL_PASSWORD: "fixture-secret",
  IDP_SMTP_REAL_SENDER_ADDRESS: "noreply@example.test",
};
function run(env: Record<string, string>, body = preflight) {
  // A fresh env and shell fragment: no PAT, HTTP helper, network, or stand access.
  return spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    input: `set -euo pipefail\n${body}`,
    encoding: "utf8",
    timeout: 10000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
  });
}
describe("native SMTP provision fixtures", () => {
  it.each([
    { IDP_SMTP_REAL_PROVIDER: "" },
    { IDP_SMTP_REAL_PROVIDER: "unknown" },
    { IDP_SMTP_REAL_HOST: "smtp.mail.ru:465" },
    { IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net:587" },
    { IDP_SMTP_REAL_PORT: "587" },
    { IDP_SMTP_REAL_USER: " " },
    { IDP_SMTP_REAL_SENDER_ADDRESS: "invalid" },
  ])(
    "EARS-31: invalid real selection fails before provisioning without exposing secrets",
    (change) => {
      const result = run({ ...valid, ...change });
      expect(result.status).toBe(4);
      expect(result.stderr).not.toContain("fixture-secret");
      expect(result.stderr).not.toContain("fixture-user");
    },
  );
  it.each([
    valid,
    {
      ...valid,
      IDP_SMTP_REAL_PROVIDER: "mail.ru",
      IDP_SMTP_REAL_HOST: "smtp.mail.ru:465",
    },
    {
      ...valid,
      IDP_SMTP_REAL_HOST: "postbox.cloud.yandex.net",
      IDP_SMTP_REAL_PORT: "465",
    },
    { EMAIL_DELIVERY_MODE: "mailpit", SMS_DELIVERY_MODE: "sink" },
  ])(
    "EARS-31: accepts coherent explicit providers and credential-free intercept",
    (env) => {
      expect(run(env).status).toBe(0);
    },
  );
  it("EARS-31: updates the stable real identity and activates it without creating duplicate SMTP providers", () => {
    const fakeApi = `
api() {
  if [[ "$2" == /admin/v1/smtp/_search ]]; then
    echo '{"result":[{"id":"sink","description":"dev-stand mailpit"},{"id":"stable-real","description":"real transactional sender"}]}'
  elif [[ "$2" == /admin/v1/smtp ]]; then
    echo '{"smtpConfig":{"id":"stable-real","state":"SMTP_CONFIG_ACTIVE"}}'
  elif [[ "$1" == GET ]]; then
    jq -nc --arg id "\${2##*/}" --argjson p "$payload" '{smtpConfig:($p + {id:$id})}'
  else
    echo "unexpected API call" >&2; return 91
  fi
}
api_idempotent() { printf 'WRITE %s %s %s\\n' "$1" "$2" "$3"; }
api_activate() { printf 'ACTIVATE %s\\n' "$2" >&2; }
`;
    // Capture payloads through stderr because the real provisioner consumes stdout.
    const capture = fakeApi.replace('"$3"; }', '"$3" >&2; }');
    const result = run(valid, `${preflight}\n${capture}\n${smtp}`);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("WRITE PUT /admin/v1/smtp/stable-real");
    expect(result.stderr).toContain('"host":"postbox.cloud.yandex.net:465"');
    expect(result.stderr).toContain('"tls":true');
    expect(result.stderr).toContain(
      "ACTIVATE /admin/v1/smtp/stable-real/_activate",
    );
  });
});

describe("native provider identity integrity", () => {
  it.each([
    "api() { return 91; }",
    `api() { echo '{"result":[{"id":"one","description":"dev-stand mailpit"},{"id":"two","description":"dev-stand mailpit"}]}'; }`,
  ])(
    "EARS-31: refuses unreadable or duplicate provider identity before updates",
    (api) => {
      const result = run(
        valid,
        `${preflight}\n${api}\napi_idempotent() { echo MUTATED >&2; }\napi_activate() { echo MUTATED >&2; }\n${smtp}`,
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain("MUTATED");
    },
  );
});
