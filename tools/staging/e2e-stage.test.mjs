import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertShellInert,
  axeDecision,
  exitCodeFor,
  liveLegVerdict,
  parseE2eArgs,
  planLiveLeg,
  preflightVerdict,
  publicAxeLeg,
  releaseCheckExclusion,
  renderVerdictBlock,
  runE2eStage,
  slotE2eEnv,
  slotLiveEnv,
  slotLiveStandEnv,
  SUMMARY_REPORTER_PATH,
  summarizeReport,
} from "./e2e-stage.mjs";
import {
  AXE_LEG_CONFIGS,
  GOLDEN_SLUGS,
  HERMETIC_CONFIGS,
  GOLDEN_EVENT_SLUGS,
  GOLDEN_LIVE_ENV,
  LIVE_TIERS,
} from "./live-tiers.mjs";

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
      expectSha: undefined,
      live: true,
    });
  });

  it("reads --no-live, which keeps every live-tier leg out of a focused run", () => {
    assert.equal(parseE2eArgs(["main", "--no-live"]).live, false);
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
        expectSha: undefined,
        live: true,
      },
    );
  });

  it("selects the derived-walks project", () => {
    assert.equal(parseE2eArgs(["main", "--project", "walks"]).project, "walks");
  });

  it("refuses an unknown project, an unknown flag and a missing slot", () => {
    assert.throws(
      () => parseE2eArgs(["main", "--project", "admin"]),
      /academy\|doctor\|walks/,
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
        E2E_LOGIN_URL: "https://login-main.stage.doctor.school",
        E2E_HTTP_USER: "stage",
        E2E_HTTP_PASS: "s3cret",
        E2E_SMS_SINK_URL: "https://sms-sink.stage.doctor.school",
      },
    );
  });

  it("hands every slot the one shared SMS sink host, so @sms-reset runs instead of skipping (#2878)", () => {
    const env = slotE2eEnv({
      slot: "pr-7",
      baseDomain: "stage.doctor.school",
      user: "stage",
      password: "x",
    });
    assert.equal(env.E2E_SMS_SINK_URL, "https://sms-sink.stage.doctor.school");
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
  DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED: "box-unverified",
  DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "box-verified",
  DS_GOLDEN_PASSWORD_DOCTOR_MFA: "box-mfa",
  DS_GOLDEN_PASSWORD_ADMIN: "box-admin",
  DS_GOLDEN_PASSWORD_DOCTOR_DELETED: "must-not-leak",
  POSTGRES_PASSWORD: "must-not-leak",
};
const SHA = "c".repeat(40);

/** A live leg whose one test passed — the default, so a test about the suite is not
 * also a test about every live leg. */
const LIVE_GREEN = {
  suites: [
    { specs: [{ tests: [{ projectName: "chromium", status: "expected" }] }] },
  ],
};
const isLiveReport = (file) => /live-/.test(path.basename(path.dirname(file)));
const isAxe = (call) =>
  call.argv.includes("test:axe") || call.argv.includes("a11y/room-axe");
const isLive = (call) =>
  call.argv.some((t) => t.startsWith("--config=")) && !isAxe(call);

function harness(overrides = {}) {
  const calls = [];
  const lines = [];
  const writes = [];
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
    readReport: (file) => (isLiveReport(file) ? LIVE_GREEN : REPORT),
    writeFile: (file, content) => writes.push({ file, content }),
    issueState: () => "OPEN",
    log: (line) => lines.push(line),
    now: () => new Date("2026-09-14T10:11:12Z"),
    ...overrides,
  };
  return { calls, lines, writes, effects };
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
  it("builds the e2e workspace dependencies before the browser suite", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../packages/e2e/package.json", import.meta.url)),
    );
    assert.equal(
      packageJson.scripts["pretest:e2e"],
      "pnpm exec turbo run build --filter=@ds/e2e...",
    );
  });

  it("supplies only the four live golden passwords from the box, with local overrides", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["main"], {
      env: {
        STAGE_BASIC_AUTH_PASS: "s3cret",
        DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "operator-verified",
      },
      effects,
    });
    const suiteEnv = calls[0].env;
    assert.equal(
      suiteEnv.DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED,
      "box-unverified",
    );
    assert.equal(
      suiteEnv.DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED,
      "operator-verified",
    );
    assert.equal(suiteEnv.DS_GOLDEN_PASSWORD_DOCTOR_MFA, "box-mfa");
    assert.equal(suiteEnv.DS_GOLDEN_PASSWORD_ADMIN, "box-admin");
    assert.equal(suiteEnv.DS_GOLDEN_PASSWORD_DOCTOR_DELETED, undefined);
    assert.equal(suiteEnv.POSTGRES_PASSWORD, undefined);
  });

  it("hands the box's bot-protection test token to the suite as E2E_CAPTCHA_TEST_TOKEN (#2605)", async () => {
    const token = "a".repeat(64);
    const fromBox = harness({
      readBoxEnv: async () => ({
        ...BOX_ENV,
        BOT_PROTECTION_TEST_TOKEN: token,
      }),
    });
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects: fromBox.effects,
    });
    assert.equal(fromBox.calls[0].env.E2E_CAPTCHA_TEST_TOKEN, token);

    const operatorWins = harness({
      readBoxEnv: async () => ({
        ...BOX_ENV,
        BOT_PROTECTION_TEST_TOKEN: token,
      }),
    });
    await runE2eStage(["main"], {
      env: {
        STAGE_BASIC_AUTH_PASS: "s3cret",
        E2E_CAPTCHA_TEST_TOKEN: "operator-token",
      },
      effects: operatorWins.effects,
    });
    assert.equal(
      operatorWins.calls[0].env.E2E_CAPTCHA_TEST_TOKEN,
      "operator-token",
    );

    const none = harness();
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects: none.effects,
    });
    assert.equal(none.calls[0].env.E2E_CAPTCHA_TEST_TOKEN, undefined);
  });

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
        DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "operator-verified",
      },
      effects,
    });
    assert.equal(code, 0);
    assert.equal(calls[0].env.E2E_HTTP_PASS, "s3cret");
    assert.equal(
      calls[0].env.DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED,
      "operator-verified",
    );
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
    assert.equal(calls.filter(isAxe).length, 0);
    assert.equal(calls[0].argv[2], "@ds/e2e");
    assert.ok(lines.some((l) => l.includes("axe leg skipped: #1692 open")));
  });

  it("adds both axe legs once #1692 is closed", async () => {
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    const axe = calls.filter(isAxe);
    assert.equal(axe.length, 2);
    assert.ok(axe[0].argv.join(" ").includes("@ds/portal"));
    assert.ok(axe[1].argv.join(" ").includes("room-axe"));
    assert.equal(
      axe[0].env.E2E_PORTAL_URL,
      "https://academy-main.stage.doctor.school",
    );
  });

  it("runs only the named project's axe leg", async () => {
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main", "--project", "doctor"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    const axe = calls.filter(isAxe);
    assert.equal(axe.length, 1);
    assert.ok(axe[0].argv.join(" ").includes("room-axe"));
  });

  it("runs no host axe leg when the derived walks are the selected project", async () => {
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main", "--project", "walks"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(calls.length, 1, "walks selects no host: no axe, no live leg");
    assert.deepEqual(calls[0].argv.slice(4), ["--project", "walks"]);
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

// --- the live-tier legs (#3168) ------------------------------------------------

const REPO = new URL("../../", import.meta.url);
const repoFile = (rel) => readFileSync(new URL(rel, REPO), "utf8");
const storefrontConfigs = () =>
  ["apps/portal", "apps/doctor"].flatMap((app) =>
    readdirSync(new URL(`${app}/`, REPO))
      .filter((f) => /^playwright.*\.config\.ts$/.test(f))
      .map((f) => `${app}/${f}`),
  );
const walk = (rel) =>
  readdirSync(new URL(`${rel}/`, REPO), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? d.name === "node_modules"
        ? []
        : walk(`${rel}/${d.name}`)
      : [`${rel}/${d.name}`],
  );

/**
 * The names each `requireLiveStandEnv(…)` call passes — an inline array literal or
 * a same-file `const NAME = [ … ]`. Anything else maps to `undefined`, so the
 * inventory test refuses it instead of reading an empty requirement.
 */
function requiredNames(source) {
  const calls = [
    ...source.matchAll(/requireLiveStandEnv\(\s*([\s\S]*?)\)\s*;/g),
  ];
  return calls.map(([, arg]) => {
    let literal = arg.trim();
    if (/^[A-Z_][A-Z0-9_]*$/.test(literal)) {
      const decl = source.match(
        new RegExp(`const ${literal}\\s*=\\s*(\\[[\\s\\S]*?\\])`),
      );
      if (!decl) return undefined;
      literal = decl[1];
    }
    if (!literal.startsWith("[")) return undefined;
    return [...literal.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
  });
}

describe("live-tier inventory (#3168) — every storefront config is classified", () => {
  it("lists every apps/{portal,doctor}/playwright*.config.ts exactly once", () => {
    const live = LIVE_TIERS.map((t) => `${t.app}/${t.config}`);
    const classified = [
      ...live,
      ...Object.keys(AXE_LEG_CONFIGS),
      ...HERMETIC_CONFIGS,
    ];
    assert.equal(
      new Set(classified).size,
      classified.length,
      "a config is listed twice",
    );
    assert.deepEqual([...classified].sort(), storefrontConfigs().sort());
  });

  it("classifies by the rule: a live config owns no webServer, a hermetic one does", () => {
    for (const config of [
      ...LIVE_TIERS.map((t) => `${t.app}/${t.config}`),
      ...Object.keys(AXE_LEG_CONFIGS),
    ]) {
      assert.equal(/\bwebServer\s*:/.test(repoFile(config)), false, config);
    }
    for (const config of HERMETIC_CONFIGS) {
      assert.equal(/\bwebServer\s*:/.test(repoFile(config)), true, config);
    }
  });

  it("declares every requireLiveStandEnv spec with at least the names it passes", () => {
    const declared = new Map();
    for (const tier of LIVE_TIERS) {
      for (const g of tier.gated)
        declared.set(`${tier.app}/${g.file}`, g.requires);
      for (const f of tier.exclude ?? [])
        declared.set(`${tier.app}/${f}`, null);
    }
    const specs = ["apps/portal/e2e", "apps/doctor/e2e"]
      .flatMap(walk)
      .filter((f) => /\.ts$/.test(f) && !f.includes("/support/"));
    let seen = 0;
    for (const spec of specs) {
      const source = repoFile(spec);
      if (!/requireLiveStandEnv\(/.test(source)) continue;
      seen += 1;
      // The portal a11y dir is the `axe/academy` leg's (playwright.axe.config.ts).
      if (spec.startsWith("apps/portal/e2e/a11y/")) continue;
      assert.ok(
        declared.has(spec),
        `${spec} gates its env but no live leg declares it`,
      );
      const requires = declared.get(spec);
      if (requires === null) continue;
      for (const names of requiredNames(source)) {
        assert.ok(
          names,
          `${spec}: requireLiveStandEnv argument is not a readable literal`,
        );
        for (const name of names) {
          assert.ok(
            requires.includes(name),
            `${spec} requires ${name}; live-tiers.mjs omits it`,
          );
        }
      }
    }
    assert.ok(seen > 0, "the scan found no gated spec — the walk is broken");
  });

  it("names the configRequires a config throws on, word for word", () => {
    for (const tier of LIVE_TIERS.filter((t) => t.configRequires)) {
      const source = repoFile(`${tier.app}/${tier.config}`);
      for (const name of tier.configRequires) {
        assert.ok(
          source.includes(`"${name}"`),
          `${tier.config} does not require ${name}`,
        );
      }
    }
  });

  it("covers the #3150 miss: register-live is a doctor leg", () => {
    assert.ok(
      LIVE_TIERS.some(
        (t) =>
          t.host === "doctor" &&
          t.config === "playwright.register-live.config.ts",
      ),
    );
  });
});

describe("slotLiveEnv", () => {
  it("maps the shared IdP and Mailpit hosts of the stand — hostnames, never 127.0.0.1", () => {
    assert.deepEqual(slotLiveEnv({ baseDomain: "stage.doctor.school" }), {
      IDP_ISSUER: "https://id.stage.doctor.school",
      MAILPIT_URL: "https://mailpit.stage.doctor.school",
    });
  });
});

describe("planLiveLeg", () => {
  const TIER = {
    name: "live/doctor/x",
    host: "doctor",
    app: "apps/doctor",
    pkg: "@ds/doctor",
    config: "playwright.x.config.ts",
    rootDir: "e2e",
    exclude: ["e2e/a11y/twin.e2e.spec.ts"],
    gated: [
      { file: "e2e/ok.spec.ts", requires: ["E2E_DOCTOR_URL"] },
      {
        file: "e2e/sub/needs.spec.ts",
        requires: ["E2E_DOCTOR_URL", "B_KEY", "A_KEY"],
      },
    ],
  };

  it("keeps a spec whose env the slot cannot give out of the run, naming what is missing", () => {
    const plan = planLiveLeg(TIER, {
      E2E_DOCTOR_URL: "https://d",
      B_KEY: " ",
    });
    assert.equal(plan.run, true);
    assert.deepEqual(plan.notRun, [
      { file: "e2e/sub/needs.spec.ts", missing: ["B_KEY", "A_KEY"] },
    ]);
    // Lines resolve against the config's rootDir (its top-level testDir).
    assert.deepEqual(plan.invertList, [
      "a11y/twin.e2e.spec.ts",
      "sub/needs.spec.ts",
    ]);
  });

  it("does not launch a config that throws at load without its env", () => {
    const plan = planLiveLeg(
      { ...TIER, configRequires: ["E2E_DOCTOR_URL", "E2E_EVENTS_LOADED_PATH"] },
      { E2E_DOCTOR_URL: "https://d" },
    );
    assert.equal(plan.run, false);
    assert.equal(plan.reason, "missing env E2E_EVENTS_LOADED_PATH");
  });
});

describe("liveLegVerdict", () => {
  const counts = (...statuses) => ({
    suites: [
      {
        specs: [
          {
            tests: statuses.map((status) => ({
              projectName: "chromium",
              status,
            })),
          },
        ],
      },
    ],
  });
  const PLAN = { run: true, notRun: [], invertList: [] };

  it("reads a leg whose every test skipped as SKIPPED, never green", () => {
    const v = liveLegVerdict({
      name: "l",
      plan: PLAN,
      status: 0,
      report: counts("skipped", "skipped"),
    });
    assert.equal(v.state, "skipped");
    assert.equal(v.ok, true);
    assert.match(v.detail, /0 passed \/ 0 failed \/ 2 skipped/);
  });

  it("fails a leg that ran with a failure, or whose run exited non-zero", () => {
    assert.equal(
      liveLegVerdict({
        name: "l",
        plan: PLAN,
        status: 1,
        report: counts("expected", "unexpected"),
      }).state,
      "fail",
    );
    const crashed = liveLegVerdict({
      name: "l",
      plan: PLAN,
      status: 1,
      report: {},
    });
    assert.equal(crashed.state, "fail");
    assert.equal(crashed.ok, false);
  });

  it("names a runner that died before any test ran instead of printing zero counts", () => {
    for (const report of [{}, undefined, counts()]) {
      const v = liveLegVerdict({ name: "l", plan: PLAN, status: 1, report });
      assert.equal(v.state, "fail");
      assert.equal(v.ok, false);
      assert.match(v.detail, /^runner exited 1 before any test ran/);
      assert.doesNotMatch(v.detail, /ran 0 passed/);
    }
    // A runner that exited non-zero AFTER a test ran keeps its counts.
    assert.match(
      liveLegVerdict({
        name: "l",
        plan: PLAN,
        status: 1,
        report: counts("unexpected"),
      }).detail,
      /^ran 0 passed \/ 1 failed \/ 0 skipped/,
    );
  });

  it("passes a leg with a passed test and no failure, and lists what it did not run", () => {
    const v = liveLegVerdict({
      name: "l",
      plan: { ...PLAN, notRun: [{ file: "e2e/x.spec.ts", missing: ["K"] }] },
      status: 0,
      report: counts("expected", "skipped"),
    });
    assert.equal(v.state, "pass");
    assert.match(v.detail, /ran 1 passed \/ 0 failed \/ 1 skipped/);
    assert.match(v.detail, /not run: e2e\/x\.spec\.ts \(missing K\)/);
  });

  it("reads a config that was never launched as SKIPPED with its reason", () => {
    const v = liveLegVerdict({
      name: "l",
      plan: { run: false, reason: "missing env K", notRun: [] },
    });
    assert.equal(v.state, "skipped");
    assert.equal(v.detail, "skipped — missing env K");
  });
});

describe("runE2eStage — the live legs", () => {
  const ENV = { STAGE_BASIC_AUTH_PASS: "s3cret" };

  it("runs one leg per live config with the slot's URLs, IdP and Mailpit", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["pr-3168"], { env: ENV, effects });
    const live = calls.filter(isLive);
    const configs = live.map((c) =>
      c.argv.find((t) => t.startsWith("--config=")),
    );
    assert.ok(configs.includes("--config=playwright.register-live.config.ts"));
    assert.ok(configs.includes("--config=playwright.config.ts"));
    const registerLive =
      live[configs.indexOf("--config=playwright.register-live.config.ts")];
    assert.deepEqual(registerLive.argv.slice(0, 6), [
      "pnpm",
      "--filter",
      "@ds/doctor",
      "exec",
      "playwright",
      "test",
    ]);
    assert.equal(
      registerLive.env.E2E_DOCTOR_URL,
      "https://doctor-pr-3168.stage.doctor.school",
    );
    assert.equal(registerLive.env.IDP_ISSUER, "https://id.stage.doctor.school");
    assert.equal(
      registerLive.env.MAILPIT_URL,
      "https://mailpit.stage.doctor.school",
    );
    assert.equal(registerLive.env.E2E_HTTP_PASS, "s3cret");
    assert.ok(registerLive.argv.includes("--pass-with-no-tests"));
    for (const call of calls) assertShellInert(call.argv);
    // The suite is not handed the live-tier extras.
    assert.equal(calls[0].env.IDP_ISSUER, undefined);
  });

  it("hands each event-page leg its golden slugs, lets the operator's own value win, and keeps them off every other leg (#2996)", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["pr-2996"], {
      env: { ...ENV, E2E_HYBRID_SLUG: "operator-hybrid" },
      effects,
    });
    const leg = (pkg) =>
      calls.find(
        (c) =>
          c.argv.includes(pkg) &&
          c.argv.includes("--config=playwright.event-page.config.ts"),
      );
    const academy = leg("@ds/portal");
    const doctor = leg("@ds/doctor");
    assert.ok(academy && doctor);
    assert.equal(academy.env.E2E_WEBINAR_SLUG, GOLDEN_SLUGS.academyUpcoming);
    assert.equal(
      academy.env.E2E_PREPARING_WEBINAR_SLUG,
      GOLDEN_SLUGS.academyPreparingDated,
    );
    assert.equal(
      academy.env.E2E_OFFLINE_SOLDOUT_SLUG,
      GOLDEN_SLUGS.academyOfflineSoldOut,
    );
    // The operator exported their own: the leg does not override it.
    assert.equal(academy.env.E2E_HYBRID_SLUG, undefined);
    assert.equal(doctor.env.E2E_WEBINAR_SLUG, GOLDEN_SLUGS.doctorUpcoming);
    assert.equal(doctor.env.E2E_HYBRID_SLUG, undefined);
    // The default Academy leg and the suite never see a seeded slug.
    const academyDefault = calls.find(
      (c) =>
        c.argv.includes("@ds/portal") &&
        c.argv.includes("--config=playwright.config.ts"),
    );
    assert.equal(academyDefault.env.E2E_WEBINAR_SLUG, undefined);
    assert.equal(calls[0].env.E2E_WEBINAR_SLUG, undefined);
  });

  it("hands the default Academy leg its own 005 journey slugs — golden events under journey-only names, never an event-page slug name (#3229)", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["pr-3229"], { env: ENV, effects });
    const leg = calls.find(
      (c) =>
        c.argv.includes("@ds/portal") &&
        c.argv.includes("--config=playwright.config.ts"),
    );
    assert.ok(leg);
    assert.equal(
      leg.env.E2E_JOURNEY_SLUG_UPCOMING,
      GOLDEN_SLUGS.academyUpcoming,
    );
    assert.equal(
      leg.env.E2E_JOURNEY_SLUG_ONE_TAP,
      GOLDEN_SLUGS.academyUpcomingOneTap,
    );
    assert.equal(
      leg.env.E2E_JOURNEY_SLUG_MARKER,
      GOLDEN_SLUGS.academyUpcomingMarker,
    );
    assert.equal(
      leg.env.E2E_JOURNEY_SLUG_ENDED,
      GOLDEN_SLUGS.academyEndedRecorded,
    );
    assert.equal(leg.env.E2E_JOURNEY_SLUG_HIDDEN, GOLDEN_SLUGS.academyHidden);
    // Three distinct registrable events: one guest journey, one one-tap, one marker.
    assert.equal(
      new Set([
        leg.env.E2E_JOURNEY_SLUG_UPCOMING,
        leg.env.E2E_JOURNEY_SLUG_ONE_TAP,
        leg.env.E2E_JOURNEY_SLUG_MARKER,
      ]).size,
      3,
    );
    // #2996 holds: no event-page slug name reaches this leg.
    for (const name of [
      "E2E_WEBINAR_SLUG",
      "E2E_WEBINAR_SLUG_ENDED",
      "E2E_WEBINAR_SLUG_HIDDEN",
      "E2E_ENDED_WEBINAR_SLUG",
    ]) {
      assert.equal(leg.env[name], undefined, name);
    }
    // The journey names stay on this leg alone.
    const eventPage = calls.find(
      (c) =>
        c.argv.includes("@ds/portal") &&
        c.argv.includes("--config=playwright.event-page.config.ts"),
    );
    assert.equal(eventPage.env.E2E_JOURNEY_SLUG_UPCOMING, undefined);
  });

  it("generates the BDD specs before the Academy live leg", async () => {
    const { calls, effects } = harness();
    await runE2eStage(["pr-3168", "--project", "academy"], {
      env: ENV,
      effects,
    });
    const i = calls.findIndex(
      (c) => c.argv.join(" ") === "pnpm --filter @ds/portal exec bddgen",
    );
    assert.ok(i > 0);
    assert.ok(calls[i + 1].argv.includes("--config=playwright.config.ts"));
  });

  it("writes the not-run specs to a --test-list-invert file instead of letting them fail on env", async () => {
    const { calls, writes, effects } = harness();
    await runE2eStage(["pr-3168", "--project", "doctor"], {
      env: ENV,
      effects,
    });
    const call = calls.find((c) =>
      c.argv.includes("--config=playwright.register-live.config.ts"),
    );
    const flag = call.argv.find((t) => t.startsWith("--test-list-invert="));
    assert.ok(flag);
    const file = flag.slice("--test-list-invert=".length);
    const written = writes.find(
      (w) => w.file.split(path.sep).join("/") === file,
    );
    assert.ok(written, "the list the flag names was written");
    // BOX_ENV carries no BOT_PROTECTION_TEST_TOKEN, so `captchaTestTokenEnv`
    // supplies no E2E_CAPTCHA_TEST_TOKEN and the #3151 spec is not-run too.
    assert.deepEqual(written.content.trim().split("\n"), [
      "signed-in-landing-live.spec.ts",
      "account-auth-paths-live.spec.ts",
    ]);
  });

  it("runs the #3151 account-auth-paths spec as a live leg when the box carries the captcha test token", async () => {
    const { calls, writes, effects } = harness({
      readBoxEnv: async () => ({
        ...BOX_ENV,
        BOT_PROTECTION_TEST_TOKEN: "box-token",
      }),
    });
    await runE2eStage(["pr-3168"], { env: ENV, effects });
    const academy = calls.find((c) =>
      c.argv.includes("--config=playwright.account-live.config.ts"),
    );
    assert.ok(academy, "the Academy account-live leg is launched");
    assert.equal(academy.env.E2E_CAPTCHA_TEST_TOKEN, "box-token");
    assert.equal(
      academy.argv.some((t) => t.startsWith("--test-list-invert=")),
      false,
      "nothing of the Academy tier is listed as not-run",
    );
    const doctor = calls.find((c) =>
      c.argv.includes("--config=playwright.register-live.config.ts"),
    );
    assert.equal(doctor.env.E2E_CAPTCHA_TEST_TOKEN, "box-token");
    const flag = doctor.argv.find((t) => t.startsWith("--test-list-invert="));
    const file = flag.slice("--test-list-invert=".length);
    const written = writes.find(
      (w) => w.file.split(path.sep).join("/") === file,
    );
    assert.deepEqual(written.content.trim().split("\n"), [
      "signed-in-landing-live.spec.ts",
    ]);
  });

  it("honours --project like the axe legs, and --no-live drops every live leg", async () => {
    const doctor = harness();
    await runE2eStage(["main", "--project", "doctor"], {
      env: ENV,
      effects: doctor.effects,
    });
    assert.ok(doctor.calls.filter(isLive).length > 0);
    assert.equal(
      doctor.calls.some((c) => c.argv.includes("@ds/portal")),
      false,
    );

    const none = harness();
    await runE2eStage(["main", "--no-live"], {
      env: ENV,
      effects: none.effects,
    });
    assert.equal(none.calls.filter(isLive).length, 0);
  });

  it("prints each live config as ran (counts) or skipped — reason, and a skipped leg is not fatal", async () => {
    const allSkipped = {
      suites: [
        {
          specs: [{ tests: [{ projectName: "chromium", status: "skipped" }] }],
        },
      ],
    };
    const { calls, lines, effects } = harness({
      readReport: (file) => (isLiveReport(file) ? allSkipped : LIVE_GREEN),
    });
    const code = await runE2eStage(["main"], { env: ENV, effects });
    const out = lines.join("\n");
    assert.equal(code, 0, "skipped live legs are loud but not fatal");
    assert.match(
      out,
      /live\/doctor\/register-live\s+SKIPPED — ran 0 passed \/ 0 failed \/ 1 skipped/,
    );
    assert.match(out, /verdict:\s+PASS — \d+ live legs? skipped/);
    // #3191: a spec a slot cannot run says why, never «missing».
    assert.match(
      out,
      /e2e\/event-register-one-tap\.spec\.ts \(by design: registration is append-only/,
    );
    // #3191: events-live's config env is derived from the golden dataset.
    assert.ok(
      calls.some((c) =>
        c.argv.includes("--config=playwright.events-live.config.ts"),
      ),
    );
  });

  it("fails the run when a live leg ran with failures", async () => {
    const { lines, effects } = harness({
      readReport: (file) => (isLiveReport(file) ? REPORT : LIVE_GREEN),
    });
    const code = await runE2eStage(["main"], { env: ENV, effects });
    assert.equal(code, 1);
    assert.match(lines.join("\n"), /live\/doctor\/register-live\s+FAIL — ran/);
  });

  it("prints FAIL — runner exited <code> when a leg's runner dies before any test", async () => {
    const { lines, effects } = harness({
      run: (argv) => ({
        status:
          argv.join(" ") === "pnpm --filter @ds/portal exec bddgen" ? 1 : 0,
      }),
      readReport: (file) => (isLiveReport(file) ? undefined : LIVE_GREEN),
    });
    const code = await runE2eStage(["pr-3168", "--project", "academy"], {
      env: ENV,
      effects,
    });
    assert.equal(code, 1);
    assert.match(
      lines.join("\n"),
      /live\/academy\/default\s+FAIL — runner exited 1 before any test ran/,
    );
  });
});

