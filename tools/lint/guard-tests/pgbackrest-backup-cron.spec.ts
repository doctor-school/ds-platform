import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
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
});
