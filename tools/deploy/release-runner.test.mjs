// tools/deploy/release-runner.test.mjs — the release workflow's runner entry
// (#3158; spec 2026-10-16-release-pipeline-off-workstation §3 item 3). `node --test`
// (pnpm test:tools).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PREFLIGHT_ORDER,
  parseRunnerArgs,
  preflightChecks,
  runPreflight,
  runRecord,
  stageSuiteProblem,
} from "./release-runner.mjs";

const SHA = "a".repeat(40);
const PREV = "b".repeat(40);

describe("parseRunnerArgs", () => {
  it("reads preflight --sha", () => {
    assert.deepEqual(parseRunnerArgs(["preflight", "--sha", SHA]), {
      command: "preflight",
      sha: SHA,
    });
  });

  it("reads record --sha --state --previous-sha", () => {
    assert.deepEqual(
      parseRunnerArgs([
        "record",
        "--sha",
        SHA,
        "--state",
        "failed",
        "--previous-sha",
        PREV,
      ]),
      { command: "record", sha: SHA, state: "failed", previousSha: PREV },
    );
  });

  it("an empty --previous-sha means no basis (the box reported none)", () => {
    assert.equal(
      parseRunnerArgs([
        "record",
        "--sha",
        SHA,
        "--state",
        "succeeded",
        "--previous-sha",
        "",
      ]).previousSha,
      null,
    );
  });

  it("refuses a short or non-hex sha, an unknown command and an unknown state", () => {
    assert.match(
      parseRunnerArgs(["preflight", "--sha", "abc"]).error,
      /full 40-hex/,
    );
    assert.match(parseRunnerArgs(["deploy", "--sha", SHA]).error, /command/);
    assert.match(
      parseRunnerArgs(["record", "--sha", SHA, "--state", "success"]).error,
      /succeeded\|failed/,
    );
    assert.match(
      parseRunnerArgs([
        "record",
        "--sha",
        SHA,
        "--state",
        "failed",
        "--previous-sha",
        "zz",
      ]).error,
      /previous-sha/,
    );
  });

  it("has no escape-hatch flag: any unknown flag is refused", () => {
    for (const flag of [
      "--skip-ci-check",
      "--release-gate-exempt",
      "--allow-live-broadcast",
      "--ref",
    ]) {
      assert.match(
        parseRunnerArgs(["preflight", "--sha", SHA, flag, "x"]).error,
        /unknown argument/,
        flag,
      );
    }
  });
});

describe("stageSuiteProblem", () => {
  const combined = (statuses) => ({ state: "pending", statuses });

  it("passes only a success `stage-suite` status", () => {
    assert.equal(
      stageSuiteProblem(
        combined([
          { context: "stage-suite", state: "success", description: "1 passed" },
        ]),
      ),
      null,
    );
  });

  it("refuses a missing check", () => {
    assert.match(
      stageSuiteProblem(combined([{ context: "other", state: "success" }])),
      /no `stage-suite` status/,
    );
    assert.match(stageSuiteProblem({}), /no `stage-suite` status/);
  });

  it("refuses a pending or red check, naming its state and description", () => {
    assert.match(
      stageSuiteProblem(
        combined([
          { context: "stage-suite", state: "failure", description: "3 failed" },
        ]),
      ),
      /`stage-suite` is failure: 3 failed/,
    );
    assert.match(
      stageSuiteProblem(
        combined([{ context: "stage-suite", state: "pending" }]),
      ),
      /is pending/,
    );
  });
});