// --- the release check (#2701): `--expect-sha` is the full suite on a known SHA ---

describe("release check (--expect-sha)", () => {
  const RELEASE_ENV = { STAGE_BASIC_AUTH_PASS: "s3cret", CI: "1" };

  it("parses a full 40-char SHA and refuses anything else", () => {
    assert.equal(parseE2eArgs(["main", "--expect-sha", SHA]).expectSha, SHA);
    assert.throws(() => parseE2eArgs(["main", "--expect-sha", "c0ffee"]), /40/);
  });

  it("refuses a narrowed release check — --project, --grep, --no-axe or another slot", () => {
    for (const extra of [
      ["--project", "doctor"],
      ["--grep", "вход"],
      ["--no-axe"],
    ]) {
      assert.throws(
        () => parseE2eArgs(["main", "--expect-sha", SHA, ...extra]),
        /full suite/,
      );
    }
    assert.throws(() => parseE2eArgs(["pr-1", "--expect-sha", SHA]), /main/);
  });

  it("refuses with exit 2 when E2E_GREP would filter the suite or forbid-only is off", async () => {
    for (const env of [
      { ...RELEASE_ENV, E2E_GREP: "вход" },
      { STAGE_BASIC_AUTH_PASS: "s3cret" },
    ]) {
      const { calls, lines, effects } = harness();
      const code = await runE2eStage(["main", "--expect-sha", SHA], {
        env,
        effects,
      });
      assert.equal(code, 2);
      assert.equal(calls.length, 0);
      assert.match(lines.join("\n"), /E2E_GREP|CI=1/);
    }
  });

  it("refuses with exit 2 when the slot serves another SHA, before any suite runs", async () => {
    const { calls, lines, effects } = harness({
      fetchHealth: async () => ({
        status: 200,
        body: JSON.stringify({ version: "d".repeat(40) }),
      }),
    });
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: RELEASE_ENV,
      effects,
    });
    assert.equal(code, 2);
    assert.equal(calls.length, 0);
    assert.match(lines.join("\n"), /serving ddddddd.*expected ccccccc/);
  });

  it("runs the full suite and passes when the slot serves the expected SHA", async () => {
    const { calls, effects } = harness();
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: RELEASE_ENV,
      effects,
    });
    assert.equal(code, 0);
    assert.deepEqual(calls[0].argv, [
      "pnpm",
      "--filter",
      "@ds/e2e",
      "test:e2e",
    ]);
    assert.equal(calls[0].env.E2E_GREP, undefined);
  });

  const liveLegsRun = (calls) =>
    calls
      .filter(isLive)
      .map(
        (c) => `${c.argv[2]} ${c.argv.find((t) => t.startsWith("--config="))}`,
      );
  const legKey = (tier) => `${tier.pkg} --config=${tier.config}`;

  it("runs exactly the live legs not excluded from it (#3191), and prints each one's verdict", async () => {
    const { calls, lines, effects } = harness();
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: RELEASE_ENV,
      effects,
    });
    assert.equal(code, 0);
    assert.deepEqual(
      liveLegsRun(calls).sort(),
      LIVE_TIERS.filter((t) => !t.releaseCheck)
        .map(legKey)
        .sort(),
    );
    const out = lines.join("\n");
    assert.match(out, /live:\s+live\/doctor\/register-live\s+PASS/);
  });

  it("prints one line per excluded leg with its reason, and the leg never runs", async () => {
    const { lines, effects } = harness();
    await runE2eStage(["main", "--expect-sha", SHA], {
      env: RELEASE_ENV,
      effects,
    });
    const out = lines.join("\n");
    const excluded = LIVE_TIERS.filter((t) => t.releaseCheck);
    assert.ok(excluded.length > 0);
    for (const tier of excluded) {
      const line = `live: ${tier.name} not in the release check — ${tier.releaseCheck.excluded}`;
      assert.equal(
        lines.filter((l) => l === line).length,
        1,
        `${tier.name}: one line «${line}»`,
      );
      assert.doesNotMatch(
        out,
        new RegExp(
          `${tier.name.replaceAll("/", "\\/")}\\s+(PASS|FAIL|SKIPPED)`,
        ),
      );
    }
  });

  it("a plain slot run still runs every live leg, excluded ones included, and prints no exclusion", async () => {
    const { calls, lines, effects } = harness();
    const code = await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(code, 0);
    assert.deepEqual(liveLegsRun(calls).sort(), LIVE_TIERS.map(legKey).sort());
    assert.doesNotMatch(lines.join("\n"), /not in the release check/);
  });

  it("fails the release check on a red live leg", async () => {
    const { effects } = harness({
      readReport: (file) => (isLiveReport(file) ? REPORT : LIVE_GREEN),
    });
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: RELEASE_ENV,
      effects,
    });
    assert.equal(code, 1);
  });

  it("refuses --no-live: the release check runs the live legs like every other leg", () => {
    assert.throws(
      () => parseE2eArgs(["main", "--expect-sha", SHA, "--no-live"]),
      /full suite — drop --no-live/,
    );
  });
});

