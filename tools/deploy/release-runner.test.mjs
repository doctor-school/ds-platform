// tools/deploy/release-runner.test.mjs — the release workflow's runner entry
// (#3158; spec 2026-10-16-release-pipeline-off-workstation §3 item 3). `node --test`
// (pnpm test:tools).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDeploymentPayload } from "./deployment-record.mjs";
import {
  PREFLIGHT_ORDER,
  REDEPLOY_PREFLIGHT_ORDER,
  ROLLBACK_PREFLIGHT_ORDER,
  buildRollbackNotice,
  liveProdShaViaGh,
  parseRunnerArgs,
  preflightChecks,
  redeployPreflightChecks,
  reportRecord,
  rollbackPreflightChecks,
  rollbackVerdict,
  runPreflight,
  runRecord,
  runRedeployRecord,
  runRollbackNotice,
  runRollbackRecord,
  stageSuiteProblem,
  successRecordExistsViaGh,
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

  it("reads record --state unknown (the runner lost contact with the driver)", () => {
    assert.equal(
      parseRunnerArgs(["record", "--sha", SHA, "--state", "unknown"]).state,
      "unknown",
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
      /succeeded\|failed\|unknown/,
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
      successRecorded: async (sha) => {
        calls.push(["lookup", sha]);
        return false;
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
    assert.equal(res.recorded, "new");
    assert.deepEqual(
      deps.calls.map(([k]) => k),
      ["lookup", "cut", "record"],
    );
    assert.equal(deps.calls[0][1], SHA);
    assert.equal(deps.calls[1][1].targetSha, SHA);
    assert.deepEqual(
      { ...deps.calls[2][1], log: undefined, healthUrl: undefined },
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

  it("unknown (lost contact): no cut, no lookup, an `error` record with the quote", async () => {
    const deps = make();
    const res = await runRecord({
      sha: SHA,
      state: "unknown",
      previousSha: PREV,
      ownerQuote: "катим",
      ...deps,
    });
    assert.equal(res.recorded, "new");
    assert.deepEqual(
      deps.calls.map(([k]) => k),
      ["record"],
    );
    assert.equal(deps.calls[0][1].state, "error");
    assert.equal(deps.calls[0][1].ownerQuote, "катим");
    assert.equal(deps.calls[0][1].prevSha, PREV);
  });

  it("succeeded with a success record already on the SHA: no cut, no second record", async () => {
    const deps = make();
    const lines = [];
    deps.log = (l) => lines.push(l);
    deps.successRecorded = async (sha) => {
      deps.calls.push(["lookup", sha]);
      return true;
    };
    const res = await runRecord({
      sha: SHA,
      state: "succeeded",
      previousSha: PREV,
      ownerQuote: "катим",
      ...deps,
    });
    assert.deepEqual(res, { ok: true, recorded: "existing" });
    assert.deepEqual(
      deps.calls.map(([k]) => k),
      ["lookup"],
    );
    assert.ok(lines.some((l) => l.startsWith("↷ already recorded")));
  });

  it("succeeded after a lost-contact `error` record: records success and cuts (the re-dispatch recovery)", async () => {
    const deps = make();
    const res = await runRecord({
      sha: SHA,
      state: "succeeded",
      previousSha: PREV,
      ownerQuote: "катим",
      ...deps,
    });
    assert.equal(res.recorded, "new");
    assert.deepEqual(
      deps.calls.map(([k]) => k),
      ["lookup", "cut", "record"],
    );
    assert.equal(deps.calls[2][1].state, "success");
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
    assert.deepEqual(res, { ok: false, error: "HTTP 422", recorded: "new" });
  });
});

describe("reportRecord", () => {
  it("a written record → exit 0 and recorded=new for the workflow", () => {
    assert.deepEqual(reportRecord({ ok: true, recorded: "new" }), {
      exitCode: 0,
      output: "recorded=new\n",
      message: null,
    });
  });

  it("an already-recorded success → exit 0 and recorded=existing", () => {
    assert.deepEqual(reportRecord({ ok: true, recorded: "existing" }), {
      exitCode: 0,
      output: "recorded=existing\n",
      message: null,
    });
  });

  it("a record that could not be written fails the job with an ::error::", () => {
    const r = reportRecord({ ok: false, error: "HTTP 422", recorded: "new" });
    assert.equal(r.exitCode, 1);
    assert.equal(r.output, null);
    assert.match(
      r.message,
      /^::error::the Deployment record was not written: HTTP 422/,
    );
  });
});

describe("successRecordExistsViaGh", () => {
  const fake = (deployments, statuses) => {
    const calls = [];
    return {
      calls,
      gh: (args) => {
        calls.push(args);
        const p = args[1];
        if (p.startsWith("repos/{owner}/{repo}/deployments?")) {
          return JSON.stringify(deployments);
        }
        const id = Number(p.split("/")[4]);
        return JSON.stringify(statuses[id] ?? []);
      },
    };
  };

  it("asks for this SHA's production Deployments only", async () => {
    const f = fake([], {});
    assert.equal(await successRecordExistsViaGh({ sha: SHA, gh: f.gh }), false);
    assert.equal(f.calls[0][0], "api");
    assert.match(f.calls[0][1], new RegExp(`sha=${SHA}`));
    assert.match(f.calls[0][1], /environment=production/);
  });

  it("true when a Deployment of the SHA carries a success status", async () => {
    const f = fake([{ id: 1 }, { id: 2 }], {
      1: [{ state: "error" }],
      2: [{ state: "success" }, { state: "in_progress" }],
    });
    assert.equal(await successRecordExistsViaGh({ sha: SHA, gh: f.gh }), true);
  });

  it("false when only an `error` (lost contact) or a failure record exists", async () => {
    const f = fake([{ id: 1 }, { id: 2 }], {
      1: [{ state: "error" }],
      2: [{ state: "failure" }],
    });
    assert.equal(await successRecordExistsViaGh({ sha: SHA, gh: f.gh }), false);
  });

  it("a success a later release made inactive still counts as recorded", async () => {
    const f = fake([{ id: 1 }], {
      1: [{ state: "inactive" }, { state: "success" }],
    });
    assert.equal(await successRecordExistsViaGh({ sha: SHA, gh: f.gh }), true);
  });
});

// --- #2987: rollback mode (spec §3 item 3 «Rollback mode», §5 «Prod rollback») ---

describe("parseRunnerArgs — rollback commands", () => {
  it("reads rollback-preflight, rollback-record, rollback-notice and rollback-verdict", () => {
    assert.deepEqual(parseRunnerArgs(["rollback-preflight", "--sha", SHA]), {
      command: "rollback-preflight",
      sha: SHA,
    });
    assert.deepEqual(
      parseRunnerArgs([
        "rollback-record",
        "--sha",
        SHA,
        "--state",
        "failed",
        "--from-sha",
        PREV,
      ]),
      {
        command: "rollback-record",
        sha: SHA,
        state: "failed",
        fromSha: PREV,
        why: null,
        start: null,
      },
    );
    assert.deepEqual(
      parseRunnerArgs(["rollback-notice", "--sha", SHA, "--state", "unknown"]),
      { command: "rollback-notice", sha: SHA, state: "unknown", why: null },
    );
    assert.deepEqual(parseRunnerArgs(["rollback-verdict", "--sha", SHA]), {
      command: "rollback-verdict",
      sha: SHA,
      since: null,
    });
  });

  it("an empty --from-sha means none; a bad one is refused", () => {
    const base = ["rollback-record", "--sha", SHA, "--state", "succeeded"];
    assert.equal(parseRunnerArgs([...base, "--from-sha", ""]).fromSha, null);
    assert.match(
      parseRunnerArgs([...base, "--from-sha", "zz"]).error,
      /from-sha/,
    );
  });

  it("has no escape hatch in rollback mode either", () => {
    for (const flag of ["--skip-ci-check", "--previous-sha", "--ref"]) {
      assert.match(
        parseRunnerArgs(["rollback-preflight", "--sha", SHA, flag, "x"]).error,
        /unknown argument/,
        flag,
      );
    }
  });
});

describe("3219: the rollback's real outcome after lost contact", () => {
  const LIVE = "d".repeat(40);
  const reply = (active, rc, record) =>
    JSON.stringify({
      rollback: record && { kind: "rollback", sha: SHA, from: LIVE, ...record },
      driver: { unit: "u", active, rc, previousSha: null },
    });

  it("reads --why on rollback-record / rollback-notice, --start on rollback-record, --since on rollback-verdict", () => {
    const rec = parseRunnerArgs([
      "rollback-record", "--sha", SHA, "--state", "unknown",
      "--why", "timeout", "--start", "ssh-lost",
    ]);
    assert.equal(rec.why, "timeout");
    assert.equal(rec.start, "ssh-lost");
    for (const why of ["lost-contact", "timeout", "not-started"]) {
      assert.equal(
        parseRunnerArgs(["rollback-notice", "--sha", SHA, "--state", "unknown", "--why", why]).why,
        why,
      );
    }
    assert.equal(
      parseRunnerArgs(["rollback-notice", "--sha", SHA, "--state", "unknown", "--why", ""]).why,
      null,
    );
    assert.match(
      parseRunnerArgs(["rollback-notice", "--sha", SHA, "--state", "unknown", "--why", "nope"]).error,
      /--why must be/,
    );
    assert.match(
      parseRunnerArgs(["rollback-record", "--sha", SHA, "--state", "succeeded", "--start", "nope"]).error,
      /--start must be/,
    );
    assert.equal(
      parseRunnerArgs(["rollback-verdict", "--sha", SHA, "--since", "1761600000"]).since,
      1761600000,
    );
    assert.match(
      parseRunnerArgs(["rollback-verdict", "--sha", SHA, "--since", "soon"]).error,
      /--since must be/,
    );
  });

  it("no record and a finished or absent unit is `absent`, still a failure verdict", () => {
    for (const active of ["absent", "inactive"]) {
      const v = rollbackVerdict(reply(active, null, null), SHA);
      assert.equal(v.absent, true, active);
      assert.equal(v.terminal, "failed", active);
    }
    assert.equal(rollbackVerdict(reply("active", null, null), SHA).absent, false);
    const ran = rollbackVerdict(reply("inactive", 0, { state: "succeeded" }), SHA);
    assert.equal(ran.absent, false);
  });

  it("--since: a record that ended before this run's start call is an earlier attempt, read as absent", () => {
    const since = Date.parse("2026-10-28T10:00:00Z") / 1000;
    const stale = reply("inactive", 1, {
      state: "failed",
      startedAt: "2026-10-28T08:00:00Z",
      endedAt: "2026-10-28T08:05:00Z",
    });
    const v = rollbackVerdict(stale, SHA, { since });
    assert.equal(v.absent, true);
    assert.equal(v.terminal, "failed");
    // An attempt ending after the call (or within the 120-s clock margin) is this run's.
    const fresh = reply("inactive", 0, {
      state: "succeeded",
      startedAt: "2026-10-28T09:59:00Z",
      endedAt: "2026-10-28T10:03:00Z",
    });
    assert.equal(rollbackVerdict(fresh, SHA, { since }).terminal, "succeeded");
    assert.equal(rollbackVerdict(fresh, SHA, { since }).absent, false);
    // A running unit is polled whatever its record's age.
    const attached = reply("active", null, {
      state: "running",
      startedAt: "2026-10-28T08:00:00Z",
      endedAt: null,
    });
    assert.equal(rollbackVerdict(attached, SHA, { since }).terminal, null);
  });

  it("the record and the notice tell lost contact, the time-out and a start that never ran apart", () => {
    const descriptions = new Set();
    const notices = new Set();
    for (const why of ["lost-contact", "timeout", "not-started"]) {
      const { status } = buildDeploymentPayload({
        sha: SHA,
        notesText: "",
        healthUrl: "https://api.example/v1/health",
        state: "error",
        rollback: { reason: "x", unknownReason: why },
      });
      descriptions.add(status.description);
      notices.add(buildRollbackNotice({ sha: SHA, state: "unknown", reason: "x", why }));
    }
    assert.equal(descriptions.size, 3);
    assert.equal(notices.size, 3);
    const lost = buildDeploymentPayload({
      sha: SHA,
      notesText: "",
      healthUrl: "https://api.example/v1/health",
      state: "error",
      rollback: { reason: "x" },
    });
    assert.match(lost.status.description, /lost contact with the driver/);
    assert.match(
      buildRollbackNotice({ sha: SHA, state: "unknown", reason: "x", why: "timeout" }),
      /30 минут/,
    );
    assert.match(
      buildRollbackNotice({ sha: SHA, state: "unknown", reason: "x", why: "not-started" }),
      /не начался/,
    );
  });

  it("a success read after a re-run says it was recovered", async () => {
    const calls = [];
    await runRollbackRecord({
      sha: SHA,
      state: "succeeded",
      fromSha: LIVE,
      reason: "x",
      start: "already-succeeded",
      create: (a) => (calls.push(a), { ok: true, deploymentId: 1 }),
      log: () => {},
    });
    assert.deepEqual(calls[0].rollback, { reason: "x", from: LIVE, unknownReason: null, recovered: true });
    const { status } = buildDeploymentPayload({
      sha: SHA,
      notesText: "",
      healthUrl: "https://api.example/v1/health",
      state: "success",
      rollback: calls[0].rollback,
    });
    assert.match(status.description, /recovered by a re-run/);
  });
});

describe("rollbackPreflightChecks", () => {
  const LIVE = "d".repeat(40);
  const OTHER = "c".repeat(40);
  const rel = (tag, target, extra = {}) => ({
    tag_name: tag,
    target_commitish: target,
    draft: false,
    ...extra,
  });
  const world = (over = {}) => {
    const w = {
      reason: "smoke red after release-2026.10.21-1",
      releases: [
        rel("release-2026.10.21-1", LIVE),
        rel("release-2026.10.20-2", SHA),
        rel("release-2026.10.20-1", OTHER),
      ],
      deployments: [{ id: 2, sha: LIVE }],
      statuses: { 2: [{ state: "success" }] },
      compare: "behind",
      images: async () => ({
        ref: "main",
        run: { url: "https://example.test/run/7", databaseId: 7 },
      }),
      calls: [],
      ...over,
    };
    w.gh = (args) => {
      w.calls.push(args);
      const p = args[1];
      if (p.includes("/releases")) return JSON.stringify(w.releases);
      if (p.includes("/compare/")) return JSON.stringify({ status: w.compare });
      if (p.includes("/statuses")) {
        return JSON.stringify(w.statuses[Number(p.split("/")[4])] ?? []);
      }
      if (p.includes("/deployments")) return JSON.stringify(w.deployments);
      throw new Error(`unexpected gh ${p}`);
    };
    return w;
  };
  const preflight = (w) =>
    runPreflight({
      checks: rollbackPreflightChecks({
        sha: SHA,
        repo: "o/r",
        reason: w.reason,
        gh: w.gh,
        resolveImages: w.images,
      }),
      log: () => {},
    });

  it("checks the reason, a recent release, behind live and the manifest — no stage-suite, gate or broadcast", () => {
    assert.deepEqual(ROLLBACK_PREFLIGHT_ORDER, [
      "reason",
      "recent-release",
      "behind-live",
      "recorded-images",
    ]);
    const names = rollbackPreflightChecks({ sha: SHA, repo: "o/r" }).map(
      (c) => c.name,
    );
    assert.deepEqual(names, [...ROLLBACK_PREFLIGHT_ORDER]);
    for (const banned of [
      "stage-suite",
      "release-gate",
      "live-broadcast",
      "ci",
    ])
      assert.equal(names.includes(banned), false, banned);
  });

  it("passes a recent release behind the live SHA with its manifest", async () => {
    const w = world();
    assert.deepEqual(await preflight(w), { ok: true, imagesRunId: 7 });
    assert.ok(
      w.calls.some((a) => a[1] === `repos/o/r/compare/${LIVE}...${SHA}`),
      "compares <live>...<sha>",
    );
  });

  it("refuses an empty or whitespace-only reason before anything is asked", async () => {
    for (const reason of ["", "   \n\t", undefined]) {
      const w = world({ reason });
      const res = await preflight(w);
      assert.equal(res.ok, false);
      assert.equal(res.failed, "reason");
      assert.equal(w.calls.length, 0);
    }
  });

  it("refuses a SHA that is not the target of one of the latest 3 release-* Releases", async () => {
    const w = world({
      releases: [
        rel("release-2026.10.21-1", LIVE),
        rel("release-2026.10.20-2", OTHER),
        rel("release-2026.10.20-1", OTHER),
        rel("release-2026.10.19-1", SHA),
      ],
    });
    const res = await preflight(w);
    assert.equal(res.failed, "recent-release");
    assert.match(res.reason, /latest 3 release-\* Releases/);
  });

  it("orders Releases by date and sequence, skips drafts and non-release tags", async () => {
    const w = world({
      releases: [
        rel("release-2026.10.19-1", SHA),
        rel("release-2026.10.21-1", LIVE),
        rel("release-2026.10.20-10", OTHER),
        rel("release-2026.10.20-9", OTHER),
        rel("release-2026.10.22-1", OTHER, { draft: true }),
        rel("v1.2.3", OTHER),
      ],
    });
    assert.equal((await preflight(w)).failed, "recent-release");
    w.releases.splice(3, 1); // without -9 the SHA's release is the third
    assert.equal((await preflight(w)).ok, true);
  });

  for (const status of ["ahead", "identical", "diverged"]) {
    it(`refuses a target whose compare with the live SHA is ${status}`, async () => {
      const res = await preflight(world({ compare: status }));
      assert.equal(res.failed, "behind-live");
      assert.match(res.reason, new RegExp(status));
    });
  }

  it("the live SHA is the latest production Deployment with a success status", async () => {
    const w = world({
      deployments: [
        { id: 3, sha: OTHER },
        { id: 2, sha: LIVE },
      ],
      statuses: {
        3: [{ state: "failure" }],
        2: [{ state: "inactive" }, { state: "success" }],
      },
    });
    assert.equal(await liveProdShaViaGh({ repo: "o/r", gh: w.gh }), LIVE);
  });

  it("refuses when no successful production Deployment names the live SHA", async () => {
    const res = await preflight(world({ deployments: [] }));
    assert.equal(res.failed, "behind-live");
    assert.match(res.reason, /live prod SHA is unknown/);
  });

  it("refuses when no images-<sha>.json is recorded", async () => {
    const res = await preflight(
      world({
        images: async () => {
          throw new Error("no runtime-images run recorded images for this SHA");
        },
      }),
    );
    assert.equal(res.failed, "recorded-images");
  });
});

describe("rollbackVerdict", () => {
  const LIVE = "d".repeat(40);
  const reply = (active, rc, state, extra = {}) =>
    JSON.stringify({
      rollback:
        state === null
          ? null
          : { kind: "rollback", sha: SHA, state, from: LIVE, ...extra },
      driver: { unit: "u", active, rc, previousSha: null },
    });

  it("running while the unit runs", () => {
    for (const active of ["active", "activating"]) {
      const v = rollbackVerdict(reply(active, null, "running"), SHA);
      assert.equal(v.terminal, null, active);
      assert.equal(v.line, `driver=${active} rc=- state=running`);
    }
  });

  it("succeeded only for an rc-0 finished unit whose record says succeeded", () => {
    const v = rollbackVerdict(reply("inactive", 0, "succeeded"), SHA);
    assert.equal(v.terminal, "succeeded");
    assert.equal(v.from, LIVE);
  });

  it("a dead or failed unit whose record still says running is a failure", () => {
    for (const [active, rc] of [
      ["failed", 137],
      ["inactive", 0],
      ["absent", null],
    ]) {
      assert.equal(
        rollbackVerdict(reply(active, rc, "running"), SHA).terminal,
        "failed",
        active,
      );
    }
  });

  it("a red unit or record is a failure; no record and no unit is a failure", () => {
    assert.equal(
      rollbackVerdict(reply("failed", 1, "failed"), SHA).terminal,
      "failed",
    );
    assert.equal(
      rollbackVerdict(reply("inactive", 0, "failed"), SHA).terminal,
      "failed",
    );
    assert.equal(
      rollbackVerdict(reply("absent", null, null), SHA).terminal,
      "failed",
    );
  });

  it("an unreadable reply or another SHA's record is not a verdict", () => {
    assert.equal(rollbackVerdict("{nope", SHA).terminal, null);
    assert.equal(rollbackVerdict("{nope", SHA).line, "unreadable reply");
    const other = rollbackVerdict(
      reply("inactive", 0, "succeeded", { sha: PREV }),
      SHA,
    );
    assert.equal(other.terminal, null);
    assert.equal(other.line, "unreadable reply");
  });
});

describe("runRollbackRecord", () => {
  const make = () => {
    const calls = [];
    return {
      calls,
      create: (args) => {
        calls.push(args);
        return { ok: true, deploymentId: 11 };
      },
      log: () => {},
    };
  };

  for (const [state, deploymentState] of [
    ["succeeded", "success"],
    ["failed", "failure"],
    ["unknown", "error"],
  ]) {
    it(`${state}: ONE ${deploymentState} record, no release cut, the reason attached`, async () => {
      const deps = make();
      const res = await runRollbackRecord({
        sha: SHA,
        state,
        fromSha: PREV,
        reason: "login down",
        ...deps,
      });
      assert.deepEqual(res, { ok: true, deploymentId: 11, recorded: "new" });
      assert.equal(deps.calls.length, 1);
      const [args] = deps.calls;
      assert.equal(args.state, deploymentState);
      assert.equal(args.releaseTag, null);
      assert.equal(args.notesText, "");
      assert.deepEqual(args.rollback, {
        reason: "login down",
        from: PREV,
        unknownReason: null,
        recovered: false,
      });
    });
  }

  it("refuses a blank reason before writing anything", async () => {
    const deps = make();
    await assert.rejects(
      runRollbackRecord({
        sha: SHA,
        state: "succeeded",
        reason: "  ",
        ...deps,
      }),
      /reason is empty/,
    );
    assert.equal(deps.calls.length, 0);
  });
});

describe("buildDeploymentPayload — rollback", () => {
  const base = {
    sha: SHA,
    releaseTag: null,
    notesText: "",
    healthUrl: "https://api.example/v1/health",
    nowIso: "2026-10-22T00:00:00.000Z",
  };

  it("describes the record `rollback to <sha12> — <reason>` and keeps the reason in the payload", () => {
    const { deployment, status } = buildDeploymentPayload({
      ...base,
      state: "success",
      rollback: { reason: "логин не работает 🔥", from: PREV },
    });
    assert.equal(
      deployment.description,
      `rollback to ${SHA.slice(0, 12)} — логин не работает `,
    );
    assert.equal(deployment.payload.kind, "rollback");
    assert.equal(deployment.payload.reason, "логин не работает 🔥");
    assert.equal(deployment.payload.from, PREV);
    assert.equal(deployment.payload.ownerQuote, null);
    assert.equal(status.state, "success");
    assert.equal(status.description, `rollback to ${SHA.slice(0, 12)}`);
  });

  it("a failed or lost-contact rollback says so in its status", () => {
    const failed = buildDeploymentPayload({
      ...base,
      state: "failure",
      rollback: { reason: "x" },
    });
    assert.equal(
      failed.deployment.description,
      `rollback to ${SHA.slice(0, 12)} — x`,
    );
    assert.match(failed.status.description, /^rollback failed @ /);
    const unknown = buildDeploymentPayload({
      ...base,
      state: "error",
      rollback: { reason: "x" },
    });
    assert.match(unknown.status.description, /^rollback verdict unknown @ /);
  });

  it("stays within GitHub's 140-char description cap", () => {
    const { deployment } = buildDeploymentPayload({
      ...base,
      state: "success",
      rollback: { reason: "r".repeat(400) },
    });
    assert.equal(deployment.description.length, 140);
  });
});

describe("rollback notice", () => {
  it("is «откат прода на <sha12>: <reason>» with the outcome", () => {
    const text = buildRollbackNotice({
      sha: SHA,
      state: "succeeded",
      reason: "smoke red",
    });
    assert.equal(
      text.split("\n")[0],
      `откат прода на ${SHA.slice(0, 12)}: smoke red`,
    );
    assert.notEqual(
      buildRollbackNotice({ sha: SHA, state: "failed", reason: "x" }),
      buildRollbackNotice({ sha: SHA, state: "succeeded", reason: "x" }),
    );
  });

  it("posts it through the digest's Mattermost helper; no webhook skips green", async () => {
    const posted = [];
    const post = async (args) => posted.push(args);
    await runRollbackNotice({
      sha: SHA,
      state: "failed",
      reason: "x",
      webhook: "https://mm.example/hooks/1",
      post,
      log: () => {},
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].webhook, "https://mm.example/hooks/1");
    assert.match(posted[0].text, /^откат прода на /);
    await runRollbackNotice({
      sha: SHA,
      state: "failed",
      reason: "x",
      webhook: "",
      post,
      log: () => {},
    });
    assert.equal(posted.length, 1);
  });
});

// --- #3354: redeploy mode -------------------------------------------------------

describe("parseRunnerArgs — redeploy commands", () => {
  it("reads redeploy-preflight and redeploy-record", () => {
    assert.deepEqual(parseRunnerArgs(["redeploy-preflight", "--sha", SHA]), {
      command: "redeploy-preflight",
      sha: SHA,
    });
    assert.deepEqual(
      parseRunnerArgs(["redeploy-record", "--sha", SHA, "--state", "unknown"]),
      { command: "redeploy-record", sha: SHA, state: "unknown" },
    );
  });

  it("has no escape hatch: a basis, a reason or any other flag is refused", () => {
    for (const flag of ["--previous-sha", "--from-sha", "--ref", "--force"]) {
      assert.match(
        parseRunnerArgs([
          "redeploy-record",
          "--sha",
          SHA,
          "--state",
          "succeeded",
          flag,
          PREV,
        ]).error,
        /unknown argument/,
        flag,
      );
    }
    assert.match(
      parseRunnerArgs(["redeploy-preflight", "--sha", SHA, "--state", "x"])
        .error,
      /unknown argument/,
    );
  });
});

describe("redeployPreflightChecks", () => {
  const world = (over = {}) => {
    const w = {
      ownerQuote: "перезапусти прод с капчей",
      deployments: [{ id: 5, sha: SHA }],
      statuses: { 5: [{ state: "inactive" }, { state: "success" }] },
      images: async () => ({
        ref: "main",
        run: { url: "https://example.test/run/9", databaseId: 9 },
      }),
      calls: [],
      ...over,
    };
    w.gh = (args) => {
      w.calls.push(args);
      const p = args[1];
      if (p.includes("/statuses")) {
        return JSON.stringify(w.statuses[Number(p.split("/")[4])] ?? []);
      }
      if (p.includes("/deployments")) return JSON.stringify(w.deployments);
      throw new Error(`unexpected gh ${p}`);
    };
    return w;
  };
  const preflight = (w) =>
    runPreflight({
      checks: redeployPreflightChecks({
        sha: SHA,
        repo: "o/r",
        ownerQuote: w.ownerQuote,
        gh: w.gh,
        resolveImages: w.images,
      }),
      log: () => {},
    });

  it("checks the quote, that the SHA was released, and the manifest — no stage-suite, CI, gate or broadcast", () => {
    assert.deepEqual(REDEPLOY_PREFLIGHT_ORDER, [
      "owner-quote",
      "released",
      "recorded-images",
    ]);
    const names = redeployPreflightChecks({ sha: SHA, repo: "o/r" }).map(
      (c) => c.name,
    );
    assert.deepEqual(names, [...REDEPLOY_PREFLIGHT_ORDER]);
  });

  it("passes a SHA with a success production Deployment and its manifest", async () => {
    const w = world();
    assert.deepEqual(await preflight(w), { ok: true, imagesRunId: 9 });
    assert.ok(
      w.calls.some((a) =>
        a[1].includes(`deployments?sha=${SHA}&environment=production`),
      ),
      "asks for this SHA's production Deployments",
    );
  });

  it("refuses a blank owner quote before anything is asked", async () => {
    const w = world({ ownerQuote: " \n " });
    const res = await preflight(w);
    assert.equal(res.ok, false);
    assert.equal(res.failed, "owner-quote");
    assert.equal(w.calls.length, 0);
  });

  it("refuses a SHA that was never released (only failure / error records)", async () => {
    const w = world({ statuses: { 5: [{ state: "failure" }] } });
    const res = await preflight(w);
    assert.equal(res.failed, "released");
    assert.match(res.reason, /no success production Deployment/);
    assert.match(res.reason, /mode: release/);
  });
});

describe("runRedeployRecord", () => {
  const make = () => {
    const calls = [];
    return {
      calls,
      create: (args) => {
        calls.push(args);
        return { ok: true, deploymentId: 21 };
      },
      log: () => {},
    };
  };

  for (const [state, deploymentState] of [
    ["succeeded", "success"],
    ["failed", "failure"],
    ["unknown", "error"],
  ]) {
    it(`${state}: a new ${deploymentState} record with the quote, no release cut`, async () => {
      const deps = make();
      const res = await runRedeployRecord({
        sha: SHA,
        state,
        ownerQuote: "перезапусти",
        ...deps,
      });
      assert.deepEqual(res, { ok: true, deploymentId: 21, recorded: "new" });
      assert.equal(deps.calls.length, 1);
      const [args] = deps.calls;
      assert.equal(args.state, deploymentState);
      assert.equal(args.releaseTag, null);
      assert.equal(args.notesText, "");
      assert.equal(args.ownerQuote, "перезапусти");
      assert.equal(args.redeploy, true);
    });
  }

  it("writes a record even when a success Deployment of the SHA exists (one per run)", async () => {
    const deps = make();
    await runRedeployRecord({
      sha: SHA,
      state: "succeeded",
      ownerQuote: "q",
      ...deps,
    });
    await runRedeployRecord({
      sha: SHA,
      state: "succeeded",
      ownerQuote: "q",
      ...deps,
    });
    assert.equal(deps.calls.length, 2);
  });

  it("refuses a blank quote before writing anything", async () => {
    const deps = make();
    await assert.rejects(
      runRedeployRecord({
        sha: SHA,
        state: "succeeded",
        ownerQuote: "",
        ...deps,
      }),
      /owner_quote is empty/,
    );
    assert.equal(deps.calls.length, 0);
  });
});

describe("buildDeploymentPayload — redeploy", () => {
  const base = {
    sha: SHA,
    releaseTag: null,
    notesText: "",
    healthUrl: "https://api.example/v1/health",
    nowIso: "2026-10-27T00:00:00.000Z",
    redeploy: true,
  };

  it("describes the record `redeploy @ <sha12> — «<quote>»`, kind redeploy, the quote in the payload", () => {
    const { deployment, status } = buildDeploymentPayload({
      ...base,
      state: "success",
      ownerQuote: "капча ON",
    });
    assert.equal(
      deployment.description,
      `redeploy @ ${SHA.slice(0, 12)} — «капча ON»`,
    );
    assert.equal(deployment.ref, SHA);
    assert.equal(deployment.environment, "production");
    assert.equal(deployment.payload.kind, "redeploy");
    assert.equal(deployment.payload.ownerQuote, "капча ON");
    assert.equal(deployment.payload.releaseTag, null);
    assert.equal(deployment.payload.notes, "");
    assert.equal(status.state, "success");
    assert.equal(status.description, `redeploy @ ${SHA.slice(0, 12)}`);
  });

  it("a failed or lost-contact redeploy says so in its status", () => {
    const failed = buildDeploymentPayload({
      ...base,
      state: "failure",
      ownerQuote: "q",
    });
    assert.match(failed.status.description, /^redeploy failed @ /);
    assert.match(failed.deployment.description, /^failed redeploy @ /);
    const unknown = buildDeploymentPayload({
      ...base,
      state: "error",
      ownerQuote: "q",
    });
    assert.match(unknown.status.description, /^redeploy verdict unknown @ /);
  });
});
