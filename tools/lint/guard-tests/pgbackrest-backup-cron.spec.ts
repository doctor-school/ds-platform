import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SCRIPT = resolve(
  HERE,
  "..",
  "..",
  "..",
  "infra",
  "deploy",
  "compose",
  "data-prod",
  "pgbackrest",
  "backup.sh",
);
const ENTRYPOINT_SCRIPT = resolve(
  HERE,
  "..",
  "..",
  "..",
  "infra",
  "deploy",
  "compose",
  "data-prod",
  "pgbackrest",
  "entrypoint.sh",
);
const DATA_PROD = resolve(HERE, "..", "..", "..", "infra", "deploy", "compose", "data-prod");
const OFFSITE_SCRIPT = join(DATA_PROD, "pgbackrest", "pgbackrest-offsite.sh");
const REPO_CHECK_SCRIPT = join(DATA_PROD, "pgbackrest", "repo-check.sh");
const PGBACKREST_CONF = join(DATA_PROD, "pgbackrest", "pgbackrest.conf");
const fixtureRoots: string[] = [];

function findPosixShell() {
  if (process.platform !== "win32") {
    return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  }

  const gitExecPath = execFileSync("git", ["--exec-path"], {
    encoding: "utf8",
  }).trim();
  const gitRoot = resolve(gitExecPath, "..", "..", "..");
  const shell = [
    join(gitRoot, "bin", "bash.exe"),
    join(gitRoot, "usr", "bin", "bash.exe"),
  ].find(existsSync);
  if (!shell) {
    throw new Error(`Git Bash not found below git --exec-path: ${gitExecPath}`);
  }
  return shell;
}

const POSIX_SHELL = findPosixShell();