// --- public-log mode (#2985) --------------------------------------------------

describe("E2E_PUBLIC_LOG=1 — the run's console is a public Actions log", () => {
  const PUBLIC_ENV = {
    E2E_PUBLIC_LOG: "1",
    CI: "1",
    STAGE_BASE_DOMAIN: "stage.doctor.school",
    E2E_HTTP_USER: "stage",
    E2E_HTTP_PASS: "s3cret-basic",
    DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "golden-verified-pw",
    E2E_CAPTCHA_TEST_TOKEN: "captcha-token-xyz",
  };
  const SECRETS = [
    "s3cret-basic",
    "golden-verified-pw",
    "captcha-token-xyz",
    "body-secret-123",
  ];
  const assertNoLeak = (lines) => {
    const out = lines.join("\n");
    for (const secret of SECRETS) {
      assert.equal(out.includes(secret), false, `the log carries ${secret}`);
    }
    assert.equal(
      /https?:\/\/[^/\s]*@/.test(out),
      false,
      "a credential-bearing URL",
    );
    assert.equal(out.includes("czNjcmV0"), false, "a base64 basic-auth header");
  };

  it("hands the suite the flag and both axe legs the summary reporter", async () => {
    const { calls, lines, effects } = harness({ issueState: () => "CLOSED" });
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: PUBLIC_ENV,
      effects,
    });
    assert.equal(code, 0);
    assert.equal(calls[0].env.E2E_PUBLIC_LOG, "1");
    const axeCalls = calls.filter(isAxe);
    assert.equal(axeCalls.length, 2);
    const reportDir = calls[0].env.E2E_REPORT_DIR.split(path.sep).join("/");
    for (const [axe, host] of [
      [axeCalls[0], "academy"],
      [axeCalls[1], "doctor"],
    ]) {
      assert.deepEqual(axe.argv.slice(-2), [
        `--reporter=${SUMMARY_REPORTER_PATH},json,html`,
        `--output=${reportDir}/axe-${host}/artifacts`,
      ]);
      assert.equal(
        axe.env.PLAYWRIGHT_JSON_OUTPUT_FILE,
        `${reportDir}/axe-${host}/results.json`,
      );
      assert.equal(
        axe.env.PLAYWRIGHT_HTML_OUTPUT_DIR,
        `${reportDir}/axe-${host}/html`,
      );
      assert.equal(axe.env.PLAYWRIGHT_HTML_OPEN, "never");
      assertShellInert(axe.argv);
    }
    assert.match(
      SUMMARY_REPORTER_PATH,
      /\/packages\/e2e\/reporters\/summary\.ts$/,
    );
    for (const call of calls) assertShellInert(call.argv);
    assertNoLeak(lines);
  });

  it("a slot run's live legs print through the summary reporter", async () => {
    const { calls, lines, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["pr-3168"], { env: PUBLIC_ENV, effects });
    const live = calls.filter(isLive);
    assert.ok(live.length > 0);
    for (const leg of live) {
      assert.ok(
        leg.argv.includes(`--reporter=${SUMMARY_REPORTER_PATH},json,html`),
        "a live leg prints through the summary reporter in public mode",
      );
    }
    assertNoLeak(lines);
  });

  it("a refused pre-flight prints the status, never the response body", async () => {
    const { lines, effects } = harness({
      fetchHealth: async () => ({
        status: 500,
        body: '{"error":"body-secret-123","auth":"s3cret-basic"}',
      }),
    });
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: PUBLIC_ENV,
      effects,
    });
    assert.equal(code, 2);
    assert.match(lines.join("\n"), /HTTP 500/);
    assertNoLeak(lines);
  });

  it("a health body naming another sha prints only the short shas", async () => {
    const { lines, effects } = harness({
      fetchHealth: async () => ({
        status: 200,
        body: JSON.stringify({
          version: "d".repeat(40),
          note: "body-secret-123",
        }),
      }),
    });
    const code = await runE2eStage(["main", "--expect-sha", SHA], {
      env: PUBLIC_ENV,
      effects,
    });
    assert.equal(code, 2);
    assertNoLeak(lines);
  });

  it("without the flag the axe legs keep their own reporter", async () => {
    assert.deepEqual(publicAxeLeg({}, "/r", "doctor"), { args: [], env: {} });
    assert.deepEqual(publicAxeLeg({ E2E_PUBLIC_LOG: "0" }, "/r", "doctor"), {
      args: [],
      env: {},
    });
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main"], {
      env: { STAGE_BASIC_AUTH_PASS: "s3cret" },
      effects,
    });
    assert.equal(calls[0].env.E2E_PUBLIC_LOG, undefined);
    for (const axe of calls.filter(isAxe)) {
      assert.equal(
        axe.argv.some((t) => t.startsWith("--reporter")),
        false,
      );
    }
  });
});

