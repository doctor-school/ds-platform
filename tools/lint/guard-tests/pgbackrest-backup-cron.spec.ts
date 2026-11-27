import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
// #4298: and it never joins repo1's config — it gets a config, a spool and a pusher of
// its own, so its outage cannot stall repo1's WAL archiving.
const OFFSITE_NAMES = (n: number) => ({
  [`PGBACKREST_REPO${n}_S3_KEY`]: `fixture-key-${n}`,
  [`PGBACKREST_REPO${n}_S3_KEY_SECRET`]: `fixture-secret-${n}`,
  [`PGBACKREST_REPO${n}_S3_ENDPOINT`]: `s3.repo${n}.example.test`,
  [`PGBACKREST_REPO${n}_CIPHER_PASS`]: "a".repeat(64),
});
const REPO_SCRIPT = join(DATA_PROD, "pgbackrest", "pgbackrest-repo.sh");
const PUSH_SCRIPT = join(DATA_PROD, "pgbackrest", "wal-offsite-push.sh");
const ARCHIVE_SCRIPT = join(DATA_PROD, "postgres", "pgbackrest-archive.sh");

const confLines = (prefix: string) =>
  readFileSync(PGBACKREST_CONF, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
const committedPolicy = (n: number) => confLines(`#repo${n}: `);

function fixtureRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.push(root);
  return root;
}

