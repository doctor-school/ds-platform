#!/usr/bin/env node
/**
 * `pnpm e2e:stage <slot>` — the REGRESSION RUN over a converged staging slot.
 *
 * Staging/previews/regression-contour tech spec, C4 and §8 step 7: the C6 suite and
 * the a11y suites are driven from the OPERATOR's machine against the slot's PUBLIC
 * hostnames — the same edge a reviewer uses, basic auth included. A preview verdict is
 * pasted into the PR body by hand. `--expect-sha` is the release check: for a `main`
 * push the Actions `stage.yml` suite job runs it and posts the `stage-suite` commit
 * status the release pre-flight reads (#2985, #3198); `pnpm deploy:prod` runs it itself
 * only for a `--ref` hotfix target (C7, tools/deploy/stage-main-check.mjs).
 *
 * ── What this command is NOT ─────────────────────────────────────────────────
 * It never raises, syncs or tears down a slot. «A converged slot» is its
 * PRECONDITION, asserted with one `/v1/health` read and refused with exit 2 when it
 * does not hold, because a suite pointed at a half-raised slot reports product
 * regressions that are really topology. Raising belongs to `pnpm stage:slot up`.
 *
 * ── Where the topology comes from ────────────────────────────────────────────
 * Every hostname, the base domain, the basic-auth pair and the allowlisted golden
 * passwords come from `slot.mjs` / `idp.mjs` and `/etc/ds-platform/stage.env` — the
 * same sources the converge reads. This file owns no hostname or credential-name
 * literal of its own, so topology and identity changes cannot silently leave the
 * regression run on a stale contract.
 *
 * ── Testability ──────────────────────────────────────────────────────────────
 * ssh, the network, `pnpm` and `gh` are injected effects (`runE2eStage`), so
 * `e2e-stage.test.mjs` drives the whole command — pre-flight refusal, env derivation,
 * the axe gate, the verdict block, the exit codes — on a machine with no box.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FULL_SHA_RE,
  SlotError,
  STAGE_ENV_FILE,
  HEALTH_TIMEOUT_MS,
  assertBaseDomain,
  assertSlotName,
  basicAuthHeader,
  healthVerdict,
  idpHostname,
  readBoxEnvFile,
  requiredBaseDomain,
  requiredBasicAuthUser,
  requiredOperatorPassword,
  shortSha,
  slotHostnames,
} from "./slot.mjs";
import { GOLDEN_IDP_ACCOUNTS, GOLDEN_PASSWORD_ENV_VARS } from "./idp.mjs";
import { GOLDEN_LIVE_ENV, LIVE_TIERS } from "./live-tiers.mjs";

/** The repo root — every leg runs from there, like the scripts in `package.json`. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The selectable projects of `packages/e2e/playwright.config.ts`: the two storefront
 * Gherkin projects plus `walks`, the derived navigation/route walks (§6.3), which one
 * project drives across BOTH hosts.
 *
 * Hand-kept in TWO places: the `projects:` array of that config is the other half,
 * and it carries the mirror comment. Rename a project in one and rename it here.
 */
export const HOST_PROJECTS = Object.freeze(["academy", "doctor"]);
export const PROJECTS = Object.freeze([...HOST_PROJECTS, "walks"]);

/**
 * The contrast fix that has to be on `main` before the axe suites can join the slot
 * run (tech spec §6.6) — until then a red axe leg would be the KNOWN defect, not a
 * regression, and would train the operator to ignore the leg.
 */
export const AXE_GATE_ISSUE = 1692;

const REPORT_ROOT = "packages/e2e/playwright-report";

