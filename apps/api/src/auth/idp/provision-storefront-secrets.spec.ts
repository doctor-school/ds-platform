import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 003 EARS-62 / ADR-0015 §4 — `infra/dev-stand/idp/provision.sh` step 3.bis.2: the
// storefront clients' private_key_jwt JSON keys and INTERNAL_API_TOKEN, kept or
// minted straight into IDP_SECRET_ENV_FILE. The script's own bash fragment runs
// against a fake `api` (no PAT, no network, no stand); the fake Zitadel answers
// AddAppKey with a key file whose private-key text is a marker, so every test can
// assert the marker never reaches the script's stdout or stderr.
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
const inputs = slice(
  "storefront clients: inputs",
  "storefront_client_payload <name>",
);
const secrets = slice(
  "env_file_value <file> <NAME>",
  "3.ter. pin the Zitadel Management Console",
);

const bash =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash"; // no-hardcoded-path-ok: fixture requires Git Bash rather than WSL bash on Windows
function run(env: Record<string, string>, body: string) {
  return spawnSync(bash, ["--noprofile", "--norc", "-s"], {
    input: `set -euo pipefail\n${body}`,
    encoding: "utf8",
    timeout: 15000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  });
}

const STOREFRONT_URIS = {
  IDP_SIGN_IN_BASE_URI: "https://login.doctor.school",
  IDP_BACK_CHANNEL_LOGOUT_URI:
    "https://api.doctor.school/v1/auth/back-channel-logout",
  IDP_ACADEMY_REDIRECT_URI: "https://academy.doctor.school/auth/callback",
  IDP_ACADEMY_POST_LOGOUT_URI: "https://academy.doctor.school/",
  IDP_DOCTOR_REDIRECT_URI: "https://new.doctor.school/auth/callback",
  IDP_DOCTOR_POST_LOGOUT_URI: "https://new.doctor.school/",
};

const MARKER = "PRIVATE-KEY-MATERIAL";
const keyFile = (keyId: string, appId: string) =>
  Buffer.from(
    JSON.stringify({
      type: "application",
      keyId,
      key: `-----BEGIN RSA PRIVATE KEY-----\n${MARKER}-${keyId}\n-----END RSA PRIVATE KEY-----\n`,
      appId,
      clientId: `${appId}@ds`,
    }),
  ).toString("base64");

/** A fake `api`: two storefront apps, each listing `listed[app]` key ids. */
function fakeApi(
  opts: { listed?: Record<string, string[]>; addFails?: boolean } = {},
) {
  const listed = opts.listed ?? {};
  const keysOf = (app: string) =>
    JSON.stringify({ result: (listed[app] ?? []).map((id) => ({ id })) });
  return `
PROJECT_ID=proj-1
ACADEMY_APP_NAME=ds-storefront-academy
DOCTOR_APP_NAME=ds-storefront-doctor
api() {
  printf 'CALL %s %s\\n' "$1" "$2" >&2
  case "$1 $2" in
    "POST /management/v1/projects/proj-1/apps/_search")
      case "$3" in
        *ds-storefront-academy*) echo '{"result":[{"id":"app-a","name":"ds-storefront-academy"}]}' ;;
        *ds-storefront-doctor*) echo '{"result":[{"id":"app-d","name":"ds-storefront-doctor"}]}' ;;
      esac ;;
    "POST /management/v1/projects/proj-1/apps/app-a/keys/_search") echo '${keysOf("app-a")}' ;;
    "POST /management/v1/projects/proj-1/apps/app-d/keys/_search") echo '${keysOf("app-d")}' ;;
    "POST /management/v1/projects/proj-1/apps/app-a/keys")
      [[ "$3" == '{"type":"KEY_TYPE_JSON"}' ]] || return 92
      ${opts.addFails ? 'echo "API POST -> HTTP 500" >&2; return 1' : `echo '{"id":"new-a","keyDetails":"${keyFile("new-a", "app-a")}"}'`} ;;
    "POST /management/v1/projects/proj-1/apps/app-d/keys")
      [[ "$3" == '{"type":"KEY_TYPE_JSON"}' ]] || return 92
      echo '{"id":"new-d","keyDetails":"${keyFile("new-d", "app-d")}"}' ;;
    *) echo "unexpected API call" >&2; return 91 ;;
  esac
}
${secrets}`;
}

let dir: string;
let envFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ds-3172-"));
  envFile = join(dir, "api.env");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bashPath = (path: string) => path.replace(/\\/g, "/");