describe("runPreflight", () => {
  const passing = (order, extra = {}) =>
    order.map((name) => ({
      name,
      run: async () => ({ line: `${name} ok`, ...(extra[name] ?? {}) }),
    }));

  it("the default checks run in the spec order", () => {
    const names = preflightChecks({ sha: SHA, repo: "o/r" }).map((c) => c.name);
    assert.deepEqual(names, PREFLIGHT_ORDER);
    assert.deepEqual(PREFLIGHT_ORDER, [
      "sha-in-main",
      "stage-suite",
      "ci",
      "release-gate",
      "live-broadcast",
      "recorded-images",
    ]);
  });

  it("all checks pass → ok, with the images run id", async () => {
    const lines = [];
    const res = await runPreflight({
      checks: passing(PREFLIGHT_ORDER, {
        "recorded-images": { imagesRunId: 42 },
      }),
      log: (l) => lines.push(l),
    });
    assert.deepEqual(res, { ok: true, imagesRunId: 42 });
    assert.equal(lines.length, PREFLIGHT_ORDER.length);
  });

  it("stops at the first refusal and runs nothing after it", async () => {
    const ran = [];
    const checks = PREFLIGHT_ORDER.map((name) => ({
      name,
      run: async () => {
        ran.push(name);
        if (name === "stage-suite") throw new Error("`stage-suite` is failure");
        return { line: "ok" };
      },
    }));
    const res = await runPreflight({ checks, log: () => {} });
    assert.equal(res.ok, false);
    assert.equal(res.failed, "stage-suite");
    assert.match(res.reason, /stage-suite/);
    assert.deepEqual(ran, ["sha-in-main", "stage-suite"]);
  });

  it("no images run id → refused (fail closed)", async () => {
    const res = await runPreflight({
      checks: passing(PREFLIGHT_ORDER),
      log: () => {},
    });
    assert.equal(res.ok, false);
    assert.equal(res.failed, "recorded-images");
  });
});

describe("runRecord", () => {
  const make = () => {
    const calls = [];
    return {
      calls,
      cut: (args) => {
        calls.push(["cut", args]);
        return { cut: true, tag: "release-2026.10.21-1" };
      },
      record: async (args) => {
        calls.push(["record", args]);
        return { ok: true, deploymentId: 9 };
      },
      log: () => {},
    };
  };

  it("succeeded: the release cut first, then the success record with the quote and the basis", async () => {
    const deps = make();
    const res = await runRecord({
      sha: SHA,
      state: "succeeded",
      previousSha: PREV,
      ownerQuote: "катим",
      ...deps,
    });
    assert.equal(res.ok, true);
    assert.deepEqual(
      deps.calls.map(([k]) => k),
      ["cut", "record"],
    );
    assert.equal(deps.calls[0][1].targetSha, SHA);
    assert.deepEqual(
      { ...deps.calls[1][1], log: undefined, healthUrl: undefined },
      {
        prevSha: PREV,
        sha: SHA,
        state: "success",
        ownerQuote: "катим",
        log: undefined,
        healthUrl: undefined,
      },
    );
  });

  it("failed: no release cut, a failure record with the quote", async () => {
    const deps = make();
    await runRecord({
      sha: SHA,
      state: "failed",
      previousSha: null,
      ownerQuote: "катим",
      ...deps,
    });
    assert.deepEqual(
      deps.calls.map(([k]) => k),
      ["record"],
    );
    assert.equal(deps.calls[0][1].state, "failure");
    assert.equal(deps.calls[0][1].ownerQuote, "катим");
  });

  it("refuses a blank quote before writing anything", async () => {
    const deps = make();
    await assert.rejects(
      runRecord({
        sha: SHA,
        state: "succeeded",
        previousSha: PREV,
        ownerQuote: " \n\t",
        ...deps,
      }),
      /owner_quote/,
    );
    assert.equal(deps.calls.length, 0);
  });

  it("a record that could not be written is reported, not thrown", async () => {
    const deps = make();
    deps.record = async () => ({ ok: false, error: "HTTP 422" });
    const res = await runRecord({
      sha: SHA,
      state: "failed",
      previousSha: null,
      ownerQuote: "q",
      ...deps,
    });
    assert.deepEqual(res, { ok: false, error: "HTTP 422" });
  });
});