export function parseE2eArgs(argv) {
  const rest = [...argv];
  const slot = rest.shift();
  if (slot === undefined || slot.startsWith("-")) {
    throw new SlotError(
      "usage: pnpm e2e:stage <slot> [--project academy|doctor|walks] [--grep <re>] " +
        "[--no-axe] [--no-live] [--report-dir <path>] [--expect-sha <sha>] — the slot must be named",
    );
  }
  assertSlotName(slot);
  const options = {
    slot,
    project: undefined,
    grep: undefined,
    axe: true,
    reportDir: undefined,
    expectSha: undefined,
    live: true,
  };
  const takeValue = (flag) => {
    const value = rest.shift();
    if (value === undefined) throw new SlotError(`${flag} needs a value`);
    return value;
  };
  for (let flag = rest.shift(); flag !== undefined; flag = rest.shift()) {
    switch (flag) {
      case "--project": {
        const project = takeValue(flag);
        if (!PROJECTS.includes(project)) {
          throw new SlotError(
            `unusable --project: ${project} — expected ${PROJECTS.join("|")}`,
          );
        }
        options.project = project;
        break;
      }
      case "--grep":
        options.grep = takeValue(flag);
        break;
      case "--no-axe":
        options.axe = false;
        break;
      case "--no-live":
        options.live = false;
        break;
      case "--report-dir":
        options.reportDir = takeValue(flag);
        break;
      case "--expect-sha": {
        const sha = takeValue(flag);
        if (!FULL_SHA_RE.test(sha)) {
          throw new SlotError(
            `unusable --expect-sha: ${JSON.stringify(sha)} — expected a full 40-character lowercase hex SHA`,
          );
        }
        options.expectSha = sha;
        break;
      }
      default:
        throw new SlotError(`unknown flag: ${flag}`);
    }
  }
  if (options.expectSha !== undefined) assertReleaseCheckShape(options);
  return options;
}

/**
 * `--expect-sha` is the RELEASE CHECK `pnpm deploy:prod` runs before shipping (#2701):
 * the `main` slot, the whole suite, every axe leg and every live-tier leg (#3191)
 * that `live-tiers.mjs` does not exclude from it with a printed reason.
 * A narrowed run proves only its slice, so the release check refuses any narrowing
 * flag — `--no-live` included — instead of passing on part of it.
 */
function assertReleaseCheckShape(options) {
  if (options.slot !== "main") {
    throw new SlotError(
      `--expect-sha is the release check and runs on the \`main\` slot only, not ${options.slot}`,
    );
  }
  const narrowing = [
    options.project !== undefined && "--project",
    options.grep !== undefined && "--grep",
    options.axe === false && "--no-axe",
    options.live === false && "--no-live",
  ].filter(Boolean);
  if (narrowing.length > 0) {
    throw new SlotError(
      `--expect-sha is the release check and runs the full suite — drop ${narrowing.join(", ")}`,
    );
  }
}

/**
 * The env-side half of the same rule: `E2E_GREP` in the inherited env filters the
 * suite (`packages/e2e/playwright.config.ts` compiles it), and without `CI` the
 * config's `forbidOnly` is off, so a stray `test.only` would pass on one scenario.
 * Returns the refusal reason, or `undefined` when the env runs the full suite.
 */
export function releaseCheckEnvRefusal(env) {
  if (env?.E2E_GREP) {
    return "E2E_GREP is set and would filter the suite — unset it for the release check";
  }
  if (!env?.CI) {
    return "CI=1 is required for the release check — it turns on Playwright's forbidOnly";
  }
  return undefined;
}

/**
 * Public-log mode (`E2E_PUBLIC_LOG=1`, set only by `.github/workflows/stage.yml`,
 * #2985): the run's console is a PUBLIC Actions log. The suite config then swaps
 * its console reporter for `packages/e2e/reporters/summary.ts`
 * (`packages/e2e/lib/reporters.ts`), and the two axe legs — whose configs print
 * with `list`, error text included — get the same reporter on their command line,
 * with their json/html report written into the report dir (`publicAxeLeg`).
 * This command's own lines never carry a response body or a credential in either
 * mode: the pre-flight reports a status or a fixed reason, never the body.
 */
export const SUMMARY_REPORTER_PATH = path
  .join(REPO_ROOT, "packages", "e2e", "reporters", "summary.ts")
  .split(path.sep)
  .join("/");

export function publicLogEnabled(env) {
  return env?.E2E_PUBLIC_LOG === "1";
}

const toPosix = (p) => p.split(path.sep).join("/");

/**
 * One axe leg's public-mode wiring: the summary reporter on the console, PLUS
 * Playwright's `json` + `html` reporters and the test artifacts (traces) under
 * `<reportDir>/axe-<host>/`, so the report shipped to the box is complete for a
 * red axe leg too. Outside public mode the leg keeps its own config reporter.
 */
export function publicAxeLeg(env, reportDir, host) {
  if (!publicLogEnabled(env)) return { args: [], env: {} };
  const dir = toPosix(path.join(reportDir, `axe-${host}`));
  return {
    args: [
      `--reporter=${SUMMARY_REPORTER_PATH},json,html`,
      `--output=${dir}/artifacts`,
    ],
    env: {
      PLAYWRIGHT_JSON_OUTPUT_FILE: `${dir}/results.json`,
      PLAYWRIGHT_HTML_OUTPUT_DIR: `${dir}/html`,
      PLAYWRIGHT_HTML_OPEN: "never",
    },
  };
}

