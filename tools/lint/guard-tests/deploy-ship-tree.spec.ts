import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { shipTreeCommand } from "../../deploy/prod.mjs";

const fixtureRoots: string[] = [];

function findPosixShell() {
  if (process.platform !== "win32") {
    return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  }

  const gitExecPath = execFileSync("git", ["--exec-path"], {
    encoding: "utf8",
  }).trim();
  const gitRoot = resolve(gitExecPath, "..", "..", "..");
  const candidates = [
    join(gitRoot, "bin", "bash.exe"),
    join(gitRoot, "usr", "bin", "bash.exe"),
  ];
  const shell = candidates.find(existsSync);
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
    ["-c", 'cygpath -u "$1"', "ship-tree-test", path],
    { encoding: "utf8" },
  ).trim();
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "ds-ship-tree-"));
  fixtureRoots.push(root);
  const home = join(root, "home");
  const live = join(home, "ds-platform");
  const compose = join(live, "infra", "deploy", "compose", "api-prod");
  const archiveRoot = join(root, "archive-root");
  const committedRoot = join(archiveRoot, "ds-platform");
  const archive = join(root, "tree.tar.gz");
  const composeEnv = Buffer.from(
    "DEPLOY_SHA=old\nSMARTCAPTCHA_SITE_KEY=public-fixture\n",
    "utf8",
  );

  mkdirSync(compose, { recursive: true });
  writeFileSync(join(compose, ".env"), composeEnv);
  writeFileSync(join(live, "untracked.txt"), "must not survive\n", "utf8");
  mkdirSync(committedRoot, { recursive: true });
  writeFileSync(join(committedRoot, "committed.txt"), "new tree\n", "utf8");
  execFileSync("tar", ["-czf", archive, "-C", archiveRoot, "ds-platform"]);

  return { root, home, live, archive, composeEnv };
}

// Shell-level `mv` failure injection, prepended to the ship script.
//
// A shell function shadows `mv` for the whole script — the swap AND the
// restore inside the EXIT trap — so the failure is injected by the shell's
// own command resolution order (function → builtin → PATH). The previous
// fixture instead dropped an executable `mv` shim into a directory prepended
// to PATH; that only fails the move when the OS actually executes the shim, so
// any runtime where the temp dir is mounted `noexec` (the containerised CI
// pool, #1230) or where the exec bit is not honoured silently falls through to
// the real `mv`, the swap succeeds, and the failure path is never exercised.
// A shell function has no file mode, no mount options and no exec bit.
//
// `command mv` reaches the real binary; `${VAR:-0}` keeps the shim safe under
// the script's `set -u`. Each injection announces itself on stderr so a shim
// that stops firing fails the test loudly instead of degrading into a
// green-but-vacuous run.
function mvFailureShim() {
  return [
    "mv() {",
    '  case "$1" in',
    "    */stage)",
    '      if [ "${FAIL_STAGE_TO_LIVE:-0}" = "1" ] && [ "$2" = "$HOME/ds-platform" ]; then',
    "        printf 'ship-test: injected mv failure (stage->live)\\n' >&2",
    "        return 71",
    "      fi",
    "      ;;",
    "    */previous)",
    '      if [ "${FAIL_RESTORE_TO_LIVE:-0}" = "1" ] && [ "$2" = "$HOME/ds-platform" ]; then',
    "        printf 'ship-test: injected mv failure (previous->live)\\n' >&2",
    "        return 72",
    "      fi",
    "      ;;",
    "  esac",
    '  command mv "$@"',
    "}",
    "",
  ].join("\n");
}

