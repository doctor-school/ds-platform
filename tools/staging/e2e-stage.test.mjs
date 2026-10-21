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
  renderVerdictBlock,
  runE2eStage,
  slotE2eEnv,
  slotLiveEnv,
  SUMMARY_REPORTER_PATH,
  summarizeReport,
} from "./e2e-stage.mjs";
import {
  AXE_LEG_CONFIGS,
  HERMETIC_CONFIGS,
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
      /live\/doctor\/events-live\s+skipped — missing env E2E_EVENTS_LOADED_PATH/,
    );
    assert.match(
      out,
      /live\/doctor\/register-live\s+SKIPPED — ran 0 passed \/ 0 failed \/ 1 skipped/,
    );
    assert.match(out, /verdict:\s+PASS — \d+ live legs? skipped/);
    // events-live is never launched: its config throws at load without its env.
    assert.equal(
      calls.some((c) =>
        c.argv.includes("--config=playwright.events-live.config.ts"),
      ),
      false,
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

  it("leaves the live legs out and says so in the verdict — until #3191", async () => {
    for (const extra of [[], ["--no-live"]]) {
      const { calls, lines, effects } = harness();
      const code = await runE2eStage(["main", "--expect-sha", SHA, ...extra], {
        env: RELEASE_ENV,
        effects,
      });
      assert.equal(code, 0);
      assert.equal(calls.filter(isLive).length, 0);
      const out = lines.join("\n");
      assert.match(out, /live:\s+not run in the release check — until #3191/);
      assert.match(out, /verdict:\s+PASS$/m);
    }
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