/**
 * The env the suites read (§6.6): one base URL per storefront plus the stand's
 * basic-auth pair, which `packages/e2e/playwright.config.ts` turns into Playwright
 * `httpCredentials`. The portal serves under `academy-<slot>`, never `portal-`.
 * The SMS sink is one shared host per stand (like Mailpit), read through the
 * same basic-auth pair (`packages/e2e/lib/sms-sink.ts`), so the `@sms-reset`
 * scenarios run on a slot instead of naming their skip (#2878).
 */
export function slotE2eEnv({ slot, baseDomain, user, password }) {
  const hosts = slotHostnames(slot, baseDomain);
  return {
    E2E_PORTAL_URL: `https://${hosts.academy}`,
    E2E_DOCTOR_URL: `https://${hosts.doctor}`,
    E2E_HTTP_USER: user,
    E2E_HTTP_PASS: password,
    E2E_SMS_SINK_URL: `https://sms-sink.${baseDomain}`,
  };
}

/**
 * The only box secrets the browser suite may receive. An explicit operator value
 * wins so the documented no-SSH mode remains usable; otherwise the already-read
 * stage env supplies the credential reset-identities converged. The deleted doctor
 * is absent from GOLDEN_PASSWORD_ENV_VARS because no live IdP account may exist.
 */
export function goldenPasswordEnv(operatorEnv, boxEnv) {
  return Object.fromEntries(
    GOLDEN_PASSWORD_ENV_VARS.flatMap((name) => {
      const operatorValue = operatorEnv?.[name];
      const boxValue = boxEnv?.[name];
      const value = operatorValue || boxValue;
      return value ? [[name, value]] : [];
    }),
  );
}

/**
 * The stand's bot-protection test token (#2605), handed to the suite as
 * `E2E_CAPTCHA_TEST_TOKEN` so `packages/e2e/lib/captcha-stub.ts` can resolve the
 * Yandex widget on a captcha-gated journey. An explicit operator value wins (the
 * no-SSH mode); otherwise the already-read stage env supplies it. Absent on both
 * sides ⇒ absent, and the stub throws by name the moment a journey needs it.
 */
export function captchaTestTokenEnv(operatorEnv, boxEnv) {
  const value =
    operatorEnv?.E2E_CAPTCHA_TEST_TOKEN || boxEnv?.BOT_PROTECTION_TEST_TOKEN;
  return value ? { E2E_CAPTCHA_TEST_TOKEN: value } : {};
}

/**
 * What the live-tier legs (#3168, `live-tiers.mjs`) need from the stand beyond the
 * suite env: the shared IdP origin (one for every slot, `idpHostname`) and the shared
 * Mailpit (one per stand, behind the same basic-auth pair — README «Mailpit»).
 * Hostnames only: Playwright does not send `__Host-` cookies to `127.0.0.1`.
 * The golden accounts and slugs come from `slotLiveStandEnv`; a key neither the
 * slot's hostnames nor the golden dataset nor the Actions env carries is not
 * derived, and its spec is reported «not run» (`live-tiers.mjs` `slotReason`).
 * A tier's own golden slugs (`seededEnv`, {@link seededLegEnv}) win over the host's.
 */
export function slotLiveEnv({ baseDomain }) {
  return {
    IDP_ISSUER: `https://${idpHostname(baseDomain)}`,
    MAILPIT_URL: `https://mailpit.${baseDomain}`,
  };
}

/** The golden accounts a live spec signs in as: `E2E_DOCTOR_*` and `E2E_DOCTOR2_*`. */
const LIVE_DOCTOR_ACCOUNTS = Object.freeze([
  { prefix: "E2E_DOCTOR", key: "doctorVerified" },
  { prefix: "E2E_DOCTOR2", key: "doctorVerifiedW1" },
]);

/**
 * The live legs' env DERIVED for a slot (#3191), so a live spec runs instead of
 * reading «not run — missing». ONE derivation for both modes: its inputs are the
 * operator's env and the golden passwords under their `DS_GOLDEN_PASSWORD_*`
 * names (`goldenPasswordEnv` — the environment-`stage` secrets in Actions, the
 * box's stage env over ssh), never anything else of the box. So the release check
 * in Actions (no ssh, README «The same check in Actions») and an operator run with
 * ssh hand a live spec the same env. An operator export wins over the defaults:
 * - `E2E_DOCTOR_*` / `E2E_DOCTOR2_*` — the golden verified doctor and its first
 *   worker-pool copy (`idp.mjs` GOLDEN_IDP_ACCOUNTS); no password ⇒ no account.
 * - `GOLDEN_LIVE_ENV[host]` — the golden event slugs and `/events` paths a
 *   spec of that storefront reads (`live-tiers.mjs`).
 * A stand key Actions does not carry (an IdP management token, the congress
 * sign-up block, a database URL) is not derived: its spec is declared with a
 * `slotReason` in `live-tiers.mjs` and reported «not run».
 */