function toPosixPath(path: string) {
  if (process.platform !== "win32") return path;
  return execFileSync(
    POSIX_SHELL,
    ["-c", 'cygpath -u "$1"', "pgbackrest-cron-test", path],
    { encoding: "utf8" },
  ).trim();
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("pgBackRest scheduled backup wrapper", () => {
  it("#1469 resolves gosu when cron omits /usr/local/bin from PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "ds-pgbackrest-cron-"));
    fixtureRoots.push(root);
    const runtimeBin = join(root, "usr", "local", "bin");
    mkdirSync(runtimeBin, { recursive: true });

    const backupScript = join(runtimeBin, "backup.sh");
    const gosu = join(runtimeBin, "gosu");
    copyFileSync(BACKUP_SCRIPT, backupScript);
    writeFileSync(gosu, '#!/usr/bin/env bash\nprintf "%s\\n" "$*"\n', "utf8");
    chmodSync(gosu, 0o755);

    const result = spawnSync(POSIX_SHELL, [toPosixPath(backupScript), "full"], {
      env: { ...process.env, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "postgres pgbackrest --stanza=ds --repo=1 --type=full backup",
    );
  });

  it("#1471 captures all PGBACKREST_* variables for scrubbed cron jobs", () => {
    const root = mkdtempSync(join(tmpdir(), "ds-pgbackrest-entrypoint-"));
    fixtureRoots.push(root);
    const runtimeBin = join(root, "usr", "local", "bin");
    mkdirSync(runtimeBin, { recursive: true });

    for (const [name, body] of [
      ["gosu", '#!/usr/bin/env bash\nshift\nexec "$@"\n'],
      ["pg_isready", "#!/usr/bin/env bash\nexit 0\n"],
      ["pgbackrest", "#!/usr/bin/env bash\nexit 0\n"],
      ["cron", "#!/usr/bin/env bash\nexit 0\n"],
    ]) {
      const command = join(runtimeBin, name);
      writeFileSync(command, body, "utf8");
      chmodSync(command, 0o755);
    }

    const envFile = join(root, "etc", "pgbackrest", "pgbackrest.env");
    const pathPrefix = toPosixPath(runtimeBin);
    const result = spawnSync(POSIX_SHELL, [toPosixPath(ENTRYPOINT_SCRIPT)], {
      env: {
        PATH: `${pathPrefix}:/usr/bin:/bin`,
        DS_PGBACKREST_ENV_FILE: toPosixPath(envFile),
        PGBACKREST_REPO1_S3_BUCKET: "fixture-bucket",
        PGBACKREST_REPO1_S3_KEY: "fixture-access-key",
        PGBACKREST_REPO1_S3_KEY_SECRET: "fixture-secret-key",
        PGBACKREST_REPO1_CIPHER_PASS: "fixture-cipher-pass",
        UNRELATED_SECRET: "must-not-leak",
        TZ: "Europe/Moscow",
      },
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);

    const savedEnv = readFileSync(envFile, "utf8").trim().split("\n").sort();
    expect(savedEnv).toEqual([
      "PGBACKREST_REPO1_CIPHER_PASS=fixture-cipher-pass",
      "PGBACKREST_REPO1_S3_BUCKET=fixture-bucket",
      "PGBACKREST_REPO1_S3_KEY=fixture-access-key",
      "PGBACKREST_REPO1_S3_KEY_SECRET=fixture-secret-key",
      "TZ=Europe/Moscow",
    ]);
    expect(savedEnv.join("\n")).not.toContain("UNRELATED_SECRET");
    if (process.platform !== "win32") {
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
    }
  });
});

// #3670: an offsite repo is on only while data.env holds all four of its names.
const OFFSITE_NAMES = (n: number) => ({
  [`PGBACKREST_REPO${n}_S3_KEY`]: `fixture-key-${n}`,
  [`PGBACKREST_REPO${n}_S3_KEY_SECRET`]: `fixture-secret-${n}`,
  [`PGBACKREST_REPO${n}_S3_ENDPOINT`]: `s3.repo${n}.example.test`,
  [`PGBACKREST_REPO${n}_CIPHER_PASS`]: "a".repeat(64),
});

function offsite(env: Record<string, string>, { stale = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ds-pgbackrest-offsite-"));
  fixtureRoots.push(root);
  const out = join(root, "offsite.conf");
  if (stale) writeFileSync(out, "[global]\nrepo2-type=s3\n", "utf8");
  const result = spawnSync(
    POSIX_SHELL,
    [toPosixPath(OFFSITE_SCRIPT), toPosixPath(PGBACKREST_CONF), toPosixPath(out)],
    { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return {
    stderr: result.stderr,
    include: existsSync(out) ? readFileSync(out, "utf8") : null,
  };
}

const committedPolicy = (n: number) =>
  readFileSync(PGBACKREST_CONF, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`#repo${n}: `))
    .map((line) => line.slice(`#repo${n}: `.length));

describe("3670: offsite pgBackRest repos follow their data.env names", () => {
  it("the committed conf configures repo1 only; each offsite policy line is its own repo's", () => {
    const conf = readFileSync(PGBACKREST_CONF, "utf8");
    expect(conf).not.toMatch(/^repo[2-9]-/m);
    expect(conf).toMatch(/^archive-async=y$/m);
    for (const n of [2, 3]) {
      const policy = committedPolicy(n);
      expect(policy.length).toBeGreaterThan(0);
      for (const line of policy) expect(line.startsWith(`repo${n}-`) && /^[a-z0-9-]+=[^\s=]+$/.test(line)).toBe(true);
      expect(policy).toEqual(
        expect.arrayContaining([
          `repo${n}-type=s3`,
          `repo${n}-cipher-type=aes-256-cbc`,
          `repo${n}-retention-full-type=time`,
        ]),
      );
      // Secrets and the per-deploy endpoint come from env, never the committed policy.
      expect(policy.join("\n")).not.toMatch(/-(s3-key|s3-key-secret|s3-endpoint|cipher-pass)=/);
    }
  });

  it("names absent → no include (repo1 only), and a stale include is removed", () => {
    expect(offsite({}).include).toBeNull();
    expect(offsite({}, { stale: true }).include).toBeNull();
  });

  it("three of four names → the repo stays off, said on stderr", () => {
    const partial = { ...OFFSITE_NAMES(2) };
    delete partial.PGBACKREST_REPO2_CIPHER_PASS;
    const r = offsite(partial, { stale: true });
    expect(r.include).toBeNull();
    expect(r.stderr).toMatch(/repo2 has 3 of its 4 data\.env names; left off/);
    expect(r.stderr).not.toContain("fixture-");
  });

  it("all four names → exactly that repo's committed policy under [global]", () => {
    const r = offsite(OFFSITE_NAMES(2));
    expect(r.include).toBe(["[global]", ...committedPolicy(2), ""].join("\n"));
    expect(r.include).not.toMatch(/repo3-|fixture-|a{64}/);
  });

  it("both offsite repos' names → repo1 + repo2 + repo3", () => {
    const r = offsite({ ...OFFSITE_NAMES(2), ...OFFSITE_NAMES(3) });
    expect(r.include).toBe(["[global]", ...committedPolicy(2), ...committedPolicy(3), ""].join("\n"));
  });

  it("the postgres and pgbackrest images carry byte-equal copies of the script", () => {
    expect(readFileSync(join(DATA_PROD, "postgres", "pgbackrest-offsite.sh"))).toEqual(
      readFileSync(OFFSITE_SCRIPT),
    );
  });

  function fixtureBin(files: [string, string][]) {
    const root = mkdtempSync(join(tmpdir(), "ds-pgbackrest-offsite-bin-"));
    fixtureRoots.push(root);
    const bin = join(root, "usr", "local", "bin");
    mkdirSync(bin, { recursive: true });
    for (const [name, body] of files) {
      writeFileSync(join(bin, name), body, "utf8");
      chmodSync(join(bin, name), 0o755);
    }
    return { root, bin };
  }

  it("backup.sh offsite backs up to each enabled repo by --repo, and is a no-op with none", () => {
    const { root, bin } = fixtureBin([["gosu", '#!/usr/bin/env bash\nprintf "%s\n" "$*"\n']]);
    copyFileSync(BACKUP_SCRIPT, join(bin, "backup.sh"));
    const include = join(root, "offsite.conf");
    const runBackup = () =>
      spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "backup.sh")), "full", "offsite"], {
        env: {
          PATH: "/usr/bin:/bin",
          DS_PGBACKREST_ENV_FILE: toPosixPath(join(root, "none.env")),
          DS_PGBACKREST_OFFSITE_INCLUDE: toPosixPath(include),
        },
        encoding: "utf8",
      });
    const none = runBackup();
    expect(none.status, none.stderr).toBe(0);
    expect(none.stdout).toMatch(/no offsite repo is on/);
    expect(none.stdout).not.toContain("pgbackrest --stanza");

    writeFileSync(include, ["[global]", ...committedPolicy(2), ...committedPolicy(3), ""].join("\n"));
    const both = runBackup();
    expect(both.status, both.stderr).toBe(0);
    expect(both.stdout).toContain("postgres pgbackrest --stanza=ds --repo=2 --type=full backup");
    expect(both.stdout).toContain("postgres pgbackrest --stanza=ds --repo=3 --type=full backup");
  });

  it("backup.sh full offsite <repo> backs up that enabled repo only, and refuses one that is off", () => {
    const { root, bin } = fixtureBin([["gosu", '#!/usr/bin/env bash\nprintf "%s\n" "$*"\n']]);
    copyFileSync(BACKUP_SCRIPT, join(bin, "backup.sh"));
    const include = join(root, "offsite.conf");
    writeFileSync(include, ["[global]", ...committedPolicy(2), ""].join("\n"));
    const runBackup = (...repos: string[]) =>
      spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "backup.sh")), "full", "offsite", ...repos], {
        env: {
          PATH: "/usr/bin:/bin",
          DS_PGBACKREST_ENV_FILE: toPosixPath(join(root, "none.env")),
          DS_PGBACKREST_OFFSITE_INCLUDE: toPosixPath(include),
        },
        encoding: "utf8",
      });
    const two = runBackup("2");
    expect(two.status, two.stderr).toBe(0);
    expect(two.stdout).toContain("postgres pgbackrest --stanza=ds --repo=2 --type=full backup");
    const three = runBackup("3");
    expect(three.status).toBe(1);
    expect(three.stderr).toMatch(/repo3 is not on/);
    expect(three.stdout).not.toContain("pgbackrest --stanza");
  });

  // A stub pgbackrest that logs its argv and the scratch include it was pointed at.
  function repoCheck(args: string[], env: Record<string, string>, checkRc = "0") {
    const stub =
      '#!/usr/bin/env bash\necho "pgbackrest $*" >> "$STUB_LOG"\n' +
      'for a; do [[ $a == --config-include-path=* ]] && cat "${a#*=}"/*.conf >> "$STUB_LOG" 2>/dev/null; done\n' +
      `[[ $* == *" check" ]] && exit ${checkRc}\nexit 0\n`;
    const { root, bin } = fixtureBin([["pgbackrest", stub]]);
    copyFileSync(REPO_CHECK_SCRIPT, join(bin, "repo-check.sh"));
    copyFileSync(OFFSITE_SCRIPT, join(bin, "pgbackrest-offsite.sh"));
    const stubLog = join(root, "calls.log");
    const r = spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "repo-check.sh")), ...args], {
      env: {
        PATH: `${toPosixPath(bin)}:/usr/bin:/bin`,
        STUB_LOG: toPosixPath(stubLog),
        DS_PGBACKREST_CONF: toPosixPath(PGBACKREST_CONF),
        DS_PGBACKREST_OFFSITE_INCLUDE: toPosixPath(join(root, "offsite.conf")),
        ...env,
      },
      encoding: "utf8",
    });
    const calls = existsSync(stubLog) ? readFileSync(stubLog, "utf8") : "";
    return { r, calls, live: join(root, "offsite.conf") };
  }
  const scoped = /^pgbackrest --stanza=ds --config-include-path=\S+ (stanza-create|check)$/gm;

  it("repo-check.sh re-derives the live include, then creates and checks repo1 alone by default — and fails with it", () => {
    for (const rc of ["0", "1"]) {
      const { r, calls, live } = repoCheck([], { ...OFFSITE_NAMES(2) }, rc);
      expect(r.status, r.stderr).toBe(Number(rc));
      expect([...calls.matchAll(scoped)].map((m) => m[1])).toEqual(["stanza-create", "check"]);
      // The container's own include keeps repo2 on; the verdict reads none of it.
      expect(readFileSync(live, "utf8")).toContain("repo2-type=s3");
      expect(calls).not.toMatch(/repo2-/);
    }
  });

  it("repo-check.sh <repo> adds only that repo's policy: an enabled repo3 is not checked by a repo2 rotation", () => {
    const { r, calls } = repoCheck(["2"], { ...OFFSITE_NAMES(2), ...OFFSITE_NAMES(3) });
    expect(r.status, r.stderr).toBe(0);
    expect(calls).toContain("repo2-type=s3");
    expect(calls).not.toMatch(/repo3-/);
  });

  it("repo-check.sh <repo> fails, checking nothing, when the rotation left that repo off", () => {
    const partial: Record<string, string> = { ...OFFSITE_NAMES(2) };
    delete partial.PGBACKREST_REPO2_S3_ENDPOINT;
    const { r, calls } = repoCheck(["2"], partial);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/repo2 is not on/);
    expect(calls).toBe("");
  });
});
