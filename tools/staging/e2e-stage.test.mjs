import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertShellInert,
  axeDecision,
  exitCodeFor,
  parseE2eArgs,
  preflightVerdict,
  renderVerdictBlock,
  runE2eStage,
  slotE2eEnv,
  summarizeReport,
} from "./e2e-stage.mjs";

/**
 * `pnpm e2e:stage <slot>` — the C4 / §8-step-7 regression run over a CONVERGED slot.
 *
 * Everything that touches the world (ssh, the network, `pnpm`, `gh`) is an injected
 * effect, so the whole command is exercised here without a box: the same testability
 * contract `slot.test.mjs` holds for the converge.
 */

describe("parseE2eArgs", () => {
  it("takes the slot and defaults to both projects with the axe leg on", () => {
    assert.deepEqual(parseE2eArgs(["main"]), {
      slot: "main",
      project: undefined,
      grep: undefined,
      axe: true,
      reportDir: undefined,
    });
  });

  it("reads --project, --grep, --no-axe and --report-dir", () => {
    assert.deepEqual(
      parseE2eArgs([
        "pr-2198",
        "--project",
        "doctor",
        "--grep",
        "вход",
        "--no-axe",
        "--report-dir",
        "out",
      ]),
      {
        slot: "pr-2198",
        project: "doctor",
        grep: "вход",
        axe: false,
        reportDir: "out",
      },
    );
  });

  it("refuses an unknown project, an unknown flag and a missing slot", () => {
    assert.throws(
      () => parseE2eArgs(["main", "--project", "admin"]),
      /academy\|doctor/,
    );
    assert.throws(() => parseE2eArgs(["main", "--rebuild"]), /--rebuild/);
    assert.throws(() => parseE2eArgs([]), /slot/);
  });

  it("refuses a slot name the converge would refuse", () => {
    assert.throws(() => parseE2eArgs(["Pr-1"]), /Pr-1/);
  });
});

describe("slotE2eEnv", () => {
  it("derives both storefront URLs from the slot name and carries the basic-auth pair", () => {
    assert.deepEqual(
      slotE2eEnv({
        slot: "main",
        baseDomain: "stage.doctor.school",
        user: "stage",
        password: "s3cret",
      }),
      {
        E2E_PORTAL_URL: "https://academy-main.stage.doctor.school",
        E2E_DOCTOR_URL: "https://doctor-main.stage.doctor.school",
        E2E_HTTP_USER: "stage",
        E2E_HTTP_PASS: "s3cret",
      },
    );
  });

  it("points the portal env at the `academy-` host, never at a `portal-` one", () => {
    const env = slotE2eEnv({
      slot: "pr-7",
      baseDomain: "stage.doctor.school",
      user: "stage",
      password: "x",
    });
    assert.equal(
      env.E2E_PORTAL_URL,
      "https://academy-pr-7.stage.doctor.school",
    );
  });
});

describe("preflightVerdict", () => {
  it("passes a 200 that names the served SHA", () => {
    const sha = "a".repeat(40);
    assert.deepEqual(
      preflightVerdict({ status: 200, body: JSON.stringify({ version: sha }) }),
      {
        ok: true,
        sha,
      },
    );
  });

  it("fails a 401, a non-JSON body and a body with no version", () => {
    assert.equal(preflightVerdict({ status: 401, body: "" }).ok, false);
    assert.match(
      preflightVerdict({ status: 401, body: "" }).reason,
      /HTTP 401/,
    );
    assert.match(
      preflightVerdict({ status: 200, body: "<html>" }).reason,
      /not JSON/,
    );
    assert.match(
      preflightVerdict({ status: 200, body: "{}" }).reason,
      /version/,
    );
  });
});

describe("axeDecision", () => {
  it("runs the axe leg only once #1692 is closed", () => {
    assert.equal(axeDecision({ axe: true, issueState: "CLOSED" }).run, true);
    const open = axeDecision({ axe: true, issueState: "OPEN" });
    assert.equal(open.run, false);
    assert.equal(open.note, "axe leg skipped: #1692 open");
  });

  it("keeps --no-axe and an unreadable issue state off, each with its own reason", () => {
    assert.equal(axeDecision({ axe: false, issueState: "CLOSED" }).run, false);
    assert.match(
      axeDecision({ axe: false, issueState: "CLOSED" }).note,
      /--no-axe/,
    );
    assert.equal(axeDecision({ axe: true, issueState: undefined }).run, false);
    assert.match(
      axeDecision({ axe: true, issueState: undefined }).note,
      /could not be read/,
    );
  });
});