export function slotLiveStandEnv(operatorEnv, goldenPasswords, host) {
  const env = {};
  for (const [name, value] of Object.entries(GOLDEN_LIVE_ENV[host] ?? {})) {
    env[name] = operatorEnv?.[name] || value;
  }
  for (const { prefix, key } of LIVE_DOCTOR_ACCOUNTS) {
    const account = GOLDEN_IDP_ACCOUNTS.find((a) => a.key === key);
    const email = operatorEnv?.[`${prefix}_EMAIL`] || account.username;
    const password =
      operatorEnv?.[`${prefix}_PASSWORD`] ||
      goldenPasswords?.[account.passwordEnvVar];
    if (!password) continue;
    env[`${prefix}_EMAIL`] = email;
    env[`${prefix}_PASSWORD`] = password;
  }
  return env;
}

const isSet = (env, name) => Boolean(env?.[name]?.trim());

/**
 * #2996 — a live tier's golden slugs (`seededEnv`, `live-tiers.mjs`), for that
 * tier's leg only. An operator-exported value of the same name wins: the leg env
 * overrides the inherited one, so a seeded slug is dropped wherever the operator
 * already named their own.
 */
export function seededLegEnv(tier, operatorEnv) {
  return Object.fromEntries(
    Object.entries(tier.seededEnv ?? {}).filter(
      ([name]) => !isSet(operatorEnv, name),
    ),
  );
}

/**
 * One live config's run plan against the env the leg will have. A config that
 * throws at load without its env is not launched (`run: false`); otherwise every
 * gated spec missing a variable — and every spec another leg owns (`exclude`) — is
 * kept out through Playwright's `--test-list-invert`, whose lines resolve against
 * the config's `rootDir`. Kept out, not run-and-skipped: `requireLiveStandEnv`
 * reads a slot run (storefront URL set) as an INTENDED tier and would fail loudly.
 */
export function planLiveLeg(tier, available) {
  const missingOf = (names) => names.filter((name) => !isSet(available, name));
  const configMissing = missingOf(tier.configRequires ?? []);
  if (configMissing.length > 0) {
    return {
      run: false,
      reason: `missing env ${configMissing.join(", ")}`,
      notRun: [],
      invertList: [],
    };
  }
  const notRun = tier.gated
    .map((g) => ({
      file: g.file,
      missing: missingOf(g.requires),
      ...(g.slotReason ? { byDesign: g.slotReason } : {}),
    }))
    .filter((g) => g.missing.length > 0);
  const toLine = (file) => path.posix.relative(tier.rootDir, file);
  return {
    run: true,
    notRun,
    invertList: [...(tier.exclude ?? []), ...notRun.map((n) => n.file)].map(
      toLine,
    ),
  };
}

/**
 * A live tier's exclusion from the release check (`releaseCheck.excluded` in
 * `live-tiers.mjs`), or `undefined` when the release check runs it. An exclusion
 * must carry its reason — the release record prints it — so an entry without one,
 * or with any other key, is refused instead of dropping a leg silently.
 */
export function releaseCheckExclusion(tier) {
  if (tier.releaseCheck === undefined) return undefined;
  const { excluded, ...rest } = tier.releaseCheck ?? {};
  if (
    typeof excluded !== "string" ||
    excluded.trim() === "" ||
    Object.keys(rest).length > 0
  ) {
    throw new SlotError(
      `${tier.name}: releaseCheck must be exactly { excluded: "<reason>" } with a non-empty reason`,
    );
  }
  return excluded;
}

/**
 * A live leg's verdict. `ok` is what the exit code folds: a leg that RAN with a
 * failure (or exited non-zero) is fatal; a leg that ran nothing — never launched
 * for missing env, or every test skipped — is SKIPPED: printed loudly, never
 * called green, and not fatal, because the slot cannot supply operator keys.
 */