function offsite(env: Record<string, string>, { stale = false } = {}) {
  const root = fixtureRoot("ds-pgbackrest-offsite-");
  const out = join(root, "offsite");
  const spool = join(root, "spool");
  if (stale) {
    for (const n of [2, 3]) {
      mkdirSync(join(out, `repo${n}`), { recursive: true });
      writeFileSync(join(out, `repo${n}`, "pgbackrest.conf"), `[global]\nrepo${n}-type=s3\n`);
      mkdirSync(join(spool, `repo${n}`), { recursive: true });
      writeFileSync(join(spool, `repo${n}`, "000000010000000000000001"), "wal");
      writeFileSync(join(spool, `repo${n}.gap`), "dropped\n");
    }
  }
  const result = spawnSync(
    POSIX_SHELL,
    [toPosixPath(OFFSITE_SCRIPT), toPosixPath(PGBACKREST_CONF), toPosixPath(out), toPosixPath(spool)],
    { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const conf = (n: number) => {
    const p = join(out, `repo${n}`, "pgbackrest.conf");
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  return { stderr: result.stderr, conf, spool, on: (n: number) => existsSync(join(spool, `repo${n}`)) };
}

// The repo1 config's own non-repo1, non-async lines, as pgbackrest-offsite.sh keeps them.
const repoOnlyConf = (n: number) => {
  const kept = readFileSync(PGBACKREST_CONF, "utf8")
    .split(/\r?\n/)
    .filter((l) => l !== "" && !l.startsWith("#"))
    .filter((l) => !/^(repo1-|archive-async=|archive-push-queue-max=|spool-path=)/.test(l));
  const at = kept.indexOf("[global]");
  return [...kept.slice(0, at + 1), ...confLines("#offsite: "), ...committedPolicy(n), ...kept.slice(at + 1), ""].join("\n");
};

function fixtureBin(files: [string, string][]) {
  const root = fixtureRoot("ds-pgbackrest-offsite-bin-");
  const bin = join(root, "usr", "local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [name, body] of files) {
    writeFileSync(join(bin, name), body, "utf8");
    chmodSync(join(bin, name), 0o755);
  }
  return { root, bin };
}

describe("3670/4298: offsite pgBackRest repos follow their data.env names and stay off repo1's path", () => {
  it("the committed conf configures repo1 only; each offsite policy line is its own repo's", () => {
    const conf = readFileSync(PGBACKREST_CONF, "utf8");
    expect(conf).not.toMatch(/^repo[2-9]-/m);
    expect(conf).toMatch(/^archive-async=y$/m);
    expect(confLines("#offsite: ")).toContain("archive-timeout=600");
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

  it("PostgreSQL archives through the wrapper, and its image derives no offsite config", () => {
    const pgconf = readFileSync(join(DATA_PROD, "postgres", "postgresql.conf"), "utf8");
    expect(pgconf).toMatch(/^archive_command = '\/usr\/local\/bin\/pgbackrest-archive\.sh %p'$/m);
    expect(pgconf).toMatch(/^archive_timeout = 300$/m);
    const dockerfile = readFileSync(join(DATA_PROD, "postgres", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY pgbackrest-archive.sh /usr/local/bin/pgbackrest-archive.sh");
    expect(dockerfile).not.toMatch(/pgbackrest-offsite|ENTRYPOINT/);
    expect(existsSync(join(DATA_PROD, "postgres", "pgbackrest-offsite.sh"))).toBe(false);
    const compose = JSON.parse(readFileSync(join(DATA_PROD, "compose.yml"), "utf8"));
    for (const svc of ["postgres", "pgbackrest"]) {
      expect(compose.services[svc].volumes).toContain("pgbackrest_log:/var/log/pgbackrest");
    }
    expect(readFileSync(join(DATA_PROD, "pgbackrest", "crontab"), "utf8")).toMatch(
      /^\* \* \* \* \* \/usr\/local\/bin\/wal-offsite-push\.sh /m,
    );
  });

  it("names absent → no offsite config or spool, and a stale one is removed with its gap marker", () => {
    for (const stale of [false, true]) {
      const r = offsite({}, { stale });
      for (const n of [2, 3]) {
        expect(r.conf(n)).toBeNull();
        expect(r.on(n)).toBe(false);
        expect(existsSync(join(r.spool, `repo${n}.gap`))).toBe(false);
      }
    }
  });

  it("three of four names → the repo stays off, said on stderr", () => {
    const partial = { ...OFFSITE_NAMES(2) };
    delete partial.PGBACKREST_REPO2_CIPHER_PASS;
    const r = offsite(partial, { stale: true });
    expect(r.conf(2)).toBeNull();
    expect(r.on(2)).toBe(false);
    expect(r.stderr).toMatch(/repo2 has 3 of its 4 data\.env names; left off/);
    expect(r.stderr).not.toContain("fixture-");
  });

  it("all four names → a repo2-only config (no repo1, no async push, no queue drop) and its spool", () => {
    const r = offsite(OFFSITE_NAMES(2));
    expect(r.conf(2)).toBe(repoOnlyConf(2));
    expect(r.conf(2)).not.toMatch(/^(repo1-|repo3-|archive-async|archive-push-queue-max)/m);
    expect(r.conf(2)).toMatch(/^\[ds\]$/m);
    expect(r.conf(2)).not.toMatch(/fixture-|a{64}/);
    expect(r.on(2)).toBe(true);
    expect(r.conf(3)).toBeNull();
    expect(r.on(3)).toBe(false);
  });

  it("both offsite repos' names → a config and a spool each, neither knowing the other", () => {
    const r = offsite({ ...OFFSITE_NAMES(2), ...OFFSITE_NAMES(3) });
    expect(r.conf(2)).toBe(repoOnlyConf(2));
    expect(r.conf(3)).toBe(repoOnlyConf(3));
    expect(r.on(2) && r.on(3)).toBe(true);
  });

  it("pgbackrest-repo.sh runs pgBackRest under repo N's config with every other repo's env removed", () => {
    const stub = '#!/usr/bin/env bash\necho "argv $*"\nenv | grep "^PGBACKREST_" | sort\n';
    const { root, bin } = fixtureBin([["pgbackrest", stub]]);
    copyFileSync(REPO_SCRIPT, join(bin, "pgbackrest-repo.sh"));
    const offsiteDir = join(root, "offsite");
    mkdirSync(join(offsiteDir, "repo2"), { recursive: true });
    writeFileSync(join(offsiteDir, "repo2", "pgbackrest.conf"), "[global]\n");
    const run = (n: string) =>
      spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "pgbackrest-repo.sh")), n, "--type=full", "backup"], {
        env: {
          PATH: `${toPosixPath(bin)}:/usr/bin:/bin`,
          DS_PGBACKREST_OFFSITE_DIR: toPosixPath(offsiteDir),
          PGBACKREST_REPO1_S3_KEY: "k1",
          PGBACKREST_REPO1_CIPHER_PASS: "p1",
          PGBACKREST_REPO2_S3_KEY: "k2",
          PGBACKREST_REPO3_S3_KEY: "k3",
        },
        encoding: "utf8",
      });
    const two = run("2");
    expect(two.status, two.stderr).toBe(0);
    expect(two.stdout).toContain(
      `argv --config-path=${toPosixPath(join(offsiteDir, "repo2"))} --stanza=ds --type=full backup`,
    );
    expect(two.stdout).toContain("PGBACKREST_REPO2_S3_KEY=k2");
    expect(two.stdout).not.toMatch(/PGBACKREST_REPO[13]_/);
    const three = run("3");
    expect(three.status).toBe(1);
    expect(three.stderr).toMatch(/repo3 is not on/);
    expect(three.stdout).toBe("");
    expect(run("1").status).toBe(2);
  });

  function backup(include: number[], ...args: string[]) {
    const { root, bin } = fixtureBin([["gosu", '#!/usr/bin/env bash\nprintf "%s\\n" "$*"\n']]);
    copyFileSync(BACKUP_SCRIPT, join(bin, "backup.sh"));
    const offsiteDir = join(root, "offsite");
    for (const n of include) {
      mkdirSync(join(offsiteDir, `repo${n}`), { recursive: true });
      writeFileSync(join(offsiteDir, `repo${n}`, "pgbackrest.conf"), "[global]\n");
    }
    const spool = join(root, "spool");
    mkdirSync(spool, { recursive: true });
    const r = spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "backup.sh")), ...args], {
      env: {
        PATH: "/usr/bin:/bin",
        DS_PGBACKREST_ENV_FILE: toPosixPath(join(root, "none.env")),
        DS_PGBACKREST_OFFSITE_DIR: toPosixPath(offsiteDir),
        DS_OFFSITE_SPOOL: toPosixPath(spool),
      },
      encoding: "utf8",
    });
    return { r, bin: toPosixPath(bin), spool };
  }

  it("backup.sh offsite backs up each enabled repo under its own config, and is a no-op with none", () => {
    const none = backup([], "full", "offsite");
    expect(none.r.status, none.r.stderr).toBe(0);
    expect(none.r.stdout).toMatch(/no offsite repo is on/);
    expect(none.r.stdout).not.toContain("pgbackrest");

    const both = backup([2, 3], "full", "offsite");
    expect(both.r.status, both.r.stderr).toBe(0);
    expect(both.r.stdout).toContain(`postgres ${both.bin}/pgbackrest-repo.sh 2 --type=full backup`);
    expect(both.r.stdout).toContain(`postgres ${both.bin}/pgbackrest-repo.sh 3 --type=full backup`);
  });

  it("backup.sh full offsite <repo> backs up that enabled repo only, and refuses one that is off", () => {
    const two = backup([2], "full", "offsite", "2");
    expect(two.r.status, two.r.stderr).toBe(0);
    expect(two.r.stdout).toContain(`postgres ${two.bin}/pgbackrest-repo.sh 2 --type=full backup`);
    const three = backup([2], "full", "offsite", "3");
    expect(three.r.status).toBe(1);
    expect(three.r.stderr).toMatch(/repo3 is not on/);
    expect(three.r.stdout).not.toContain("pgbackrest-repo.sh");
  });

  // A stub pgbackrest / pgbackrest-repo.sh that log their argv.
  function repoCheck(args: string[], env: Record<string, string>, failOn = "") {
    const stub = (name: string) =>
      `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_LOG"\n` +
      (failOn ? `[[ "${name} $*" == *"${failOn}" ]] && exit 1\n` : "") +
      "exit 0\n";
    const { root, bin } = fixtureBin([
      ["pgbackrest", stub("pgbackrest")],
      ["pgbackrest-repo.sh", stub("pgbackrest-repo.sh")],
    ]);
    copyFileSync(REPO_CHECK_SCRIPT, join(bin, "repo-check.sh"));
    copyFileSync(OFFSITE_SCRIPT, join(bin, "pgbackrest-offsite.sh"));
    const stubLog = join(root, "calls.log");
    const r = spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "repo-check.sh")), ...args], {
      env: {
        PATH: `${toPosixPath(bin)}:/usr/bin:/bin`,
        STUB_LOG: toPosixPath(stubLog),
        DS_PGBACKREST_CONF: toPosixPath(PGBACKREST_CONF),
        DS_PGBACKREST_OFFSITE_DIR: toPosixPath(join(root, "offsite")),
        DS_OFFSITE_SPOOL: toPosixPath(join(root, "spool")),
        ...env,
      },
      encoding: "utf8",
    });
    const calls = existsSync(stubLog) ? readFileSync(stubLog, "utf8").trim().split("\n").filter(Boolean) : [];
    return { r, calls, root };
  }

  it("repo-check.sh re-derives the live configs, then creates and checks repo1 alone by default — and fails with it", () => {
    for (const failOn of ["", "pgbackrest --stanza=ds check"]) {
      const { r, calls, root } = repoCheck([], { ...OFFSITE_NAMES(2) }, failOn);
      expect(r.status, r.stderr).toBe(failOn ? 1 : 0);
      expect(calls).toEqual(["pgbackrest --stanza=ds stanza-create", "pgbackrest --stanza=ds check"]);
      // The container's own repo2 config and spool stay on; the verdict touches none of it.
      expect(existsSync(join(root, "offsite", "repo2", "pgbackrest.conf"))).toBe(true);
      expect(existsSync(join(root, "spool", "repo2"))).toBe(true);
    }
  });

  it("repo-check.sh <repo> adds only that repo, under its own config: an enabled repo3 is not checked by a repo2 rotation", () => {
    const { r, calls } = repoCheck(["2"], { ...OFFSITE_NAMES(2), ...OFFSITE_NAMES(3) });
    expect(r.status, r.stderr).toBe(0);
    expect(calls).toEqual([
      "pgbackrest --stanza=ds stanza-create",
      "pgbackrest --stanza=ds check",
      "pgbackrest-repo.sh 2 stanza-create",
      "pgbackrest-repo.sh 2 check",
    ]);
    const failing = repoCheck(["2"], { ...OFFSITE_NAMES(2) }, "pgbackrest-repo.sh 2 check");
    expect(failing.r.status).toBe(1);
  });

  it("repo-check.sh <repo> fails, checking nothing, when the rotation left that repo off", () => {
    const partial: Record<string, string> = { ...OFFSITE_NAMES(2) };
    delete partial.PGBACKREST_REPO2_S3_ENDPOINT;
    const { r, calls } = repoCheck(["2"], partial);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/repo2 is not on/);
    expect(calls).toEqual([]);
  });
});