// --- #3191: the live legs' env is derived from the slot, never left «missing» ---

describe("slotLiveStandEnv (#3191) — one derivation, Actions and ssh alike", () => {
  const golden = { DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "golden-verified" };
  const box = {
    DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "golden-verified",
    IDP_SERVICE_TOKEN: "box-token",
    IDP_PROJECT_ID: "box-project",
    CONGRESS_SIGNUP_EVENT_ID: "evt",
    POSTGRES_PASSWORD: "must-not-leak",
  };
  // What `.github/workflows/stage.yml` job `suite` exports — and nothing else.
  const ACTIONS_ENV = {
    CI: "1",
    E2E_PUBLIC_LOG: "1",
    E2E_WORKERS: "4",
    STAGE_BASE_DOMAIN: "stage.doctor.school",
    E2E_HTTP_USER: "stage",
    E2E_HTTP_PASS: "s3cret",
    E2E_CAPTCHA_TEST_TOKEN: "captcha-token",
    DS_GOLDEN_PASSWORD_ADMIN: "golden-admin",
    DS_GOLDEN_PASSWORD_DOCTOR_MFA: "golden-mfa",
    DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED: "golden-unverified",
    DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED: "golden-verified",
  };

  it("signs the live specs in as the golden verified doctor and its first pool copy", () => {
    const env = slotLiveStandEnv({}, golden, "doctor");
    assert.equal(env.E2E_DOCTOR_EMAIL, "golden.doctor.verified@example.test");
    assert.equal(env.E2E_DOCTOR_PASSWORD, "golden-verified");
    assert.equal(
      env.E2E_DOCTOR2_EMAIL,
      "golden.doctor.verified.w1@example.test",
    );
    assert.equal(env.E2E_DOCTOR2_PASSWORD, "golden-verified");
  });

  it("names no golden account when its password is unknown — the spec stays not-run", () => {
    const env = slotLiveStandEnv({}, {}, "doctor");
    assert.equal(env.E2E_DOCTOR_EMAIL, undefined);
    assert.equal(env.E2E_DOCTOR2_EMAIL, undefined);
  });

  it("derives no stand key of the box — only golden accounts and slugs", () => {
    const env = slotLiveStandEnv({}, box, "doctor");
    for (const name of [
      "IDP_SERVICE_TOKEN",
      "IDP_PROJECT_ID",
      "CONGRESS_SIGNUP_EVENT_ID",
      "POSTGRES_PASSWORD",
    ])
      assert.equal(env[name], undefined, name);
  });

  it("lets an operator export win over the golden default", () => {
    const env = slotLiveStandEnv(
      { E2E_DOCTOR_EMAIL: "op@example.test", E2E_DOCTOR_PASSWORD: "op-pw" },
      golden,
      "doctor",
    );
    assert.equal(env.E2E_DOCTOR_EMAIL, "op@example.test");
    assert.equal(env.E2E_DOCTOR_PASSWORD, "op-pw");
  });

  it("hands a live leg the same env in Actions (no ssh) and over ssh", async () => {
    const legEnvs = async (env, readBoxEnv) => {
      let boxRead = false;
      const { calls, effects } = harness({
        issueState: () => "CLOSED",
        readBoxEnv: async () => {
          boxRead = true;
          return readBoxEnv();
        },
      });
      await runE2eStage(["main", "--expect-sha", SHA], { env, effects });
      return { boxRead, legs: calls.filter(isLive) };
    };
    const actions = await legEnvs(ACTIONS_ENV, async () => {
      throw new Error("Actions has no ssh");
    });
    assert.equal(
      actions.boxRead,
      false,
      "the release check in Actions reads no box env",
    );
    const ssh = await legEnvs(
      {
        CI: "1",
        E2E_PUBLIC_LOG: "1",
        E2E_WORKERS: "4",
        STAGE_BASIC_AUTH_PASS: "s3cret",
      },
      async () => ({
        ...BOX_ENV,
        ...box,
        DS_GOLDEN_PASSWORD_ADMIN: "golden-admin",
        DS_GOLDEN_PASSWORD_DOCTOR_MFA: "golden-mfa",
        DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED: "golden-unverified",
        BOT_PROTECTION_TEST_TOKEN: "captcha-token",
      }),
    );
    assert.equal(ssh.boxRead, true);
    assert.ok(actions.legs.length > 0);
    assert.equal(ssh.legs.length, actions.legs.length);
    const liveKeys = (e) =>
      Object.keys(e)
        .filter((k) =>
          /^(E2E_|IDP_|MAILPIT_|CONGRESS_|DATABASE_|DS_GOLDEN_)/.test(k),
        )
        .filter(
          (k) =>
            !["E2E_REPORT_DIR", "E2E_HTTP_USER", "E2E_HTTP_PASS"].includes(k),
        )
        .sort();
    actions.legs.forEach((leg, i) => {
      const other = ssh.legs[i];
      assert.deepEqual(
        liveKeys(other.env),
        liveKeys(leg.env),
        leg.argv.join(" "),
      );
      for (const k of liveKeys(leg.env))
        assert.equal(other.env[k], leg.env[k], k);
      assert.equal(
        other.env.IDP_SERVICE_TOKEN,
        undefined,
        "ssh hands no box key over",
      );
    });
  });
});