export function liveLegVerdict({ name, plan, status, report }) {
  if (!plan.run) {
    return {
      name,
      ok: true,
      state: "skipped",
      launched: false,
      detail: `skipped — ${plan.reason}`,
    };
  }
  const summary = summarizeReport(report);
  const sum = (key) => summary.projects.reduce((n, p) => n + p[key], 0);
  const passed = sum("passed");
  const failed = sum("failed");
  const skipped = sum("skipped");
  const notRun = plan.notRun.length
    ? ` · not run: ${plan.notRun
        .map((n) =>
          n.byDesign
            ? `${n.file} (by design: ${n.byDesign})`
            : `${n.file} (missing ${n.missing.join(", ")})`,
        )
        .join("; ")}`
    : "";
  const state =
    status !== 0 || failed > 0 ? "fail" : passed === 0 ? "skipped" : "pass";
  // A runner that died before any test (a failed `prepare`, a config that throws at
  // load) leaves no report: «ran 0 / 0 / 0» would read as an empty run, so the
  // verdict names the exit instead.
  const diedBeforeTests = status !== 0 && passed + failed + skipped === 0;
  return {
    name,
    ok: state !== "fail",
    state,
    launched: true,
    detail: diedBeforeTests
      ? `runner exited ${status} before any test ran${notRun}`
      : `ran ${passed} passed / ${failed} failed / ${skipped} skipped${notRun}`,
  };
}

/**
 * A live leg's reporters: always Playwright's `json` (the counts come from it) into
 * `<reportDir>/<leg>/`, plus `list` on the console — or, in public-log mode, the
 * summary reporter and `html`, exactly as `publicAxeLeg` wires the axe legs.
 */
export function liveLegReporting(env, reportDir, name) {
  const dir = toPosix(path.join(reportDir, name.split("/").join("-")));
  const publicLog = publicLogEnabled(env);
  return {
    dir,
    args: [
      `--reporter=${publicLog ? `${SUMMARY_REPORTER_PATH},json,html` : "list,json"}`,
      `--output=${dir}/artifacts`,
    ],
    env: {
      PLAYWRIGHT_JSON_OUTPUT_FILE: `${dir}/results.json`,
      ...(publicLog
        ? {
            PLAYWRIGHT_HTML_OUTPUT_DIR: `${dir}/html`,
            PLAYWRIGHT_HTML_OPEN: "never",
          }
        : {}),
    },
  };
}

export function slotHealthUrl(slot, baseDomain) {
  return `https://${slotHostnames(slot, baseDomain).api}/v1/health`;
}

/**
 * The pre-flight verdict — `slot.mjs`'s `healthVerdict` asserts a slot serves an
 * EXPECTED sha, which is what a converge knows and a regression run does not: this
 * command is handed a slot someone else raised, so it asserts only that the edge
 * answers and REPORTS the sha it serves into the verdict block.
 */
export function preflightVerdict({ status, body }) {
  if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
  let json;
  try {
    json = JSON.parse(String(body ?? ""));
  } catch {
    return { ok: false, reason: "the health response was not JSON" };
  }
  const version =
    json && typeof json === "object" && typeof json.version === "string"
      ? json.version.trim()
      : "";
  if (version === "")
    return { ok: false, reason: "the health response carried no `.version`" };
  return { ok: true, sha: version };
}

/** Whether the §6.6 axe leg joins this run, and the one line that says why not. */
export function axeDecision({ axe, issueState }) {
  if (!axe) return { run: false, note: "axe leg skipped: --no-axe" };
  if (issueState === "CLOSED") return { run: true, note: "axe leg: on" };
  if (issueState === "OPEN") {
    return { run: false, note: `axe leg skipped: #${AXE_GATE_ISSUE} open` };
  }
  return {
    run: false,
    note: `axe leg skipped: the state of #${AXE_GATE_ISSUE} could not be read`,
  };
}

/**
 * Per-project counts out of Playwright's JSON report.
 *
 * `flaky` counts as a FAILURE: the suite runs with `retries: 0`, so a flaky result
 * can only mean a scenario that needed a second chance, and calling that green is
 * exactly the signal loss §6.5 forbids.
 */