const REPORT = {
  suites: [
    {
      title: "005",
      specs: [
        {
          tests: [
            { projectName: "academy", status: "expected" },
            { projectName: "doctor", status: "expected" },
          ],
        },
        { tests: [{ projectName: "academy", status: "skipped" }] },
      ],
      suites: [
        {
          title: "nested",
          specs: [{ tests: [{ projectName: "doctor", status: "unexpected" }] }],
        },
      ],
    },
  ],
};

describe("summarizeReport", () => {
  it("counts passed/failed/skipped per project through nested suites", () => {
    assert.deepEqual(summarizeReport(REPORT), {
      projects: [
        { project: "academy", passed: 1, failed: 0, skipped: 1 },
        { project: "doctor", passed: 1, failed: 1, skipped: 0 },
      ],
      failed: 1,
      total: 4,
    });
  });

  it("counts a flaky test as a failure — the suite runs with retries: 0", () => {
    const flaky = {
      suites: [
        { specs: [{ tests: [{ projectName: "academy", status: "flaky" }] }] },
      ],
    };
    assert.deepEqual(summarizeReport(flaky).projects, [
      { project: "academy", passed: 0, failed: 1, skipped: 0 },
    ]);
  });

  it("survives an empty report rather than throwing on a run that produced nothing", () => {
    assert.deepEqual(summarizeReport({}), {
      projects: [],
      failed: 0,
      total: 0,
    });
  });
});

describe("exitCodeFor", () => {
  it("maps pre-flight refusal to 2, a failed leg to 1 and an all-green run to 0", () => {
    assert.equal(exitCodeFor({ preflightOk: false, legs: [] }), 2);
    assert.equal(
      exitCodeFor({ preflightOk: true, legs: [{ name: "suite", ok: false }] }),
      1,
    );
    assert.equal(
      exitCodeFor({ preflightOk: true, legs: [{ name: "suite", ok: true }] }),
      0,
    );
  });

  it("is 1 when the run produced no leg at all — a green verdict needs evidence", () => {
    assert.equal(exitCodeFor({ preflightOk: true, legs: [] }), 1);
  });
});