describe("E2E_PUBLIC_LOG=1 — every live leg of the release check (#3191)", () => {
  it("prints through the summary reporter and writes its json/html into the run's report dir", async () => {
    const { calls, effects } = harness({ issueState: () => "CLOSED" });
    await runE2eStage(["main", "--expect-sha", SHA], {
      env: {
        CI: "1",
        E2E_PUBLIC_LOG: "1",
        STAGE_BASE_DOMAIN: "stage.doctor.school",
        E2E_HTTP_USER: "stage",
        E2E_HTTP_PASS: "s3cret",
      },
      effects,
    });
    const live = calls.filter(isLive);
    assert.ok(live.length > 0);
    const reportDir = calls[0].env.E2E_REPORT_DIR.split(path.sep).join("/");
    for (const leg of live) {
      const label = leg.argv.join(" ");
      assert.ok(
        leg.argv.includes(`--reporter=${SUMMARY_REPORTER_PATH},json,html`),
        `${label}: the summary reporter, never list`,
      );
      assert.equal(
        leg.argv.some((t) => /--reporter=.*\blist\b/.test(t)),
        false,
        label,
      );
      const out = leg.argv.find((t) => t.startsWith("--output="));
      assert.ok(
        out.slice("--output=".length).startsWith(`${reportDir}/live-`),
        label,
      );
      for (const name of [
        "PLAYWRIGHT_JSON_OUTPUT_FILE",
        "PLAYWRIGHT_HTML_OUTPUT_DIR",
      ])
        assert.ok(
          leg.env[name].startsWith(`${reportDir}/live-`),
          `${label} ${name}`,
        );
      assert.equal(leg.env.PLAYWRIGHT_HTML_OPEN, "never");
    }
  });
});