export function summarizeReport(report) {
  const byProject = new Map();
  const bucketFor = (project) => {
    if (!byProject.has(project)) {
      byProject.set(project, { project, passed: 0, failed: 0, skipped: 0 });
    }
    return byProject.get(project);
  };
  let total = 0;
  const walk = (suite) => {
    for (const spec of suite?.specs ?? []) {
      for (const test of spec?.tests ?? []) {
        total += 1;
        const bucket = bucketFor(test?.projectName ?? "unknown");
        if (test?.status === "expected") bucket.passed += 1;
        else if (test?.status === "skipped") bucket.skipped += 1;
        else bucket.failed += 1;
      }
    }
    for (const child of suite?.suites ?? []) walk(child);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  const projects = [...byProject.values()];
  return {
    projects,
    failed: projects.reduce((n, p) => n + p.failed, 0),
    total,
  };
}

export function exitCodeFor({ preflightOk, legs }) {
  if (!preflightOk) return 2;
  if (legs.length === 0) return 1;
  return legs.every((leg) => leg.ok) ? 0 : 1;
}

const LABEL_WIDTH = 13;
const row = (label, value) => `${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
const indent = (value) => `${"".padEnd(LABEL_WIDTH)}${value}`;

/** The text the operator pastes into the PR body / release record (C4). */
export function renderVerdictBlock({
  slot,
  healthUrl,
  sha,
  summary,
  legs,
  live = [],
  axeNote,
  reportDir,
  preflightReason,
}) {
  const lines = [
    "e2e:stage verdict",
    row("slot", slot),
    row("health", healthUrl),
  ];
  if (sha) lines.push(row("head", shortSha(sha)));
  if (preflightReason) lines.push(row("pre-flight", preflightReason));
  const counts = summary.projects.map(
    (p) =>
      `${p.project} ${p.passed} passed / ${p.failed} failed / ${p.skipped} skipped`,
  );
  lines.push(row("suite", counts[0] ?? "no scenario ran"));
  for (const extra of counts.slice(1)) lines.push(indent(extra));
  lines.push(row("axe", axeNote));
  // One line per live-tier config: «ran (counts)» or «skipped — reason». The
  // name column is padded so the block stays readable when pasted.
  const nameWidth = Math.max(0, ...live.map((leg) => leg.name.length)) + 2;
  const liveLines = live.map((leg) => {
    const label = { pass: "PASS", fail: "FAIL", skipped: "SKIPPED" }[leg.state];
    const text = leg.launched ? `${label} — ${leg.detail}` : leg.detail;
    return `${leg.name.padEnd(nameWidth)}${text}`;
  });
  if (liveLines.length > 0) {
    lines.push(row("live", liveLines[0]));
    for (const extra of liveLines.slice(1)) lines.push(indent(extra));
  }
  lines.push(
    row(
      "legs",
      legs.map((leg) => `${leg.name} ${leg.ok ? "PASS" : "FAIL"}`).join(" · "),
    ),
  );
  lines.push(row("report", reportDir));
  const all = [...legs, ...live];
  const skippedLive = live.filter((leg) => leg.state === "skipped").length;
  const green = legs.length > 0 && all.every((leg) => leg.ok);
  lines.push(
    row(
      "verdict",
      green && skippedLive > 0
        ? `PASS — ${skippedLive} live leg${skippedLive === 1 ? "" : "s"} skipped`
        : green
          ? "PASS"
          : "FAIL",
    ),
  );
  return ["```text", ...lines, "```", ""].join("\n");
}

/** `2026-09-14T10:11:12.000Z` → `20260914T101112Z`, so a run dir sorts by time. */
export function reportStamp(now) {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

// --- the effects --------------------------------------------------------------

/**
 * `shell: true`: `pnpm` and `gh` are `.cmd` shims on the Windows operator box, which
 * `spawnSync` refuses to exec directly (the `tools/lint/guard-tests/run-guard.ts`
 * rationale). A shell means the command line is PARSED, so every token this file
 * hands it must be shell-inert — asserted, not assumed. The one value an operator can
 * make arbitrary (`--grep`) never reaches the command line at all: it travels as
 * `E2E_GREP` and `packages/e2e/playwright.config.ts` compiles it, so a perfectly
 * ordinary regex alternation (`"вход|выход"`) cannot become a pipeline.
 */
const SHELL_INERT_RE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function assertShellInert(argv) {
  for (const token of argv) {
    if (!SHELL_INERT_RE.test(token)) {
      throw new SlotError(
        `refusing to run a command with a shell-unsafe token: ${JSON.stringify(token)}`,
      );
    }
  }
  return argv.join(" ");
}

export const realEffects = {
  readBoxEnv: () => readBoxEnvFile(STAGE_ENV_FILE),
  fetchHealth: async (url, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      return { status: res.status, body: await res.text() };
    } catch (e) {
      return {
        status: 0,
        body: "",
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      clearTimeout(timer);
    }
  },
  run: (argv, { env }) =>
    spawnSync(assertShellInert(argv), {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env },
    }),
  writeFile: (file, content) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  },
  readReport: (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  },
  issueState: (number) => {
    const out = spawnSync(
      assertShellInert([
        "gh",
        "issue",
        "view",
        String(number),
        "--json",
        "state",
      ]),
      { cwd: REPO_ROOT, encoding: "utf8", shell: true },
    );
    if (out.status !== 0) return undefined;
    try {
      return JSON.parse(out.stdout).state;
    } catch {
      return undefined;
    }
  },
  log: (line) => console.log(line),
  now: () => new Date(),
};

// --- the command --------------------------------------------------------------

export async function runE2eStage(
  argv,
  { env = process.env, effects = realEffects } = {},
) {
  const options = parseE2eArgs(argv);
  const { slot } = options;

  if (options.expectSha !== undefined) {
    const refusal = releaseCheckEnvRefusal(env);
    if (refusal) {
      effects.log(`e2e:stage refuses the release check: ${refusal}.`);
      return exitCodeFor({ preflightOk: false, legs: [] });
    }
  }

  // The box is read ONLY for what the operator's own env does not already carry, so
  // an operator without ssh can run the suite with `STAGE_BASE_DOMAIN` +
  // `E2E_HTTP_USER`/`E2E_HTTP_PASS` exported.
  const selfSufficient = Boolean(
    env.STAGE_BASE_DOMAIN && env.E2E_HTTP_USER && env.E2E_HTTP_PASS,
  );
  const boxEnv = selfSufficient ? {} : await effects.readBoxEnv();
  const baseDomain = env.STAGE_BASE_DOMAIN
    ? assertBaseDomain(env.STAGE_BASE_DOMAIN)
    : requiredBaseDomain(boxEnv);
  const user = env.E2E_HTTP_USER || requiredBasicAuthUser(boxEnv);
  const password = env.E2E_HTTP_PASS || requiredOperatorPassword(env);

  const healthUrl = slotHealthUrl(slot, baseDomain);
  const health = await effects.fetchHealth(healthUrl, {
    authorization: basicAuthHeader(user, password),
    accept: "application/json",
  });
  const preflight = preflightVerdict(health);
  const reportDir =
    options.reportDir ??
    path.posix.join(REPORT_ROOT, `${slot}-${reportStamp(effects.now())}`);

  if (!preflight.ok) {
    effects.log(
      `e2e:stage refuses: ${healthUrl} — ${preflight.reason}${health.error ? ` (${health.error})` : ""}. ` +
        "This command runs against a CONVERGED slot; raise it with `pnpm stage:slot up " +
        `${slot}` +
        "` first.",
    );
    return exitCodeFor({ preflightOk: false, legs: [] });
  }

  // The release check asserts the slot serves the release TARGET, not merely a SHA:
  // a suite run against a stale `main` slot would certify code the deploy does not ship.
  if (options.expectSha !== undefined) {
    const served = healthVerdict({ ...health, sha: options.expectSha });
    if (!served.ok) {
      effects.log(
        `e2e:stage refuses the release check: ${healthUrl} — ${served.reason}. ` +
          `Converge it with \`pnpm stage:slot up main --ref ${options.expectSha}\` first.`,
      );
      return exitCodeFor({ preflightOk: false, legs: [] });
    }
  }

  // ABSOLUTE: Playwright resolves a reporter's `outputFile`/`outputFolder` against
  // the CONFIG's directory, not the cwd, so a repo-relative path would bury the run
  // at `packages/e2e/packages/e2e/…` and the verdict block would report «no scenario
  // ran» over a suite that ran in full. The relative form stays for display only.
  const suiteEnv = {
    ...slotE2eEnv({ slot, baseDomain, user, password }),
    ...goldenPasswordEnv(env, boxEnv),
    ...captchaTestTokenEnv(env, boxEnv),
    E2E_REPORT_DIR: path.resolve(REPO_ROOT, reportDir),
  };
  if (options.grep) suiteEnv.E2E_GREP = options.grep;
  if (publicLogEnabled(env)) suiteEnv.E2E_PUBLIC_LOG = "1";
  const axeLeg = (host) => publicAxeLeg(env, suiteEnv.E2E_REPORT_DIR, host);

  const legs = [];
  const suiteArgv = ["pnpm", "--filter", "@ds/e2e", "test:e2e"];
  if (options.project) suiteArgv.push("--project", options.project);
  legs.push({
    name: "suite",
    ok: effects.run(suiteArgv, { env: suiteEnv }).status === 0,
  });

  const axe = axeDecision({
    axe: options.axe,
    issueState: effects.issueState(AXE_GATE_ISSUE),
  });
  effects.log(axe.note);
  // The axe legs are the two STOREFRONT a11y suites, so a host's leg joins the run
  // only when that host is the selection — `--project walks` selects neither host and
  // gets neither leg, instead of silently pulling both storefront suites back in.
  const axeHost = (host) =>
    options.project === undefined || options.project === host;
  if (axe.run) {
    if (axeHost("academy")) {
      const leg = axeLeg("academy");
      legs.push({
        name: "axe/academy",
        ok:
          effects.run(
            ["pnpm", "--filter", "@ds/portal", "test:axe", ...leg.args],
            { env: { ...suiteEnv, ...leg.env } },
          ).status === 0,
      });
    }
    if (axeHost("doctor")) {
      const leg = axeLeg("doctor");
      legs.push({
        name: "axe/doctor",
        ok:
          effects.run(
            [
              "pnpm",
              "--filter",
              "@ds/doctor",
              "exec",
              "playwright",
              "test",
              "--config=playwright.room.config.ts",
              "a11y/room-axe",
              ...leg.args,
            ],
            { env: { ...suiteEnv, ...leg.env } },
          ).status === 0,
      });
    }
  }

  // The storefront LIVE-TIER configs (#3168): one leg each, selected by host like
  // the axe legs. Each leg gets the suite env plus the stand's IdP and Mailpit;
  // the golden accounts and slugs come from `slotLiveStandEnv` — the same env in
  // Actions (no ssh) and over ssh. The release check runs them like every other
  // leg (#3191), except a tier `live-tiers.mjs` excludes from it with a reason:
  // that leg is named with its reason, never run, and a plain slot run keeps it.
  const live = [];
  if (options.live) {
    for (const tier of LIVE_TIERS.filter((t) => axeHost(t.host))) {
      const excluded = releaseCheckExclusion(tier);
      if (options.expectSha !== undefined && excluded !== undefined) {
        effects.log(
          `live: ${tier.name} not in the release check — ${excluded}`,
        );
        continue;
      }
      const reporting = liveLegReporting(
        env,
        suiteEnv.E2E_REPORT_DIR,
        tier.name,
      );
      const legEnv = {
        ...suiteEnv,
        ...slotLiveEnv({ baseDomain }),
        ...slotLiveStandEnv(env, suiteEnv, tier.host),
        // A tier's own golden slugs (#2996) are more specific than the host's.
        ...seededLegEnv(tier, env),
        E2E_API_URL: env.E2E_API_URL || new URL(healthUrl).origin,
        ...reporting.env,
      };
      const plan = planLiveLeg(tier, { ...env, ...legEnv });
      if (!plan.run) {
        live.push(liveLegVerdict({ name: tier.name, plan }));
        continue;
      }
      const pnpm = ["pnpm", "--filter", tier.pkg];
      let status = 0;
      if (tier.prepare) {
        status = effects.run([...pnpm, ...tier.prepare], {
          env: legEnv,
        }).status;
      }
      if (status === 0) {
        const invert = [];
        if (plan.invertList.length > 0) {
          const listFile = `${reporting.dir}/not-run.txt`;
          effects.writeFile(listFile, `${plan.invertList.join("\n")}\n`);
          invert.push(`--test-list-invert=${listFile}`);
        }
        status = effects.run(
          [
            ...pnpm,
            "exec",
            "playwright",
            "test",
            `--config=${tier.config}`,
            "--pass-with-no-tests",
            ...invert,
            ...reporting.args,
          ],
          { env: legEnv },
        ).status;
      }
      live.push(
        liveLegVerdict({
          name: tier.name,
          plan,
          status,
          report: effects.readReport(path.join(reporting.dir, "results.json")),
        }),
      );
    }
  }

  const summary = summarizeReport(
    effects.readReport(path.join(suiteEnv.E2E_REPORT_DIR, "results.json")),
  );
  effects.log(
    renderVerdictBlock({
      slot,
      healthUrl,
      sha: preflight.sha,
      summary,
      legs,
      live,
      axeNote: axe.note,
      reportDir,
    }),
  );
  return exitCodeFor({ preflightOk: true, legs: [...legs, ...live] });
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  runE2eStage(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err instanceof SlotError ? err.message : err);
      process.exitCode = 2;
    },
  );
}
