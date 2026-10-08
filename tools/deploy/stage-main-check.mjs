// DS Platform — the stage `main` release check `pnpm deploy:prod` runs as a
// pre-flight step (#2701; staging tech spec C4/C7, release-cycle spec §10.4 item 8).
//
// Environment-level risk (prod build, real IdP, real-shaped data) is covered once
// per release on the shared stage `main` slot at the release target SHA. The deploy
// does that itself instead of trusting a record: it converges the `main` slot to the
// target with the ordinary converge (`stage:slot up main --ref <sha>`), then runs the
// full stage suite with `e2e:stage main --expect-sha <sha>` — which refuses a slot
// serving another SHA and any narrowed run. Both run from a clean, detached checkout
// of the target SHA under the OS temp dir, so the scenarios executed are exactly the
// ones the target carries, never the operator's working tree. Nothing is written to
// GitHub: the stand is operated by hand (#2202) and the deploy log is the record.
//
// Fail-closed: a checkout, install, converge or suite failure refuses the deploy.
// The only bypass is the owner-go `--release-gate-exempt` flag (prod.mjs).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * The child env of the release check: the operator's env (it carries the stand
 * credentials) minus `E2E_GREP`, which `packages/e2e/playwright.config.ts` would
 * compile into a filter, plus `CI=1`, which turns the config's `forbidOnly` on.
 */
export function releaseCheckEnv(parentEnv) {
  const env = { ...parentEnv, CI: "1" };
  delete env.E2E_GREP;
  return env;
}

// `pnpm` is a `.cmd` shim on the Windows operator box, which `spawnSync` refuses to
// exec without a shell; every argument here is a fixed literal or a validated SHA.
const realEffects = {
  mkdtemp: () => mkdtempSync(path.join(tmpdir(), "ds-stage-main-")),
  rmdir: (dir) => rmSync(dir, { recursive: true, force: true }),
  run: (cmd, args, { cwd, env }) =>
    spawnSync(cmd, args, {
      cwd,
      env,
      stdio: "inherit",
      shell: cmd === "pnpm" && process.platform === "win32",
    }),
  log: (line) => console.log(line),
};

/**
 * Converge the stage `main` slot to `sha` and run the full suite against it.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function runStageMainCheck({
  sha,
  repoRoot,
  env = process.env,
  effects = realEffects,
}) {
  if (!FULL_SHA_RE.test(String(sha ?? ""))) {
    throw new Error(
      `stage main check needs a full 40-character lowercase SHA, got ${JSON.stringify(sha)}`,
    );
  }
  const short = sha.slice(0, 12);
  const childEnv = releaseCheckEnv(env);
  const scratch = effects.mkdtemp();
  const tree = path.join(scratch, "tree");
  const run = (cmd, args, cwd) =>
    effects.run(cmd, args, { cwd, env: childEnv }).status === 0;

  try {
    effects.log(`      clean checkout of ${short} → ${tree}`);
    if (!run("git", ["worktree", "add", "--detach", tree, sha], repoRoot)) {
      return {
        ok: false,
        reason: `could not make a clean checkout of ${short}`,
      };
    }
    if (!run("pnpm", ["install", "--frozen-lockfile"], tree)) {
      return {
        ok: false,
        reason: `\`pnpm install\` failed in the checkout of ${short}`,
      };
    }
    const node = process.execPath;
    if (
      !run(
        node,
        [path.join(tree, "tools/staging/slot.mjs"), "up", "main", "--ref", sha],
        tree,
      )
    ) {
      return {
        ok: false,
        reason: `the stage \`main\` slot did not converge to ${short} (\`stage:slot up main --ref ${sha}\` failed)`,
      };
    }
    const e2e = effects.run(
      node,
      [
        path.join(tree, "tools/staging/e2e-stage.mjs"),
        "main",
        "--expect-sha",
        sha,
      ],
      { cwd: tree, env: childEnv },
    ).status;
    if (e2e === 2) {
      return {
        ok: false,
        reason: `\`e2e:stage main\` refused the release check on ${short} — the slot does not serve the target, or the run was narrowed`,
      };
    }
    if (e2e !== 0) {
      return { ok: false, reason: `stage \`main\` suite FAILED on ${short}` };
    }
    return { ok: true };
  } finally {
    run("git", ["worktree", "remove", "--force", tree], repoRoot);
    effects.rmdir(scratch);
  }
}