describe("golden live env (#3191) — derived from the dataset every slot is cloned from", () => {
  it("names only slugs the golden catalogue publishes", () => {
    const ids = repoFile("packages/db/src/seed/golden/ids.ts");
    for (const [key, slug] of Object.entries(GOLDEN_EVENT_SLUGS))
      assert.ok(ids.includes(`slug: "${slug}"`), `${key}: ${slug}`);
  });

  it("hands each storefront's legs its own golden slugs, an operator export winning", () => {
    const academy = slotLiveStandEnv({}, {}, "academy");
    assert.equal(academy.E2E_ROOM_SLUG_LIVE, GOLDEN_EVENT_SLUGS.academyLive);
    const doctor = slotLiveStandEnv({}, {}, "doctor");
    assert.equal(doctor.E2E_WEBINAR_SLUG, GOLDEN_EVENT_SLUGS.live);
    assert.equal(doctor.E2E_ROOM_SLUG_LIVE, undefined);
    assert.equal(
      slotLiveStandEnv({ E2E_WEBINAR_SLUG: "op" }, {}, "doctor")
        .E2E_WEBINAR_SLUG,
      "op",
    );
    for (const host of Object.keys(GOLDEN_LIVE_ENV))
      assert.ok(["academy", "doctor"].includes(host), host);
  });

  it("satisfies the events-live config's own checks", () => {
    const env = GOLDEN_LIVE_ENV.doctor;
    assert.ok(["present", "absent"].includes(env.E2E_EVENTS_EXPECT_LIVE));
    for (const name of ["E2E_EVENTS_LOADED_PATH", "E2E_EVENTS_EMPTY_PATH"])
      assert.match(env[name], /^\/events(?:\?|$)/, name);
  });

  it("reports a spec a slot cannot run by its declared reason, never as missing env", () => {
    const tier = LIVE_TIERS.find((t) => t.name === "live/doctor/congress");
    const plan = planLiveLeg(tier, {
      E2E_DOCTOR_URL: "https://d",
      IDP_ISSUER: "https://i",
      MAILPIT_URL: "https://m",
    });
    const submissions = plan.notRun.find(
      (n) => n.file === "e2e/congress-submissions.spec.ts",
    );
    assert.match(submissions.byDesign, /docker network/);
    const verdict = liveLegVerdict({
      name: tier.name,
      plan,
      status: 0,
      report: LIVE_GREEN,
    });
    assert.match(
      verdict.detail,
      /congress-submissions\.spec\.ts \(by design: /,
    );
  });

  it("keeps exactly the three slot-red legs out of the release check, each with a reason citing #3229", () => {
    const excluded = LIVE_TIERS.filter((t) => t.releaseCheck);
    assert.deepEqual(excluded.map((t) => t.name).sort(), [
      "live/academy/default",
      "live/doctor/event-page",
      "live/doctor/shell",
    ]);
    for (const tier of LIVE_TIERS) {
      assert.doesNotThrow(() => releaseCheckExclusion(tier), tier.name);
      if (tier.releaseCheck)
        assert.match(releaseCheckExclusion(tier), /#3229/, tier.name);
    }
    // The Academy default leg names what keeps it out, the product deviation first.
    assert.match(
      releaseCheckExclusion(
        LIVE_TIERS.find((t) => t.name === "live/academy/default"),
      ),
      /008 EARS-14 footer absent on \/ \(product, epic #2020\)/,
    );
  });

  it("refuses an exclusion without a reason — a leg never leaves the release check silently", () => {
    for (const releaseCheck of [
      {},
      { excluded: "" },
      { excluded: "   " },
      { excluded: true },
      { excluded: "reason", extra: 1 },
    ]) {
      assert.throws(
        () => releaseCheckExclusion({ name: "live/x/y", releaseCheck }),
        /live\/x\/y.*releaseCheck/,
        JSON.stringify(releaseCheck),
      );
    }
    assert.equal(releaseCheckExclusion({ name: "live/x/y" }), undefined);
  });

  it("gives every by-design reason a variable a slot genuinely lacks", () => {
    const derivable = new Set([
      ...Object.keys(GOLDEN_LIVE_ENV.academy),
      ...Object.keys(GOLDEN_LIVE_ENV.doctor),
      "E2E_PORTAL_URL",
      "E2E_DOCTOR_URL",
      "IDP_ISSUER",
      "MAILPIT_URL",
      "E2E_CAPTCHA_TEST_TOKEN",
      "E2E_DOCTOR_EMAIL",
      "E2E_DOCTOR_PASSWORD",
      "E2E_DOCTOR2_EMAIL",
      "E2E_DOCTOR2_PASSWORD",
    ]);
    for (const tier of LIVE_TIERS)
      for (const g of tier.gated.filter((x) => x.slotReason))
        assert.ok(
          g.requires.some((name) => !derivable.has(name)),
          `${tier.name} ${g.file}: declared by design but a slot derives every variable it requires`,
        );
  });
});