const valueOf = (text: string, name: string) =>
  new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1];
const leaks = (output: string) =>
  output.includes(MARKER) || /[A-Za-z0-9+/]{120,}/.test(output);

describe("003 EARS-62: storefront secrets (provision.sh step 3.bis.2)", () => {
  it("003 EARS-62: absent secrets are minted into the env file, other lines kept, nothing printed", () => {
    writeFileSync(
      envFile,
      "DATABASE_URL=postgres://x\nIDP_CLIENT_ID=headless\n",
    );
    const result = run(
      { SECRET_ENV_FILE: bashPath(envFile), STOREFRONT_CLIENTS: "ensure" },
      fakeApi(),
    );
    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(envFile, "utf8");
    expect(text).toMatch(/^DATABASE_URL=postgres:\/\/x$/m);
    expect(text).toMatch(/^IDP_CLIENT_ID=headless$/m);
    expect(valueOf(text, "IDP_ACADEMY_CLIENT_KEY")).toBe(
      keyFile("new-a", "app-a"),
    );
    expect(valueOf(text, "IDP_DOCTOR_CLIENT_KEY")).toBe(
      keyFile("new-d", "app-d"),
    );
    expect(
      Buffer.byteLength(valueOf(text, "INTERNAL_API_TOKEN") ?? ""),
    ).toBeGreaterThanOrEqual(32);
    if (process.platform !== "win32") {
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
    }
    // Only key ids and verdicts reach the log; the key material never does.
    expect(result.stdout).toBe("");
    expect(leaks(result.stderr)).toBe(false);
    expect(result.stderr).toContain("key new-a minted");
    expect(result.stderr).toContain("INTERNAL_API_TOKEN minted");
  });

  it("003 EARS-62: a stored key still listed on its app and a stored token are kept; the file is not rewritten", () => {
    const token = "t".repeat(44);
    const before = [
      `IDP_ACADEMY_CLIENT_KEY=${keyFile("old-a", "app-a")}`,
      `IDP_DOCTOR_CLIENT_KEY=${keyFile("old-d", "app-d")}`,
      `INTERNAL_API_TOKEN=${token}`,
      "",
    ].join("\n");
    writeFileSync(envFile, before);
    const result = run(
      { SECRET_ENV_FILE: bashPath(envFile), STOREFRONT_CLIENTS: "ensure" },
      fakeApi({ listed: { "app-a": ["old-a"], "app-d": ["x", "old-d"] } }),
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(envFile, "utf8")).toBe(before);
    expect(result.stderr).not.toMatch(/apps\/app-[ad]\/keys\n/);
    expect(result.stderr).toContain("key old-a kept");
    expect(result.stderr).toContain("unchanged");
    expect(result.stdout).toBe("");
    expect(leaks(result.stderr)).toBe(false);
  });

  it("003 EARS-62: a revoked stored key (keyId no longer listed) is replaced; the other is kept", () => {
    writeFileSync(
      envFile,
      `IDP_ACADEMY_CLIENT_KEY=${keyFile("old-a", "app-a")}\nIDP_DOCTOR_CLIENT_KEY=${keyFile("old-d", "app-d")}\n`,
    );
    const result = run(
      { SECRET_ENV_FILE: bashPath(envFile), STOREFRONT_CLIENTS: "ensure" },
      fakeApi({ listed: { "app-a": [], "app-d": ["old-d"] } }),
    );
    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(envFile, "utf8");
    expect(valueOf(text, "IDP_ACADEMY_CLIENT_KEY")).toBe(
      keyFile("new-a", "app-a"),
    );
    expect(valueOf(text, "IDP_DOCTOR_CLIENT_KEY")).toBe(
      keyFile("old-d", "app-d"),
    );
    expect(text.match(/^IDP_ACADEMY_CLIENT_KEY=/gm)).toHaveLength(1);
    expect(leaks(result.stdout + result.stderr)).toBe(false);
  });

  it("003 EARS-62: a key that cannot be minted refuses the run and leaves the env file untouched", () => {
    const before = "DATABASE_URL=postgres://x\n";
    writeFileSync(envFile, before);
    const result = run(
      { SECRET_ENV_FILE: bashPath(envFile), STOREFRONT_CLIENTS: "ensure" },
      fakeApi({ addFails: true }),
    );
    expect(result.status).not.toBe(0);
    expect(readFileSync(envFile, "utf8")).toBe(before);
    expect(result.stderr).toContain("could not be produced");
    expect(leaks(result.stdout + result.stderr)).toBe(false);
  });

  it("003 EARS-62: the internal env file gets ONLY the api's INTERNAL_API_TOKEN — never a client key", () => {
    const internalFile = join(dir, "internal.env");
    const result = run(
      {
        SECRET_ENV_FILE: bashPath(envFile),
        INTERNAL_ENV_FILE: bashPath(internalFile),
        STOREFRONT_CLIENTS: "ensure",
      },
      fakeApi(),
    );
    expect(result.status, result.stderr).toBe(0);
    const internal = readFileSync(internalFile, "utf8");
    const token = valueOf(readFileSync(envFile, "utf8"), "INTERNAL_API_TOKEN");
    expect(token && token.length).toBeGreaterThanOrEqual(32);
    expect(valueOf(internal, "INTERNAL_API_TOKEN")).toBe(token);
    expect(
      internal.split(/\r?\n/).filter((l) => l && !l.startsWith("#")),
    ).toEqual([`INTERNAL_API_TOKEN=${token}`]);
    expect(internal).not.toContain(MARKER);
    expect(internal).not.toMatch(/CLIENT_KEY|SIGN_IN_RECORD_KEY/);
    if (process.platform !== "win32") {
      expect(statSync(internalFile).mode & 0o777).toBe(0o600);
    }
    expect(result.stdout).toBe("");
    expect(leaks(result.stderr)).toBe(false);
    expect(result.stderr).toContain("(token only)");

    // A re-run with everything valid rewrites neither file.
    const rerun = run(
      {
        SECRET_ENV_FILE: bashPath(envFile),
        INTERNAL_ENV_FILE: bashPath(internalFile),
        STOREFRONT_CLIENTS: "ensure",
      },
      fakeApi({ listed: { "app-a": ["new-a"], "app-d": ["new-d"] } }),
    );
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(readFileSync(internalFile, "utf8")).toBe(internal);
    expect(rerun.stderr).toContain(`INTERNAL_API_TOKEN in ${bashPath(internalFile)}: unchanged`);
    expect(leaks(rerun.stdout + rerun.stderr)).toBe(false);
  });

  it("003 EARS-62: a key that cannot be minted leaves the internal env file unwritten", () => {
    const internalFile = join(dir, "internal.env");
    const result = run(
      {
        SECRET_ENV_FILE: bashPath(envFile),
        INTERNAL_ENV_FILE: bashPath(internalFile),
        STOREFRONT_CLIENTS: "ensure",
      },
      fakeApi({ addFails: true }),
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(internalFile)).toBe(false);
  });

  it("003 EARS-62: IDP_INTERNAL_ENV_FILE without IDP_SECRET_ENV_FILE, or in a missing directory, is refused before any mutation", () => {
    const alone = run(
      {
        ...STOREFRONT_URIS,
        IDP_INTERNAL_ENV_FILE: bashPath(join(dir, "internal.env")),
      },
      `${inputs}\necho reached`,
    );
    expect(alone.status).toBe(4);
    expect(alone.stdout).not.toContain("reached");
    const missingDir = run(
      {
        ...STOREFRONT_URIS,
        IDP_SECRET_ENV_FILE: bashPath(envFile),
        IDP_INTERNAL_ENV_FILE: bashPath(join(dir, "nope", "internal.env")),
      },
      `${inputs}\necho reached`,
    );
    expect(missingDir.status).toBe(4);
    expect(missingDir.stdout).not.toContain("reached");
  });

  it("003 EARS-62: IDP_SECRET_ENV_FILE without the storefront clients, or in a missing directory, is refused before any mutation", () => {
    const noClients = run(
      { IDP_SECRET_ENV_FILE: bashPath(envFile) },
      `${inputs}\necho reached`,
    );
    expect(noClients.status).toBe(4);
    expect(noClients.stdout).not.toContain("reached");
    const missingDir = run(
      {
        ...STOREFRONT_URIS,
        IDP_SECRET_ENV_FILE: bashPath(join(dir, "nope", "api.env")),
      },
      `${inputs}\necho reached`,
    );
    expect(missingDir.status).toBe(4);
    expect(existsSync(join(dir, "nope"))).toBe(false);
    const ok = run(
      { ...STOREFRONT_URIS, IDP_SECRET_ENV_FILE: bashPath(envFile) },
      `${inputs}\necho reached`,
    );
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("reached");
  });
});
