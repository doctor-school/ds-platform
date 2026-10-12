import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  checkStageMainPrerequisites,
  releaseCheckEnv,
  runStageMainCheck,
} from "./stage-main-check.mjs";

/**
 * The stage `main` release check `pnpm deploy:prod` runs as a pre-flight step (#2701):
 * converge the `main` slot to the target SHA, then run the full stage suite from a
 * clean checkout of that SHA. Every process spawn is injected — nothing here touches
 * the stage box, prod or the real git worktree list.
 */

const SHA = "a".repeat(40);
const REPO = "/repo";
const TMP = "/tmp/ds-stage-main-x";

function harness(statusFor = () => 0) {
  const calls = [];
  const lines = [];
  const effects = {
    mkdtemp: () => TMP,
    rmdir: (dir) => calls.push({ cmd: "rmdir", args: [dir] }),
    run: (cmd, args, options) => {
      calls.push({ cmd, args, cwd: options.cwd, env: options.env });
      return { status: statusFor(cmd, args) };
    },
    log: (line) => lines.push(line),
  };
  return { calls, lines, effects };
}

const isE2e = (args) => args.some((a) => String(a).endsWith("e2e-stage.mjs"));
const isSlotUp = (args) => args.some((a) => String(a).endsWith("slot.mjs"));

describe("releaseCheckEnv", () => {
  it("clears E2E_GREP and turns forbid-only on, keeping the operator's credentials", () => {
    const env = releaseCheckEnv({
      E2E_GREP: "вход",
      STAGE_BASIC_AUTH_PASS: "s3cret",
    });
    assert.equal("E2E_GREP" in env, false);
    assert.equal(env.CI, "1");
    assert.equal(env.STAGE_BASIC_AUTH_PASS, "s3cret");
  });
});

describe("runStageMainCheck", () => {
  it("passes on a full green run at the target SHA, from a clean checkout of it", () => {
    const { calls, effects } = harness();
    const result = runStageMainCheck({
      sha: SHA,
      repoRoot: REPO,
      env: { E2E_GREP: "вход", STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(result.ok, true);

    const tree = calls[0].args.at(-2);
    assert.deepEqual(calls[0], {
      cmd: "git",
      args: ["worktree", "add", "--detach", tree, SHA],
      cwd: REPO,
      env: calls[0].env,
    });
    assert.equal(tree, path.join(TMP, "tree"));

    const slot = calls.find((c) => isSlotUp(c.args));
    assert.deepEqual(slot.args.slice(-4), ["up", "main", "--ref", SHA]);
    assert.equal(slot.cwd, tree);

    const e2e = calls.find((c) => isE2e(c.args));
    assert.deepEqual(e2e.args.slice(-3), ["main", "--expect-sha", SHA]);
    assert.equal(e2e.cwd, tree);
    assert.equal(e2e.env.CI, "1");
    assert.equal("E2E_GREP" in e2e.env, false);

    // Ordered: checkout → install → converge → suite → cleanup.
    const order = calls.map((c) =>
      c.cmd === "git"
        ? c.args[1]
        : isSlotUp(c.args)
          ? "slot"
          : isE2e(c.args)
            ? "e2e"
            : c.cmd === "rmdir"
              ? "rmdir"
              : c.args[0],
    );
    assert.deepEqual(order, [
      "add",
      "install",
      "slot",
      "e2e",
      "remove",
      "rmdir",
    ]);
  });

  it("refuses when the slot does not converge to the target SHA, without running the suite", () => {
    const { calls, effects } = harness((cmd, args) => (isSlotUp(args) ? 1 : 0));
    const result = runStageMainCheck({
      sha: SHA,
      repoRoot: REPO,
      env: {},
      effects,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /did not converge/);
    assert.equal(
      calls.some((c) => isE2e(c.args)),
      false,
    );
    assert.ok(calls.some((c) => c.cmd === "git" && c.args[1] === "remove"));
  });

  it("refuses when the slot serves another SHA or the run is narrowed (e2e:stage exit 2)", () => {
    const { effects } = harness((cmd, args) => (isE2e(args) ? 2 : 0));
    const result = runStageMainCheck({
      sha: SHA,
      repoRoot: REPO,
      env: {},
      effects,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /refused/);
  });

  it("refuses when the suite fails", () => {
    const { calls, effects } = harness((cmd, args) => (isE2e(args) ? 1 : 0));
    const result = runStageMainCheck({
      sha: SHA,
      repoRoot: REPO,
      env: {},
      effects,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /suite FAILED/);
    assert.ok(calls.some((c) => c.cmd === "git" && c.args[1] === "remove"));
  });

  it("refuses when the clean checkout cannot be made", () => {
    const { calls, effects } = harness((cmd, args) =>
      cmd === "git" && args[1] === "add" ? 128 : 0,
    );
    const result = runStageMainCheck({
      sha: SHA,
      repoRoot: REPO,
      env: {},
      effects,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /checkout/);
    assert.equal(
      calls.some((c) => isSlotUp(c.args)),
      false,
    );
  });

  it("refuses a target that is not a full SHA before spawning anything", () => {
    const { calls, effects } = harness();
    assert.throws(
      () =>
        runStageMainCheck({ sha: "abc123", repoRoot: REPO, env: {}, effects }),
      /40-character/,
    );
    assert.equal(calls.length, 0);
  });
});

describe("checkStageMainPrerequisites", () => {
  // #2806: the deploy probes what the check needs in its first seconds, before
  // the clean checkout, install and converge — never a spawn of those here.
  const reachable = () => {
    const calls = [];
    return { calls, probeSsh: async (dest) => void calls.push(dest) };
  };

  it("passes when the password is set and the stage box answers over ssh", async () => {
    const { calls, probeSsh } = reachable();
    const result = await checkStageMainPrerequisites({
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      destination: "ds-stage-1",
      probeSsh,
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, ["ds-stage-1"]);
  });

  it("refuses a missing STAGE_BASIC_AUTH_PASS, naming it and the fix", async () => {
    const { probeSsh } = reachable();
    const result = await checkStageMainPrerequisites({
      env: {},
      destination: "ds-stage-1",
      probeSsh,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /STAGE_BASIC_AUTH_PASS is not set/);
    assert.match(result.reason, /Export it/);
  });

  it("refuses an unreachable stage box, naming the destination and the ssh error", async () => {
    const result = await checkStageMainPrerequisites({
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      destination: "ds-stage-1",
      probeSsh: async () => {
        throw new Error(
          "ssh capture on ds-stage-1 exited 255: ssh: connect to host 1.2.3.4 port 22: Connection timed out",
        );
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /ds-stage-1/);
    assert.match(result.reason, /Connection timed out/);
    assert.match(result.reason, /DS_STAGE_SSH/);
  });

  it("names both missing prerequisites in one refusal", async () => {
    const result = await checkStageMainPrerequisites({
      env: { STAGE_BASIC_AUTH_PASS: "" },
      destination: "ds-stage-1",
      probeSsh: async () => {
        throw new Error("ssh capture on ds-stage-1 aborted");
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /STAGE_BASIC_AUTH_PASS/);
    assert.match(result.reason, /unreachable/);
  });
});
