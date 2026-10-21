// tools/deploy/prod-stage-gate.test.mjs — the workstation release's stage gate
// (#3198; spec 2026-10-16-release-pipeline-off-workstation §3 item 3). A `main`
// target reads the Actions `stage-suite` commit status; a `--ref` hotfix target
// keeps the PC stage `main` check. `node --test` (pnpm test:tools).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stageGate, stageGatePrerequisites } from "./prod.mjs";
import { readStageSuiteProblem } from "./release-runner.mjs";

const SHA = "c5fa9c03".padEnd(40, "0");

const combined = (statuses) => ({ statuses });
const status = (state, description) => () =>
  combined([{ context: "stage-suite", state, description }]);

function mainGate(readCombined) {
  return stageGate({
    sha: SHA,
    hotfix: false,
    readStageSuite: (sha) => readStageSuiteProblem({ sha, read: readCombined }),
    runPcCheck: () => {
      throw new Error("a main target must not run the PC stage check");
    },
  });
}

describe("stageGate — main target reads the `stage-suite` status", () => {
  it("passes on a success status", async () => {
    const r = await mainGate(status("success", "150 passed, 0 failed"));
    assert.equal(r.ok, true);
    assert.match(r.line, /`stage-suite` is success for c5fa9c030000/);
  });

  it("refuses when the status is missing", async () => {
    const r = await mainGate(() =>
      combined([{ context: "ci", state: "success" }]),
    );
    assert.equal(r.ok, false);
    assert.match(r.reason, /no `stage-suite` status/);
  });

  it("refuses on a pending status", async () => {
    const r = await mainGate(status("pending", "running"));
    assert.equal(r.ok, false);
    assert.match(r.reason, /`stage-suite` is pending: running/);
  });

  it("refuses on a failure status", async () => {
    const r = await mainGate(status("failure", "3 failed"));
    assert.equal(r.ok, false);
    assert.match(r.reason, /`stage-suite` is failure: 3 failed/);
  });

  it("refuses when the status cannot be read", async () => {
    const r = await mainGate(() => {
      throw new Error("gh api exited 1");
    });
    assert.equal(r.ok, false);
    assert.match(
      r.reason,
      /cannot read the `stage-suite` status.*gh api exited 1/,
    );
  });

  it("reads the status of the target SHA", async () => {
    let asked;
    await mainGate((sha) => {
      asked = sha;
      return combined([{ context: "stage-suite", state: "success" }]);
    });
    assert.equal(asked, SHA);
  });
});

describe("stageGatePrerequisites", () => {
  it("a main target needs no PC prerequisites (no STAGE_BASIC_AUTH_PASS, no stage ssh)", async () => {
    const saved = process.env.STAGE_BASIC_AUTH_PASS;
    delete process.env.STAGE_BASIC_AUTH_PASS;
    try {
      const r = await stageGatePrerequisites({
        hotfix: false,
        checkPrerequisites: () => {
          throw new Error("a main target must not probe the PC prerequisites");
        },
      });
      assert.deepEqual(r, { ok: true, needed: false });
    } finally {
      if (saved !== undefined) process.env.STAGE_BASIC_AUTH_PASS = saved;
    }
  });

  it("a --ref target still probes them", async () => {
    let probed = false;
    const r = await stageGatePrerequisites({
      hotfix: true,
      checkPrerequisites: async () => {
        probed = true;
        return { ok: false, reason: "STAGE_BASIC_AUTH_PASS is not set" };
      },
    });
    assert.equal(probed, true);
    assert.deepEqual(r, {
      ok: false,
      needed: true,
      reason: "STAGE_BASIC_AUTH_PASS is not set",
    });
  });
});

describe("stageGate — --ref target keeps the PC stage check", () => {
  it("runs the PC check and never reads the status", async () => {
    let ran;
    const r = await stageGate({
      sha: SHA,
      hotfix: true,
      readStageSuite: () => {
        throw new Error(
          "a hotfix target must not read the `stage-suite` status",
        );
      },
      runPcCheck: (sha) => {
        ran = sha;
        return { ok: true };
      },
    });
    assert.equal(ran, SHA);
    assert.equal(r.ok, true);
    assert.match(r.line, /full stage suite PASSED/);
  });

  it("refuses on a red PC check", async () => {
    const r = await stageGate({
      sha: SHA,
      hotfix: true,
      readStageSuite: () => null,
      runPcCheck: () => ({ ok: false, reason: "3 tests failed" }),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /stage `main` check: 3 tests failed/);
  });
});
