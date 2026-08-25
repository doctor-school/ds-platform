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
      "postgres pgbackrest --stanza=ds --type=full backup",
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
