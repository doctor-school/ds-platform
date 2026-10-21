import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 003 EARS-60 / ADR-0015 §4 req. 1 + 7 — the two storefront OIDC clients that
// `infra/dev-stand/idp/provision.sh` step 3.bis converges. These run the script's
// own bash fragments with a fresh env (no PAT, no network, no stand): the input
// validation, the AddOIDCApp payload builder and the read-before-write converge
// against a fake `api`. The live half (Zitadel refusing a foreign redirect_uri and
// an unknown client_id) is `apps/api/test/auth/storefront-oidc-clients.e2e-spec.ts`.
const script = readFileSync(
  new URL("../../../../../infra/dev-stand/idp/provision.sh", import.meta.url),
  "utf8",
).replace(/\r/g, "");
const slice = (from: string, to: string) => {
  const start = script.indexOf(from);
  const end = script.indexOf(to, start);
  if (start < 0 || end < 0)
    throw new Error(`fragment ${from} … ${to} not found`);
  return script.slice(
    script.lastIndexOf("\n", start),
    script.lastIndexOf("\n", end),
  );
};
const inputs = slice("storefront clients: inputs", "http helper");
const converge = slice("ensure_storefront_client() {", "ACADEMY_CLIENT_ID=");
const headlessApp = slice(
  "3. ensure OIDC web application",
  "3.bis. ensure the two",
);
const consoleLogin = slice(
  "3.ter. pin the Zitadel Management Console",
  "\nensure_console_login_v2\n",
);
const instanceLogin = slice(
  "4. ensure the Login V2 instance feature",
  "5. grant IAM_LOGIN_CLIENT",
);

const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
function run(env: Record<string, string>, body: string) {
  return spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    input: `set -euo pipefail\n${body}`,
    encoding: "utf8",
    timeout: 10000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    cwd: fileURLToPath(new URL("../../../../../", import.meta.url)),
  });
}

const PROD = {
  IDP_SIGN_IN_BASE_URI: "https://login.doctor.school",
  IDP_BACK_CHANNEL_LOGOUT_URI:
    "https://api.doctor.school/v1/auth/back-channel-logout",
  IDP_ACADEMY_REDIRECT_URI: "https://academy.doctor.school/auth/callback",
  IDP_ACADEMY_POST_LOGOUT_URI: "https://academy.doctor.school/",
  IDP_DOCTOR_REDIRECT_URI: "https://new.doctor.school/auth/callback",
  IDP_DOCTOR_POST_LOGOUT_URI: "https://new.doctor.school/",
};
const DEV = {
  IDP_SIGN_IN_BASE_URI: "http://localhost:3005",
  IDP_BACK_CHANNEL_LOGOUT_URI:
    "http://localhost:3000/v1/auth/back-channel-logout",
  IDP_ACADEMY_REDIRECT_URI: "http://localhost:3001/auth/callback",
  IDP_ACADEMY_POST_LOGOUT_URI: "http://localhost:3001/",
  IDP_DOCTOR_REDIRECT_URI: "http://localhost:3004/auth/callback",
  IDP_DOCTOR_POST_LOGOUT_URI: "http://localhost:3004/",
};
type Payload = {
  name: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  authMethodType: string;
  devMode: boolean;
  backChannelLogoutUri: string;
  loginVersion: { loginV2: { baseUri: string } };
  grantTypes: string[];
};
function payloads(env: Record<string, string>) {
  const result = run(
    env,
    `${inputs}
storefront_client_payload "$ACADEMY_APP_NAME" "$ACADEMY_REDIRECT_URI" "$ACADEMY_POST_LOGOUT_URI"
storefront_client_payload "$DOCTOR_APP_NAME" "$DOCTOR_REDIRECT_URI" "$DOCTOR_POST_LOGOUT_URI"`,
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const [academy, doctor, ...rest] = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Payload);
  expect(rest).toEqual([]);
  if (!academy || !doctor) throw new Error("expected two storefront payloads");
  return [academy, doctor] as const;
}