describe("4298: the archive_command and the offsite pusher", () => {
  const SEG = (i: number) => `0000000100000000000000${i.toString(16).toUpperCase().padStart(2, "0")}`;

  // pgbackrest-archive.sh with a stub pgbackrest that logs and exits with $PUSH_RC.
  function archive(segs: number[], { rc = "0", max = "4", spools = [2, 3], unwritable = [] as number[] } = {}) {
    const stub = '#!/usr/bin/env bash\necho "$*" >> "$STUB_LOG"\nexit "$PUSH_RC"\n';
    const { root, bin } = fixtureBin([["pgbackrest", stub]]);
    const wal = join(root, "pg_wal");
    const spool = join(root, "spool");
    mkdirSync(wal, { recursive: true });
    for (const n of spools) mkdirSync(join(spool, `repo${n}`), { recursive: true });
    for (const n of unwritable) {
      // A spool the copy cannot write into: a directory where its temp file would go.
      for (const i of segs) mkdirSync(join(spool, `repo${n}`, `.${SEG(i)}.tmp`), { recursive: true });
    }
    const runs = segs.map((i) => {
      writeFileSync(join(wal, SEG(i)), `wal ${i}`);
      return spawnSync(POSIX_SHELL, [toPosixPath(ARCHIVE_SCRIPT), `pg_wal/${SEG(i)}`], {
        cwd: root,
        env: {
          PATH: `${toPosixPath(bin)}:/usr/bin:/bin`,
          STUB_LOG: toPosixPath(join(root, "calls.log")),
          PUSH_RC: rc,
          DS_OFFSITE_SPOOL: toPosixPath(spool),
          DS_OFFSITE_SPOOL_MAX: max,
        },
        encoding: "utf8",
      });
    });
    const ls = (n: number) =>
      existsSync(join(spool, `repo${n}`))
        ? readdirSync(join(spool, `repo${n}`)).filter((f) => !f.startsWith(".")).sort()
        : [];
    const gap = (n: number) =>
      existsSync(join(spool, `repo${n}.gap`)) ? readFileSync(join(spool, `repo${n}.gap`), "utf8") : null;
    const calls = existsSync(join(root, "calls.log")) ? readFileSync(join(root, "calls.log"), "utf8") : "";
    return { runs, ls, gap, calls, spool };
  }

  it("a segment repo1 holds is spooled once per offsite repo that is on, and archiving succeeds", () => {
    const a = archive([1, 2]);
    for (const run of a.runs) expect(run.status, run.stderr).toBe(0);
    expect(a.calls).toBe(`--stanza=ds archive-push pg_wal/${SEG(1)}\n--stanza=ds archive-push pg_wal/${SEG(2)}\n`);
    expect(a.ls(2)).toEqual([SEG(1), SEG(2)]);
    expect(a.ls(3)).toEqual([SEG(1), SEG(2)]);
    expect(readFileSync(join(a.spool, "repo2", SEG(2)), "utf8")).toBe("wal 2");
  });

  it("no offsite repo on → repo1's push alone, nothing spooled (today's repo1-only behaviour)", () => {
    const a = archive([1], { spools: [] });
    expect(a.runs[0].status).toBe(0);
    expect(a.calls).toBe(`--stanza=ds archive-push pg_wal/${SEG(1)}\n`);
    expect(existsSync(a.spool)).toBe(false);
  });

  it("repo1's push failing fails archive_command with its exit code and spools nothing", () => {
    const a = archive([1], { rc: "82" });
    expect(a.runs[0].status).toBe(82);
    expect(a.ls(2)).toEqual([]);
  });

  it("a spool that cannot be written is logged, never fails archiving, and the other repo still spools", () => {
    const a = archive([1], { unwritable: [2] });
    expect(a.runs[0].status).toBe(0);
    expect(a.runs[0].stderr).toMatch(new RegExp(`${SEG(1)} not spooled for repo2`));
    expect(a.ls(2)).toEqual([]);
    expect(a.ls(3)).toEqual([SEG(1)]);
  });

  it("past the cap the oldest segments are dropped and named in the repo's gap marker", () => {
    const a = archive([1, 2, 3, 4, 5, 6], { max: "4" });
    for (const run of a.runs) expect(run.status).toBe(0);
    expect(a.ls(2)).toEqual([SEG(3), SEG(4), SEG(5), SEG(6)]);
    expect(a.gap(2)).toMatch(new RegExp(`dropped ${SEG(1)}\\n.*dropped ${SEG(2)}\\n$`));
    expect(a.gap(3)).toMatch(new RegExp(`dropped ${SEG(2)}\\n$`));
    expect(a.runs[4].stderr).toMatch(/repo2 spool is over 4 segments; dropped/);
  });

  // wal-offsite-push.sh with a stub pgbackrest-repo.sh failing for the repos in $FAIL_REPOS.
  function push(spooled: Record<number, number[]>, failRepos = "") {
    const stub =
      '#!/usr/bin/env bash\necho "$*" >> "$STUB_LOG"\n' +
      '[[ " $FAIL_REPOS " == *" $1 "* ]] && exit 1\nexit 0\n';
    const { root, bin } = fixtureBin([
      ["pgbackrest-repo.sh", stub],
      ["flock", "#!/usr/bin/env bash\nexit 0\n"],
    ]);
    copyFileSync(PUSH_SCRIPT, join(bin, "wal-offsite-push.sh"));
    const spool = join(root, "spool");
    for (const [n, segs] of Object.entries(spooled)) {
      mkdirSync(join(spool, `repo${n}`), { recursive: true });
      for (const i of [...segs].reverse()) writeFileSync(join(spool, `repo${n}`, SEG(i)), "wal");
    }
    const r = spawnSync(POSIX_SHELL, [toPosixPath(join(bin, "wal-offsite-push.sh"))], {
      env: {
        PATH: `${toPosixPath(bin)}:/usr/bin:/bin`,
        STUB_LOG: toPosixPath(join(root, "calls.log")),
        FAIL_REPOS: failRepos,
        TMPDIR: toPosixPath(root),
        DS_PGBACKREST_ENV_FILE: toPosixPath(join(root, "none.env")),
        DS_OFFSITE_SPOOL: toPosixPath(spool),
      },
      encoding: "utf8",
    });
    const calls = existsSync(join(root, "calls.log"))
      ? readFileSync(join(root, "calls.log"), "utf8").trim().split("\n").filter(Boolean)
      : [];
    const ls = (n: number) => readdirSync(join(spool, `repo${n}`)).sort();
    return { r, calls, ls, spool: toPosixPath(spool) };
  }

  it("the pusher pushes each spool oldest first under its repo's config and deletes what it pushed", () => {
    const p = push({ 2: [1, 2, 3] });
    expect(p.r.status, p.r.stderr).toBe(0);
    expect(p.calls).toEqual(
      [1, 2, 3].map((i) => `2 --log-level-console=warn --log-level-file=off archive-push ${p.spool}/repo2/${SEG(i)}`),
    );
    expect(p.ls(2)).toEqual([]);
    expect(p.r.stdout).toMatch(/repo2: pushed 3 segment\(s\)/);
  });

  it("a repo that is down keeps its whole spool and does not hold up the other repo", () => {
    const p = push({ 2: [1, 2], 3: [1, 2] }, "2");
    expect(p.r.status, p.r.stderr).toBe(0);
    expect(p.calls.filter((c) => c.startsWith("2 "))).toHaveLength(1);
    expect(p.ls(2)).toEqual([SEG(1), SEG(2)]);
    expect(p.r.stdout).toMatch(new RegExp(`repo2: archive-push of ${SEG(1)} failed; 2 segment\\(s\\) wait in the spool`));
    expect(p.ls(3)).toEqual([]);
  });
});