function runShip({
  home,
  archive,
  command = shipTreeCommand(),
  env = {},
}: {
  home: string;
  archive: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const result = spawnSync(POSIX_SHELL, ["-c", command], {
    env: { ...process.env, HOME: toPosixPath(home), ...env },
    input: readFileSync(archive),
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  return result;
}

function shipWorkdirs(home: string) {
  return readdirSync(home, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("ds-platform.ship."),
    )
    .map((entry) => join(home, entry.name));
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("prod deploy tree shipping (#1182)", () => {
  it("stages a clean tree, carries forward only api-prod compose .env, then swaps", () => {
    const command = shipTreeCommand();
    const extractAt = command.indexOf(
      'tar xzf - --strip-components=1 -C "$stage"',
    );
    const preserveAt = command.indexOf(
      'cp -p "$live/$preserved_rel" "$stage/$preserved_rel"',
    );
    const markSwapAt = command.indexOf("swapping=1");
    const moveLiveAsideAt = command.indexOf('mv "$live" "$previous"');
    const swapAt = command.indexOf('mv "$stage" "$live"');
    const clearSwapAt = command.indexOf("swapping=0", markSwapAt);

    expect(command).toContain(
      'work=$(mktemp -d "$HOME/ds-platform.ship.XXXXXX")',
    );
    expect(command).toContain('stage="$work/stage"');
    expect(command).toContain('previous="$work/previous"');
    expect(command).toContain(
      'preserved_rel="infra/deploy/compose/api-prod/.env"',
    );
    expect(command).toContain(
      '[ "$swapping" -eq 1 ] && [ ! -e "$live" ] && [ -e "$previous" ]',
    );
    expect(command).toContain('if ! mv "$previous" "$live"; then');
    expect(extractAt).toBeGreaterThan(-1);
    expect(preserveAt).toBeGreaterThan(extractAt);
    expect(markSwapAt).toBeGreaterThan(preserveAt);
    expect(moveLiveAsideAt).toBeGreaterThan(markSwapAt);
    expect(swapAt).toBeGreaterThan(moveLiveAsideAt);
    expect(clearSwapAt).toBeGreaterThan(swapAt);
    expect(command.match(/cp -p/g)).toHaveLength(1);
    expect(command.match(/rm -rf "\$work"/g)).toHaveLength(2);
    expect(command).not.toContain("$$");
    expect(command).not.toContain('rm -rf "$live"');
  });

  it("installs the committed tree, preserves only compose .env, and cleans workdir", () => {
    const fixture = createFixture();

    const result = runShip(fixture);

    expect(result.status).toBe(0);
    expect(readFileSync(join(fixture.live, "committed.txt"), "utf8")).toBe(
      "new tree\n",
    );
    expect(
      readFileSync(
        join(fixture.live, "infra", "deploy", "compose", "api-prod", ".env"),
      ),
    ).toEqual(fixture.composeEnv);
    expect(existsSync(join(fixture.live, "untracked.txt"))).toBe(false);
    expect(shipWorkdirs(fixture.home)).toEqual([]);
  });

  it("keeps the previous live tree when archive extraction fails", () => {
    const fixture = createFixture();
    const invalidArchive = join(fixture.root, "invalid.tar.gz");
    writeFileSync(invalidArchive, "not a tar archive\n", "utf8");

    const result = runShip({ ...fixture, archive: invalidArchive });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(fixture.live, "untracked.txt"), "utf8")).toBe(
      "must not survive\n",
    );
    expect(existsSync(join(fixture.live, "committed.txt"))).toBe(false);
    expect(shipWorkdirs(fixture.home)).toEqual([]);
  });

  it("restores the previous live tree when the staged-tree swap fails", () => {
    const fixture = createFixture();

    const result = runShip({
      ...fixture,
      command: `${mvFailureShim()}${shipTreeCommand()}`,
      env: { FAIL_STAGE_TO_LIVE: "1" },
    });

    // Proof the failure path really ran: the shim announced itself and its
    // exit status (71) travelled out through the EXIT trap. Asserting only
    // "nonzero" would pass on any unrelated error and — as on the CI pool —
    // could not tell a working injection from one that never fired.
    expect(result.stderr).toContain("injected mv failure (stage->live)");
    expect(result.status).toBe(71);
    expect(readFileSync(join(fixture.live, "untracked.txt"), "utf8")).toBe(
      "must not survive\n",
    );
    expect(existsSync(join(fixture.live, "committed.txt"))).toBe(false);
    expect(shipWorkdirs(fixture.home)).toEqual([]);
  });

  it("keeps previous live recoverable when both swap and restore moves fail", () => {
    const fixture = createFixture();

    const result = runShip({
      ...fixture,
      command: `${mvFailureShim()}${shipTreeCommand()}`,
      env: {
        FAIL_STAGE_TO_LIVE: "1",
        FAIL_RESTORE_TO_LIVE: "1",
      },
    });
    const workdirs = shipWorkdirs(fixture.home);

    expect(result.stderr).toContain("injected mv failure (stage->live)");
    expect(result.stderr).toContain("injected mv failure (previous->live)");
    expect(result.status).toBe(71);
    expect(workdirs).toHaveLength(1);
    expect(
      readFileSync(join(workdirs[0], "previous", "untracked.txt"), "utf8"),
    ).toBe("must not survive\n");
    expect(result.stderr).toContain(toPosixPath(join(workdirs[0], "previous")));
  });

  it("maps HUP to a nonzero exit status through the executable trap", () => {
    const fixture = createFixture();
    const command = shipTreeCommand().replace('mkdir -p "$stage"', () =>
      ['kill -HUP "$$"', 'mkdir -p "$stage"'].join("\n"),
    );

    const result = runShip({ ...fixture, command });

    expect(result.status).toBe(129);
    expect(shipWorkdirs(fixture.home)).toEqual([]);
  });
});