describe("003 EARS-60: storefront OIDC clients (provision.sh step 3.bis)", () => {
  it("003 EARS-60: each storefront client registers exactly its own callback and post-logout URI (req. 1)", () => {
    const [academy, doctor] = payloads(PROD);
    expect(academy.name).toBe("ds-storefront-academy");
    expect(academy.redirectUris).toEqual([
      "https://academy.doctor.school/auth/callback",
    ]);
    expect(academy.postLogoutRedirectUris).toEqual([
      "https://academy.doctor.school/",
    ]);
    expect(doctor.name).toBe("ds-storefront-doctor");
    expect(doctor.redirectUris).toEqual([
      "https://new.doctor.school/auth/callback",
    ]);
    expect(doctor.postLogoutRedirectUris).toEqual([
      "https://new.doctor.school/",
    ]);
    for (const client of [academy, doctor]) {
      expect(client.authMethodType).toBe(
        "OIDC_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT",
      );
      expect(client.loginVersion).toEqual({
        loginV2: { baseUri: "https://login.doctor.school" },
      });
      expect(client.backChannelLogoutUri).toBe(
        "https://api.doctor.school/v1/auth/back-channel-logout",
      );
      expect(client.grantTypes).toEqual([
        "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
        "OIDC_GRANT_TYPE_REFRESH_TOKEN",
      ]);
      // https-only URIs ⇒ Zitadel's dev mode (which relaxes URI checks) stays off.
      expect(client.devMode).toBe(false);
    }
  });

  it("003 EARS-60: plain-http (dev-stand) URIs enable dev mode, https ones never do", () => {
    const [academy, doctor] = payloads(DEV);
    expect(academy.redirectUris).toEqual([
      "http://localhost:3001/auth/callback",
    ]);
    expect(academy.loginVersion.loginV2.baseUri).toBe("http://localhost:3005");
    expect(academy.devMode).toBe(true);
    expect(doctor.devMode).toBe(true);
  });

  it("003 EARS-60: with no storefront URI configured (stage, admin-e2e) step 3.bis is skipped — no localhost default", () => {
    const result = run(
      {},
      `${inputs}
echo "mode=$STOREFRONT_CLIENTS"`,
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("mode=skip");
    expect(inputs).not.toMatch(/:-https?:/);
  });

  it("003 EARS-60: a partially configured storefront URI set is refused before provisioning", () => {
    const { IDP_DOCTOR_POST_LOGOUT_URI: _omitted, ...partial } = PROD;
    const result = run(
      partial,
      `${inputs}
echo reached`,
    );
    expect(result.status).toBe(4);
    expect(result.stdout).not.toContain("reached");
    expect(result.stderr).toContain("IDP_DOCTOR_POST_LOGOUT_URI");
  });

  it.each([
    ["IDP_ACADEMY_REDIRECT_URI", "https://*.doctor.school/auth/callback"],
    [
      "IDP_ACADEMY_REDIRECT_URI",
      "https://academy.doctor.school/auth/callback?next=x",
    ],
    ["IDP_DOCTOR_REDIRECT_URI", "https://new.doctor.school/auth/[a-z]"],
    [
      "IDP_DOCTOR_REDIRECT_URI",
      "https://new.doctor.school/auth/callback,https://evil.example/auth/callback",
    ],
    ["IDP_DOCTOR_POST_LOGOUT_URI", "javascript:alert(1)"],
    ["IDP_ACADEMY_POST_LOGOUT_URI", "academy.doctor.school/"],
    [
      "IDP_ACADEMY_REDIRECT_URI",
      "https://academy.doctor.school/auth/callback https://evil.example/",
    ],
    ["IDP_SIGN_IN_BASE_URI", "https://login-*.stage.doctor.school"],
    [
      "IDP_BACK_CHANNEL_LOGOUT_URI",
      "//api.doctor.school/v1/auth/back-channel-logout",
    ],
  ])(
    "003 EARS-60: a wildcard, query, glob, list or non-absolute %s is refused before provisioning (req. 1)",
    (name, value) => {
      const result = run({ ...PROD, [name]: value }, `${inputs}\necho reached`);
      expect(result.status).toBe(4);
      expect(result.stdout).not.toContain("reached");
      expect(result.stderr).toContain(name);
    },
  );

  const fakeApi = (existing: boolean, putFails = false) => `
PROJECT_ID=proj-1
api() {
  printf 'CALL %s %s\\n' "$1" "$2" >&2
  case "$1 $2" in
    "POST /management/v1/projects/proj-1/apps/_search")
      ${existing ? `echo '{"result":[{"id":"app-7","name":"ds-storefront-academy"}]}'` : `echo '{"result":[]}'`} ;;
    "GET /management/v1/projects/proj-1/apps/app-7")
      echo '{"app":{"oidcConfig":{"clientId":"client-academy"}}}' ;;
    "POST /management/v1/projects/proj-1/apps/oidc")
      jq -e '.name == "ds-storefront-academy"' <<< "$3" >/dev/null || return 92
      echo '{"appId":"app-new","clientId":"client-new"}' ;;
    *) echo "unexpected API call" >&2; return 91 ;;
  esac
}
api_idempotent() {
  printf 'WRITE %s %s %s\\n' "$1" "$2" "$3" >&2
  ${putFails ? "return 1" : "return 0"}
}
${converge}
ensure_storefront_client "$ACADEMY_APP_NAME" "$ACADEMY_REDIRECT_URI" "$ACADEMY_POST_LOGOUT_URI"`;

  it("003 EARS-60: an existing storefront client is converged in place, its whole config rewritten", () => {
    const result = run(PROD, `${inputs}\n${fakeApi(true)}`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("client-academy");
    const write = result.stderr
      .split("\n")
      .find((line) => line.startsWith("WRITE "));
    expect(write).toBeDefined();
    const [, method, path, body] = /^WRITE (\S+) (\S+) (.*)$/.exec(write!)!;
    expect(method).toBe("PUT");
    expect(path).toBe("/management/v1/projects/proj-1/apps/app-7/oidc_config");
    const config = JSON.parse(body ?? "") as Partial<Payload>;
    expect(config.name).toBeUndefined();
    expect(config.redirectUris).toEqual([
      "https://academy.doctor.school/auth/callback",
    ]);
    expect(config.loginVersion).toEqual({
      loginV2: { baseUri: "https://login.doctor.school" },
    });
    expect(result.stderr).not.toContain("apps/oidc");
  });

  it("003 EARS-60: an absent storefront client is created and only its client id is printed", () => {
    const result = run(PROD, `${inputs}\n${fakeApi(false)}`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("client-new");
    expect(result.stderr).toContain(
      "CALL POST /management/v1/projects/proj-1/apps/oidc",
    );
    expect(result.stderr).not.toContain("WRITE ");
  });

  it("003 EARS-60: a failed converge write fails the step and prints no client id", () => {
    const result = run(PROD, `${inputs}\n${fakeApi(true, true)}`);
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("003 EARS-60: the headless/admin client carries its own Login V2 base_uri on the id host, never the sign-in host (req. 7)", () => {
    // The API's headless-exchange app (which the admin sign-in also rides) keeps
    // filing V2 auth requests through its OWN loginVersion now that the instance
    // flag is off (ADR-0015 §4).
    const result = run(
      { ...PROD, BASE_URL: "https://id.doctor.school" },
      `${inputs}
PROJECT_ID=proj-1 APP_NAME=ds-platform REDIRECT_URIS=https://api.doctor.school/v1/auth/callback POST_LOGOUT_URIS=https://academy.doctor.school/
api() {
  case "$1 $2" in
    "POST /management/v1/projects/proj-1/apps/_search") echo '{"result":[]}' ;;
    "POST /management/v1/projects/proj-1/apps/oidc") printf 'BODY %s\\n' "$3" >&2; echo '{"appId":"a","clientId":"c"}' ;;
    *) return 91 ;;
  esac
}
${headlessApp}`,
    );
    expect(result.status).toBe(0);
    const body = JSON.parse(
      /^BODY (.*)$/m.exec(result.stderr)?.[1] ?? "null",
    ) as Payload & { authMethodType: string };
    expect(body.loginVersion).toEqual({
      loginV2: { baseUri: "https://id.doctor.school/ui/v2/login" },
    });
    expect(body.authMethodType).toBe("OIDC_AUTH_METHOD_TYPE_BASIC");
    expect(headlessApp).not.toContain("SIGN_IN_BASE_URI");
  });

  it("003 EARS-60: the Console keeps Login V2 through a read-modify-write that changes only its loginVersion", () => {
    const current = {
      redirectUris: [],
      responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
      appType: "OIDC_APP_TYPE_USER_AGENT",
      authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
      devMode: true,
      clientId: "console-client",
      noneCompliant: false,
    };
    const result = run(
      { LOGIN_BASE_URI: "https://id.doctor.school/ui/v2/login" },
      `api() {
  case "$1 $2" in
    "POST /management/v1/projects/_search") echo '{"result":[{"id":"zp","name":"ZITADEL"}]}' ;;
    "POST /management/v1/projects/zp/apps/_search") echo '{"result":[{"id":"ca","name":"Management Console"}]}' ;;
    "GET /management/v1/projects/zp/apps/ca") echo '{"app":{"oidcConfig":${JSON.stringify(current)}}}' ;;
    *) return 91 ;;
  esac
}
api_idempotent() { printf 'WRITE %s %s %s\\n' "$1" "$2" "$3" >&2; }
${consoleLogin}
ensure_console_login_v2`,
    );
    expect(result.status).toBe(0);
    const [, path, body] = /^WRITE PUT (\S+) (.*)$/m.exec(result.stderr) ?? [];
    expect(path).toBe("/management/v1/projects/zp/apps/ca/oidc_config");
    expect(JSON.parse(body ?? "null")).toEqual({
      redirectUris: [],
      responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
      appType: "OIDC_APP_TYPE_USER_AGENT",
      authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
      devMode: true,
      loginVersion: {
        loginV2: { baseUri: "https://id.doctor.school/ui/v2/login" },
      },
    });
    // Several jq hops through a bash child: slow on Windows runners.
  }, 15000);

  it("003 EARS-60: the instance flag goes to required:false only after every client got its own login version", () => {
    const result = run(
      { LOGIN_BASE_URI: "https://id.doctor.school/ui/v2/login" },
      `api_idempotent() { printf 'BODY %s\\n' "$3" >&2; }
${instanceLogin}`,
    );
    expect(result.status).toBe(0);
    expect(
      JSON.parse(/^BODY (.*)$/m.exec(result.stderr)?.[1] ?? "null"),
    ).toEqual({
      loginV2: {
        required: false,
        baseUri: "https://id.doctor.school/ui/v2/login",
      },
    });
    const order = [
      "# ── 3. ensure OIDC web application",
      "# ── 3.bis. ensure the two storefront",
      "\nensure_console_login_v2\n",
      "# ── 4. ensure the Login V2 instance feature",
    ].map((marker) => script.indexOf(marker));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(instanceLogin).not.toContain("SIGN_IN_BASE_URI");
  });
});