describe("renderVerdictBlock", () => {
  const block = renderVerdictBlock({
    slot: "main",
    healthUrl: "https://api-main.stage.doctor.school/v1/health",
    sha: "b".repeat(40),
    summary: summarizeReport(REPORT),
    legs: [
      { name: "suite", ok: false },
      { name: "axe/academy", ok: true },
    ],
    axeNote: "axe leg skipped: #1692 open",
    reportDir: "packages/e2e/playwright-report/main-20260914T101112Z",
  });

  it("is a fenced block the operator pastes as-is", () => {
    assert.ok(block.startsWith("```text\n"));
    assert.ok(block.trimEnd().endsWith("```"));
  });

  it("names the slot, the served SHA, the per-project counts, the axe note and the report path", () => {
    assert.match(block, /slot:\s+main/);
    // `shortSha` — the repo's one short-sha convention, not a second truncation.
    assert.match(block, new RegExp(`head:\\s+${"b".repeat(7)}\\b`));
    assert.match(block, /academy 1 passed \/ 0 failed \/ 1 skipped/);
    assert.match(block, /doctor 1 passed \/ 1 failed \/ 0 skipped/);
    assert.match(block, /axe leg skipped: #1692 open/);
    assert.match(block, /main-20260914T101112Z/);
    assert.match(block, /verdict:\s+FAIL/);
  });

  it("never carries the basic-auth password", () => {
    assert.equal(block.includes("s3cret"), false);
  });
});

// --- the whole command, with every effect injected ----------------------------

const BOX_ENV = {
  STAGE_BASE_DOMAIN: "stage.doctor.school",
  STAGE_BASIC_AUTH_USER: "stage",
};
const SHA = "c".repeat(40);

function harness(overrides = {}) {
  const calls = [];
  const lines = [];
  const effects = {
    readBoxEnv: async () => BOX_ENV,
    fetchHealth: async () => ({
      status: 200,
      body: JSON.stringify({ version: SHA }),
    }),
    run: (argv, options) => {
      calls.push({ argv, env: options.env });
      return { status: 0 };
    },
    readReport: () => REPORT,
    issueState: () => "OPEN",
    log: (line) => lines.push(line),
    now: () => new Date("2026-09-14T10:11:12Z"),
    ...overrides,
  };
  return { calls, lines, effects };
}

describe("assertShellInert", () => {
  it("joins tokens that carry no shell meaning", () => {
    assert.equal(
      assertShellInert(["pnpm", "--filter", "@ds/e2e", "test:e2e"]),
      "pnpm --filter @ds/e2e test:e2e",
    );
    assert.equal(
      assertShellInert(["--config=playwright.room.config.ts"]),
      "--config=playwright.room.config.ts",
    );
  });

  it("refuses a token a shell would reinterpret rather than silently mangling it", () => {
    assert.throws(
      () => assertShellInert(["pnpm", "вход|выход"]),
      /shell-unsafe/,
    );
    assert.throws(() => assertShellInert(["pnpm", "a b"]), /shell-unsafe/);
    assert.throws(() => assertShellInert(["pnpm", "$(id)"]), /shell-unsafe/);
  });
});

describe("runE2eStage", () => {
  it("passes the derived URLs and the basic-auth pair to the suite run", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    const suite = calls[0];
    assert.deepEqual(suite.argv.slice(0, 4), [
      "pnpm",
      "--filter",
      "@ds/e2e",
      "test:e2e",
    ]);
    assert.equal(
      suite.env.E2E_PORTAL_URL,
      "https://academy-main.stage.doctor.school",
    );
    assert.equal(
      suite.env.E2E_DOCTOR_URL,
      "https://doctor-main.stage.doctor.school",
    );
    assert.equal(suite.env.E2E_HTTP_USER, "stage");
    assert.equal(suite.env.E2E_HTTP_PASS, "s3cret");
    assert.match(suite.env.E2E_REPORT_DIR, /main-20260914T101112Z/);
  });

  it("forwards --project on the command line and --grep through the env", async () => {
    const { calls, effects } = harness();
    await runE2eStage(
      ["main", "--project", "academy", "--grep", "вход|выход"],
      {
        env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
        effects,
      },
    );
    // An alternation on a shell command line would be a PIPELINE; the config
    // compiles `E2E_GREP` instead, so the operator's regex stays a regex.
    assert.deepEqual(calls[0].argv.slice(4), ["--project", "academy"]);
    assert.equal(calls[0].env.E2E_GREP, "вход|выход");
    assert.equal(calls[0].argv.join(" ").includes("вход"), false);
  });

  it("hands Playwright an ABSOLUTE report dir — it resolves reporters against the config dir", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(path.isAbsolute(calls[0].env.E2E_REPORT_DIR), true);
  });

  it("takes the basic-auth pair from E2E_HTTP_USER/PASS when the operator has no ssh", async () => {
    const readBoxEnv = async () => {
      throw new Error("ssh: connect: no route to host");
    };
    const { calls, effects } = harness({ readBoxEnv });
    const code = await runE2eStage(["main"], {
      env: {
        E2E_HTTP_USER: "stage",
        E2E_HTTP_PASS: "s3cret",
        STAGE_BASE_DOMAIN: "stage.doctor.school",
      },
      effects,
    });
    assert.equal(code, 0);
    assert.equal(calls[0].env.E2E_HTTP_PASS, "s3cret");
  });

  it("refuses with exit 2 and names the URL when the slot does not answer", async () => {
    const { calls, lines, effects } = harness({
      fetchHealth: async () => ({ status: 502, body: "" }),
    });
    const code = await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(code, 2);
    assert.equal(
      calls.length,
      0,
      "a slot that does not answer is never one this command raises",
    );
    assert.ok(
      lines.some((l) =>
        l.includes("https://api-main.stage.doctor.school/v1/health"),
      ),
    );
  });

  it("skips the axe leg while #1692 is open and still runs the suite", async () => {
    const { calls, lines, effects } = harness();
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(calls.length, 1);
    assert.ok(lines.some((l) => l.includes("axe leg skipped: #1692 open")));
  });

  it("adds both axe legs once #1692 is closed", async () => {
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(calls.length, 3);
    assert.ok(calls[1].argv.join(" ").includes("@ds/portal"));
    assert.ok(calls[2].argv.join(" ").includes("room-axe"));
    assert.equal(
      calls[1].env.E2E_PORTAL_URL,
      "https://academy-main.stage.doctor.school",
    );
  });

  it("runs only the named project's axe leg", async () => {
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main", "--project", "doctor"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[1].argv.join(" ").includes("room-axe"));
  });

  it("returns 1 and prints the verdict block when a leg fails", async () => {
    const { lines, effects } = harness({ run: () => ({ status: 1 }) });
    const code = await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(code, 1);
    assert.ok(lines.some((l) => l.includes("```text")));
  });

  it("returns 0 and still prints the verdict block on a green run", async () => {
    const { lines, effects } = harness({
      readReport: () => ({
        suites: [
          {
            specs: [
              { tests: [{ projectName: "academy", status: "expected" }] },
            ],
          },
        ],
      }),
    });
    const code = await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(code, 0);
    assert.ok(lines.some((l) => l.includes("verdict:     PASS")));
  });
});
