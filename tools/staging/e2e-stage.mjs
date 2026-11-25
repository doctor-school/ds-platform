#!/usr/bin/env node
/**
 * `pnpm e2e:stage <slot>` — the REGRESSION RUN over a converged staging slot.
 *
 * Staging/previews/regression-contour tech spec, C4 and §8 step 7: the C6 suite and
 * the a11y suites are driven against the slot's PUBLIC hostnames — the same edge a
 * reviewer uses, basic auth included. For a PR slot the run executes in GitHub
 * Actions, never on the operator's machine (#4202): `pnpm e2e:stage pr-<N>`
 * dispatches `.github/workflows/stage.yml` on PR N's own head branch for its head
 * SHA (`dispatchStageRun`), waits for it, and prints the compact verdict the run posts
 * on PR N. `--local` keeps the workstation run, for debugging a single spec — and it
 * is what the Actions job itself runs. `--expect-sha` is the release check: for a `main`
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
 * The live-tier registry is injectable too (`liveTiers`, default `LIVE_TIERS`), so
 * the release-check exclusion path stays tested while no committed leg is excluded.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import {
  GOLDEN_IDP_ACCOUNTS,
  GOLDEN_PASSWORD_ENV_VARS,
  STAGE_AGENT_ADMIN,
  STAGE_AGENT_COMMITTEE,
} from "./idp.mjs";
import { GOLDEN_LIVE_ENV, LIVE_TIERS } from "./live-tiers.mjs";
import { boxObservingGrep, boxObservingTests } from "./box-observing.mjs";

const STAGE_STAFF_SECRET_NAMES = [STAGE_AGENT_ADMIN, STAGE_AGENT_COMMITTEE].flatMap(
  ({ passwordEnvVar, totpEnvVar }) => [passwordEnvVar, totpEnvVar],
);

function isStageStaffEnv(name) {
  return /^DS_STAGE_AGENT_(ADMIN|COMMITTEE)_/i.test(name);
}

/** The repo root — every leg runs from there, like the scripts in `package.json`. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The selectable projects of `packages/e2e/playwright.config.ts`: the two storefront
 * Gherkin projects plus `walks`, the derived navigation/route walks (§6.3), which one
 * project drives across BOTH hosts, and the sign-in host's two (ADR-0015 §4):
 * `login`, the Gherkin project of the door scenarios bound to it with `@host:login`
 * (each starts on a storefront entry and does its credential work on `login-<slot>`,
 * #3345), and `sign-in-host`, the host's own plain specs (`packages/e2e/sign-in-host`).
 *
 * Hand-kept in TWO places: the `projects:` array of that config is the other half,
 * and it carries the mirror comment. Rename a project in one and rename it here.
 */
export const HOST_PROJECTS = Object.freeze(["academy", "doctor"]);
export const PROJECTS = Object.freeze([
  ...HOST_PROJECTS,
  "walks",
  "login",
  "sign-in-host",
]);

/**
 * The contrast fix that has to be on `main` before the axe suites can join the slot
 * run (tech spec §6.6) — until then a red axe leg would be the KNOWN defect, not a
 * regression, and would train the operator to ignore the leg.
 */
export const AXE_GATE_ISSUE = 1692;

const REPORT_ROOT = "packages/e2e/playwright-report";
export const KEY_JOURNEYS_PATH = new URL(
  "../../apps/docs/content/specs/tech/2026-09-08-key-journey-tests.json",
  import.meta.url,
);

export function parseE2eArgs(argv) {
  const rest = [...argv];
  const slot = rest.shift();
  if (slot === undefined || slot.startsWith("-")) {
    throw new SlotError(
      "usage: pnpm e2e:stage <slot> [--project academy|doctor|walks|login|sign-in-host] [--grep <re>] " +
        "[--no-axe] [--no-live] [--local] [--report-dir <path>] [--verdict-file <path>] [--expect-sha <sha>] " +
        "[--slot-sha <sha>] [--no-box-observe] " +
        "— the slot must be named",
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
    local: false,
    verdictFile: undefined,
    slotSha: undefined,
    boxObserve: true,
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
      case "--local":
        options.local = true;
        break;
      case "--verdict-file":
        options.verdictFile = takeValue(flag);
        break;
      case "--no-box-observe":
        options.boxObserve = false;
        break;
      case "--slot-sha": {
        const sha = takeValue(flag);
        if (!FULL_SHA_RE.test(sha)) {
          throw new SlotError(
            "unusable --slot-sha — expected a full 40-character lowercase hex SHA",
          );
        }
        options.slotSha = sha;
        break;
      }
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
  // The PR-slot Actions run's own flags (#4202): they describe a run made HERE, so
  // they need `--local` — a dispatched run sets them itself.
  const runHere = [
    options.slotSha !== undefined && "--slot-sha",
    !options.boxObserve && "--no-box-observe",
  ].filter(Boolean);
  if (runHere.length > 0 && !options.local) {
    throw new SlotError(
      `${runHere.join(", ")} describe${runHere.length === 1 ? "s" : ""} a run made here — add --local (a dispatched PR-slot run sets ${runHere.length === 1 ? "it" : "them"} itself)`,
    );
  }
  if (dispatchesToActions(options)) {
    // A dispatched run's report goes to the stage box and its verdict to PR N; a
    // workstation path names nothing the Actions runner could write.
    const local = [
      options.reportDir !== undefined && "--report-dir",
      options.verdictFile !== undefined && "--verdict-file",
    ].filter(Boolean);
    if (local.length > 0) {
      throw new SlotError(
        `${local.join(", ")} name${local.length === 1 ? "s" : ""} a workstation path — a PR-slot run executes in Actions; add --local to run it here`,
      );
    }
  }
  return options;
}

/**
 * Whether this invocation dispatches the Actions run instead of running the suite
 * here (#4202): a PR slot, unless `--local`. The `main` slot keeps its own paths —
 * the release check (`--expect-sha`) and the `main` run of `stage.yml`.
 */
export function dispatchesToActions(options) {
  return (
    options.slot !== "main" &&
    !options.local &&
    options.expectSha === undefined
  );
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
    options.local && "--local",
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
 * No admin origin: the BDD suite reads a set `E2E_ADMIN_URL` as "this run owns
 * an admin origin" and runs its write scenarios against the shared slot, so only
 * the admin live leg receives it (#4157).
 */
export function slotE2eEnv({ slot, baseDomain, user, password }) {
  const hosts = slotHostnames(slot, baseDomain);
  return {
    E2E_PORTAL_URL: `https://${hosts.academy}`,
    E2E_DOCTOR_URL: `https://${hosts.doctor}`,
    E2E_LOGIN_URL: `https://${hosts.login}`,
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

/** GitHub refuses a commit-status description longer than this. */
const STATUS_DESCRIPTION_MAX = 140;

/**
 * The `stage-suite` commit-status description (#4222): the suite report's counts
 * plus every live leg's, with the live tiers that failed named in their run order,
 * e.g. `292 passed, 1 failed (live/academy/default), 838 skipped`. Counting goes
 * through `summarizeReport`, so a flaky test is a failure here too. `live` is
 * `[{ name, report }]`; a missing report (a leg skipped or never launched) counts
 * nothing; a missing suite report (`suite` undefined) prefixes the counts with
 * `suite report missing; live: `. The description never decides `state` — the
 * suite step's outcome does.
 * Past 140 chars, tier names drop from the end into `+N more`.
 */
export function suiteStatusDescription({ suite, live = [] } = {}) {
  const totals = { passed: 0, failed: 0, skipped: 0 };
  const add = (report) => {
    const delta = { passed: 0, failed: 0, skipped: 0 };
    for (const p of summarizeReport(report).projects) {
      for (const key of Object.keys(delta)) delta[key] += p[key];
    }
    for (const key of Object.keys(totals)) totals[key] += delta[key];
    return delta;
  };
  // A suite that died before writing its report must not read as a clean count
  // of whatever live legs ran.
  const prefix = suite === undefined ? "suite report missing; live: " : "";
  add(suite);
  const failing = live
    .filter((leg) => add(leg.report).failed > 0)
    .map((leg) => leg.name);
  const render = (shown) => {
    const more = failing.length - shown;
    const names = failing.slice(0, shown).join(", ");
    const list =
      shown === 0
        ? more > 0
          ? ` (${more} live tiers)`
          : ""
        : ` (${names}${more > 0 ? ` +${more} more` : ""})`;
    return `${prefix}${totals.passed} passed, ${totals.failed} failed${list}, ${totals.skipped} skipped`;
  };
  for (let shown = failing.length; shown > 0; shown -= 1) {
    const text = render(shown);
    if (text.length <= STATUS_DESCRIPTION_MAX) return text;
  }
  return render(0);
}

/**
 * `suiteStatusDescription` over a `--report-dir`: the suite's `results.json` at its
 * root and each live tier's at `liveLegReporting`'s directory — the files the run
 * already wrote. An unreadable or absent file counts nothing.
 */
export function suiteStatusDescriptionFromDir(reportDir, liveTiers = LIVE_TIERS) {
  const read = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  };
  return suiteStatusDescription({
    suite: read(path.join(reportDir, "results.json")),
    live: liveTiers.map((tier) => ({
      name: tier.name,
      report: read(
        path.join(liveLegReporting({}, reportDir, tier.name).dir, "results.json"),
      ),
    })),
  });
}

/** Exact identities, including every outline example, survive collection changes (§6.7). */
export function keyJourneyVerdict(citations, reports) {
  const collected = new Map();
  const key = ({ leg, file, project, title }) =>
    JSON.stringify([leg, file?.replaceAll("\\", "/"), project, title]);
  for (const [leg, report] of reports) {
    const walk = (suite, parents = []) => {
      const titles =
        suite.title === suite.file ? parents : [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const identity = key({
            leg,
            file: spec.file,
            project: test.projectName,
            title: [...titles, spec.title],
          });
          const matches = collected.get(identity) ?? [];
          matches.push(test);
          collected.set(identity, matches);
        }
      }
      for (const child of suite.suites ?? []) walk(child, titles);
    };
    for (const suite of report?.suites ?? []) walk(suite);
  }
  const failures = [];
  const seen = new Set();
  for (const citation of citations) {
    const { rows, leg, file, project, title } = citation;
    if (
      !Array.isArray(rows) ||
      rows.length === 0 ||
      !rows.every((id) => /^(?:D|A|S)\d+$/.test(id)) ||
      ![leg, file, project].every(
        (v) => typeof v === "string" && v.length > 0,
      ) ||
      !Array.isArray(title) ||
      title.length === 0 ||
      !title.every((v) => typeof v === "string" && v.length > 0)
    )
      throw new SlotError("invalid key-journey test identity in §6.7 manifest");
    const identity = key(citation);
    if (seen.has(identity))
      throw new SlotError(
        `duplicate key-journey test: ${file} ${title.join(" > ")}`,
      );
    seen.add(identity);
    const matches = collected.get(identity) ?? [];
    const test = matches[0];
    let reason;
    if (matches.length === 0) reason = "not run (test or report absent)";
    else if (matches.length !== 1) reason = "ambiguous duplicate test identity";
    else if (test.status !== "expected") reason = test.status ?? "no outcome";
    else if (
      test.expectedStatus !== "passed" ||
      test.results?.length !== 1 ||
      test.results[0].status !== "passed"
    )
      reason =
        "no single successful execution (skipped, expected failure or retry)";
    if (reason)
      failures.push(
        `${rows.join(",")} ${leg} [${project}] ${file} > ${title.join(" > ")}: ${reason}`,
      );
  }
  return { name: "key journeys", ok: failures.length === 0, failures };
}

export function keyJourneyTests(manifest) {
  if (!Array.isArray(manifest?.tests) || manifest.tests.length === 0)
    throw new SlotError(
      "§6.7 key-journey manifest must list at least one test",
    );
  const citations = manifest.tests.flatMap(({ titles, ...entry }) => {
    if (!Array.isArray(titles) || titles.length === 0)
      throw new SlotError(
        `§6.7 key-journey entry must list test titles: ${entry.file}`,
      );
    return titles.map((title) => ({ ...entry, title }));
  });
  keyJourneyVerdict(citations, new Map());
  return citations;
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
  notRun = [],
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
  // The box-observing tests a PR-slot Actions run leaves out (#4202), by name.
  if (notRun.length > 0) {
    lines.push(
      row("not run", `${notRun.length} box-observing (no box access here; run them with --local)`),
    );
    for (const t of notRun) lines.push(indent(`- ${t.title}`));
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

/** The stage box's root of shipped suite reports (`upload-report`, #4250). */
export const BOX_REPORTS_ROOT = "/var/lib/ds-platform/e2e-reports";

/**
 * The key of one suite attempt's report dir under its SHA. A re-run of the workflow
 * on the same SHA is a new attempt (GITHUB_RUN_ATTEMPT) or a new run (GITHUB_RUN_ID),
 * so each lands in its own dir and a green re-run never overwrites the failed
 * attempt's evidence. The box checks the key against its copy of this pattern
 * (`REPORT_ATTEMPT_RE` in infra/deploy/bin/ds-deploy-entrypoint, pinned equal by
 * tools/deploy/ds-deploy-entrypoint.test.mjs).
 */
export const REPORT_ATTEMPT_RE = /^attempt-([1-9][0-9]{0,4})-run-([1-9][0-9]{0,19})$/;

export function reportAttemptKey({ runAttempt, runId }) {
  const key = `attempt-${String(runAttempt ?? "").trim()}-run-${String(runId ?? "").trim()}`;
  if (!REPORT_ATTEMPT_RE.test(key)) {
    throw new Error(
      `report attempt key needs GITHUB_RUN_ATTEMPT and GITHUB_RUN_ID as positive integers, got ${JSON.stringify(key)}`,
    );
  }
  return key;
}

/** Where one attempt's report lands on the stage box. */
export function boxReportDir(sha, key) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`bad sha ${JSON.stringify(sha)}`);
  if (!REPORT_ATTEMPT_RE.test(key)) throw new Error(`bad report attempt key ${JSON.stringify(key)}`);
  return `${BOX_REPORTS_ROOT}/${sha}/${key}/`;
}

/**
 * The latest attempt among the dir names under one SHA's report dir: the highest run
 * id (runs are numbered in start order), then the highest attempt of that run.
 * Names that are not attempt keys (a pre-#4250 flat report's files) are ignored;
 * null when there is no attempt.
 */
export function latestReportAttempt(names) {
  let best = null;
  for (const name of names) {
    const m = REPORT_ATTEMPT_RE.exec(name);
    if (!m) continue;
    const at = { name, attempt: Number(m[1]), run: BigInt(m[2]) };
    if (!best || at.run > best.run || (at.run === best.run && at.attempt > best.attempt)) best = at;
  }
  return best ? best.name : null;
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
  readKeyJourneys: () => {
    const manifest = JSON.parse(readFileSync(KEY_JOURNEYS_PATH, "utf8"));
    return keyJourneyTests(manifest);
  },
  removeReport: (file) => rmSync(file, { force: true }),
  boxObservingTests: () => boxObservingTests(),
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
  run: (argv, { env }) => {
    const inherited = { ...process.env };
    for (const name of Object.keys(inherited).filter(isStageStaffEnv)) delete inherited[name];
    return spawnSync(assertShellInert(argv), {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: true,
      env: { ...inherited, ...env },
    });
  },
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

// --- the PR-slot run in Actions (#4202) ---------------------------------------

/** The workflow a PR-slot run is dispatched to, and the ref its file is read from. */
export const STAGE_WORKFLOW = "stage.yml";
/**
 * The ref a PR-slot run never runs under: a `main`-ref run holds `main`'s Actions
 * cache scope, which `main`'s privileged workflows restore, and this run executes PR
 * code. It is dispatched on the PR's own head branch instead — that branch's cache
 * scope, which `main` never reads — with the `stage-pr` environment's secrets, never
 * `stage`'s (#4202).
 */
export const MAIN_REF = "refs/heads/main";
/** The PR comment the run posts carries this marker, so the CLI finds its own. */
export const runMarker = (runId) => `<!-- e2e-stage-run:${runId} -->`;
/** The run title (`run-name` of stage.yml) — it ends with the SHA, as retention reads. */
export const slotRunTitle = (slot, sha) => `Stage ${slot} ${sha}`;

const FAILING_TITLES_MAX = 20;
const DISPATCH_POLL_MS = 20_000;
const RUN_APPEAR_POLLS = 12;
/** Queue + install + the suite job's 90-min limit, with margin. */
export const RUN_WAIT_MS = 150 * 60_000;

/**
 * Counts and failing titles out of Playwright's JSON report, for the PR comment.
 * Unlike `summarizeReport` (whose verdict counts a flaky test as a failure), the
 * comment names flaky apart, so a reader sees which red needed a retry.
 */
export function reportTally(report) {
  const tally = { passed: 0, failed: 0, flaky: 0, skipped: 0, failing: [] };
  const walk = (suite, parents = []) => {
    const titles =
      suite.title && suite.title !== suite.file
        ? [...parents, suite.title]
        : parents;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const status = test?.status;
        if (status === "expected") tally.passed += 1;
        else if (status === "skipped") tally.skipped += 1;
        else {
          if (status === "flaky") tally.flaky += 1;
          else tally.failed += 1;
          const title = [...titles, spec.title].join(" > ").replace(/\s+/g, " ");
          tally.failing.push(
            `[${test?.projectName ?? "unknown"}] ${title}${status === "flaky" ? " (flaky)" : ""}`,
          );
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child, titles);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  return tally;
}

/**
 * The whole run's tally out of a `--report-dir`: the suite's `results.json` at its
 * root plus every leg's `<reportDir>/<leg>/results.json` — each live leg
 * (`liveLegReporting`) and each axe leg (`publicAxeLeg`) — summed, each failing title
 * prefixed with its leg (`suite`, or the leg's directory name). A missing or
 * unreadable report counts nothing.
 */
export function reportDirTally(reportDir) {
  const tally = { passed: 0, failed: 0, flaky: 0, skipped: 0, failing: [] };
  const read = (file) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  };
  let legs = [];
  try {
    legs = readdirSync(reportDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // No report dir: the suite's own report is then unreadable too, so nothing counts.
  }
  const reports = [
    ["suite", path.join(reportDir, "results.json")],
    ...legs.map((leg) => [leg, path.join(reportDir, leg, "results.json")]),
  ];
  for (const [leg, file] of reports) {
    const report = read(file);
    if (report === undefined) continue;
    const part = reportTally(report);
    for (const key of ["passed", "failed", "flaky", "skipped"]) tally[key] += part[key];
    tally.failing.push(...part.failing.map((title) => `${leg}: ${title}`));
  }
  return tally;
}

/**
 * The tally `slot-suite` hands `slot-verdict` as a job output: the counts and at
 * most 20 failing titles, with the total so the comment can say how many more.
 */
export function compactTally(tally) {
  return {
    passed: tally.passed,
    failed: tally.failed,
    flaky: tally.flaky,
    skipped: tally.skipped,
    failing: tally.failing.slice(0, FAILING_TITLES_MAX),
    failingTotal: tally.failing.length,
  };
}

/**
 * The correctness check of a PR-slot dispatch (#4202) — the right slot, the PR's head,
 * a same-repo PR — run by the `slot-gate` job before `slot-suite` starts. It is the
 * dispatched branch's own code, so it is not a security boundary: those are the write
 * access a dispatch needs, the `stage-pr` deployment-branch policy, and `stage-pr`
 * holding no ssh key under no `main` cache scope. `ref` is the run's `github.ref`;
 * `pr` is the `GET /repos/{repo}/pulls/{N}` reply for `slot=pr-<N>`, or undefined when
 * it could not be read. A run under `main`'s ref is refused first. Otherwise it passes
 * only for a run on PR N's head branch, for the SHA that is the head of an OPEN PR N
 * pushed to THIS repository.
 */
export function prSlotGate({ slot, sha, ref, repository, pr }) {
  const refuse = (reason) => ({ ok: false, reason });
  if (ref === MAIN_REF)
    return refuse(
      "a PR-slot run never runs under main's ref (main's Actions cache scope) — dispatch it on the PR branch with pnpm e2e:stage pr-<N>",
    );
  const match = /^pr-([1-9][0-9]{0,9})$/.exec(String(slot ?? ""));
  if (!match)
    return refuse(
      "slot must be pr-<N> — the main slot runs only from Runtime images",
    );
  if (!FULL_SHA_RE.test(String(sha ?? "")))
    return refuse("sha is not a 40-hex SHA");
  if (!pr || typeof pr !== "object" || String(pr.number) !== match[1])
    return refuse(`PR ${match[1]} is not readable`);
  if (pr.state !== "open") return refuse(`PR ${match[1]} is not open`);
  const headRepo = pr.head?.repo?.full_name;
  if (!repository || headRepo !== repository)
    return refuse(
      `PR ${match[1]} is not from this repository (head: ${headRepo ?? "a deleted repository"})`,
    );
  if (!pr.head?.ref || ref !== `refs/heads/${pr.head.ref}`)
    return refuse(
      `the run's ref is not PR ${match[1]}'s head branch — dispatch it on that branch with pnpm e2e:stage pr-${match[1]}`,
    );
  if (pr.head?.sha !== sha)
    return refuse(
      `sha ${sha.slice(0, 12)} is not the head of PR ${match[1]} (${String(pr.head?.sha ?? "?").slice(0, 12)})`,
    );
  return { ok: true, pr: Number(match[1]) };
}

/** The refusal of a PR-slot run whose slot does not serve the PR head (#4202). */
export function slotShaRefusal(served, head, slot) {
  return (
    `e2e:stage refuses: slot serves ${String(served ?? "?").slice(0, 12)}, PR head is ${head.slice(0, 12)} — re-sync the slot ` +
    `(\`pnpm stage:slot up ${slot}\`) and dispatch again.`
  );
}

/**
 * What the dispatching CLI prints after a PR-slot run (#4202): the box-observing
 * tests the Actions run left out, by name, and the exact `--local` command that
 * runs just them from the workstation (one browser is enough there).
 */
export function boxObservingNote(slot, tests) {
  if (tests.length === 0) return [];
  return [
    `e2e:stage: ${tests.length} box-observing test${tests.length === 1 ? "" : "s"} not run in Actions (the run has no box access):`,
    ...tests.map((t) => `  - ${t.title}`),
    "Run them from the workstation:",
    `  pnpm e2e:stage ${slot} --local --grep "${boxObservingGrep(tests)}"`,
  ];
}

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

/**
 * Text a test title or a refusal puts in the comment, inert as Markdown: no HTML,
 * code span or line break, no link (`[`/`]` escaped), and no @mention — a
 * zero-width space after `@` keeps GitHub from notifying anyone.
 */
const commentText = (text) =>
  text
    .replace(/[<>`\r\n]/g, " ")
    .replace(/[[\]]/g, "\\$&")
    .replace(/@/g, "@​");

/**
 * The compact verdict the Actions run posts on PR N (#4202): verdict, counts, the
 * failing titles (≤20), the run link, and the e2e:stage verdict block when the run
 * produced one. Rendered by the `slot-verdict` job (`GITHUB_TOKEN` only) from `slot-suite`'s
 * outputs, which are data: `passed` is decided by the caller from the job result,
 * never read from them. A refused gate, an unanswered `/v1/health`, a red leg —
 * anything but a green suite — is FAIL, with its reason.
 */
// The `stage-pr` environment's deployment-branch policy is `*/*`, and a deployment-
// branch `*` never matches `/`: only a ref with exactly one `/` between two non-empty
// segments reaches `slot-suite`. The policy is the operator's; this mirrors it only to
// name the cause when a branch falls outside it.
export function stagePrPolicyAdmits(branch) {
  return /^[^/]+\/[^/]+$/.test(String(branch ?? ""));
}

const STAGE_PR_POLICY_MISS =
  "the `stage-pr` environment's deployment-branch policy `*/*` admits only a ref with exactly one `/` (`<prefix>/<N>-<slug>`)";

/**
 * Why a PR-slot run stopped before the suite reached a verdict. A branch outside the
 * `stage-pr` policy never gets `slot-suite` started, whatever it is rebased on; only a
 * branch inside it points at a stale `e2e-stage.mjs` (not rebased on `main`).
 */
export function suiteStoppedReason({ suiteResult, branch }) {
  const head = `the run stopped before the suite reached a verdict (slot-suite ${suiteResult})`;
  return stagePrPolicyAdmits(branch)
    ? `${head}; a branch not rebased on main lacks the PR-slot flags of e2e-stage.mjs: rebase it on main and dispatch again`
    : `${head}; ${STAGE_PR_POLICY_MISS}, and ${branch} is outside it: rename the branch and dispatch again`;
}

export function renderPrVerdictComment({
  runId,
  runUrl,
  slot,
  sha,
  passed,
  reason,
  verdictBlock,
  tally,
}) {
  const t = tally && typeof tally === "object" ? tally : {};
  const failing = (Array.isArray(t.failing) ? t.failing : [])
    .slice(0, FAILING_TITLES_MAX)
    .map((title) => commentText(String(title)).slice(0, 300));
  const lines = [
    runMarker(runId),
    `### e2e:stage ${slot} — ${passed ? "PASS" : "FAIL"}`,
    "",
    `\`${FULL_SHA_RE.test(String(sha ?? "")) ? sha.slice(0, 12) : "?"}\` · [Actions run ${runId}](${runUrl})`,
  ];
  if (reason) lines.push("", `Refused: ${commentText(String(reason))}`);
  lines.push(
    "",
    tally
      ? `passed ${count(t.passed)} · failed ${count(t.failed)} · flaky ${count(t.flaky)} · skipped ${count(t.skipped)}`
      : "no scenario counts — the suite produced no report",
  );
  if (failing.length > 0) {
    lines.push("", "Failing:");
    for (const title of failing) lines.push(`- ${title}`);
    const more = count(t.failingTotal) - failing.length;
    if (more > 0) lines.push(`- … and ${more} more`);
  }
  if (verdictBlock)
    lines.push("", "```text", verdictBlock.replace(/```(text)?/g, "").trim(), "```");
  lines.push(
    "",
    "The full report is not kept in Actions (this repository's artifacts are public); `pnpm e2e:stage <slot> --local` reproduces it.",
  );
  return `${lines.join("\n")}\n`;
}

/**
 * `gh` and `git` run WITHOUT a shell (both are real executables on the operator
 * box), so `--grep` — the one arbitrary value — travels as one argv element and
 * never parses as shell text.
 */
export const realDispatchEffects = {
  gh: (args) => spawnSync("gh", args, { cwd: REPO_ROOT, encoding: "utf8" }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: (line) => console.log(line),
  boxObservingTests: () => boxObservingTests(),
};

const stdoutOf = (r) => String(r?.stdout ?? "").trim();
const failedRun = (r) => r?.status !== 0;
const errLine = (r) =>
  String(r?.stderr || r?.error?.message || "")
    .trim()
    .split("\n")[0] || `exit ${r?.status}`;

/** The `-f name=value` inputs of the dispatch; only the filters that are set. */
export function dispatchInputs(options, sha) {
  const inputs = [`slot=${options.slot}`, `sha=${sha}`];
  if (options.project !== undefined) inputs.push(`project=${options.project}`);
  if (options.grep !== undefined) inputs.push(`grep=${options.grep}`);
  if (!options.axe) inputs.push("no-axe=true");
  if (!options.live) inputs.push("no-live=true");
  return inputs.flatMap((input) => ["-f", input]);
}

/**
 * `pnpm e2e:stage pr-<N>` (#4202): dispatch the PR-slot run of `stage.yml` on PR N's
 * own head branch for its pushed head SHA, wait for it, print the verdict comment it
 * posted on PR N. The run never runs under `main`'s ref, so PR code never holds
 * `main`'s Actions cache scope; the branch must carry this workflow's PR-slot jobs
 * (rebased on `main`). A cross-repository PR is refused: there is no branch here to
 * dispatch on. No browser starts here. Exit 0 only for a successful run, 1 for any
 * other conclusion, 2 when nothing was dispatched.
 */
export async function dispatchStageRun(options, effects = realDispatchEffects) {
  const { slot } = options;
  const pr = slot.slice("pr-".length);
  const refuse = (reason) => {
    effects.log(`e2e:stage refuses to dispatch: ${reason}`);
    return 2;
  };

  const prView = effects.gh([
    "pr",
    "view",
    pr,
    "--json",
    "headRefName,headRefOid,isCrossRepository",
  ]);
  let head;
  try {
    head = failedRun(prView) ? undefined : JSON.parse(stdoutOf(prView));
  } catch {
    head = undefined;
  }
  if (head === undefined || head === null || typeof head !== "object")
    return refuse(`PR ${pr} is not readable (${errLine(prView)})`);
  if (head.isCrossRepository !== false)
    return refuse(
      `PR ${pr} is from another repository — a PR-slot run dispatches only on a branch of this one`,
    );
  const sha = String(head.headRefOid ?? "");
  const branch = String(head.headRefName ?? "");
  if (!FULL_SHA_RE.test(sha) || branch === "")
    return refuse(`PR ${pr} has no readable head branch and SHA`);
  if (`refs/heads/${branch}` === MAIN_REF)
    return refuse(
      `PR ${pr}'s head branch is main — a PR-slot run never runs under main's ref`,
    );
  if (!stagePrPolicyAdmits(branch))
    return refuse(
      `PR ${pr}'s head branch ${branch} is outside ${STAGE_PR_POLICY_MISS}: rename the branch and dispatch again`,
    );

  const title = slotRunTitle(slot, sha);
  const listRuns = () => {
    const r = effects.gh([
      "run",
      "list",
      "--workflow",
      STAGE_WORKFLOW,
      "--event",
      "workflow_dispatch",
      "--branch",
      branch,
      "--limit",
      "30",
      "--json",
      "databaseId,displayTitle,url",
    ]);
    if (failedRun(r)) return undefined;
    try {
      return JSON.parse(stdoutOf(r)).filter((run) => run.displayTitle === title);
    } catch {
      return undefined;
    }
  };
  const before = listRuns();
  if (before === undefined)
    return refuse("`gh run list` failed — is gh logged in?");
  const known = new Set(before.map((run) => run.databaseId));

  const started = effects.gh([
    "workflow",
    "run",
    STAGE_WORKFLOW,
    "--ref",
    branch,
    ...dispatchInputs(options, sha),
  ]);
  if (failedRun(started))
    return refuse(
      `\`gh workflow run\` on ${branch} failed (${errLine(started)}) — the branch is inside the stage-pr policy, so a stage.yml without the PR-slot dispatch is the likely cause: rebase it on main first`,
    );
  effects.log(
    `e2e:stage dispatched ${STAGE_WORKFLOW} on ${branch} for ${slot} at ${sha.slice(0, 12)}`,
  );

  let run;
  for (let i = 0; i < RUN_APPEAR_POLLS && run === undefined; i += 1) {
    await effects.sleep(5_000);
    run = (listRuns() ?? []).find((r) => !known.has(r.databaseId));
  }
  if (run === undefined) {
    effects.log(
      `e2e:stage: the dispatched run did not appear — look for «${title}» in Actions`,
    );
    return 1;
  }
  effects.log(`e2e:stage waits for ${run.url}`);

  const deadline = effects.now() + RUN_WAIT_MS;
  let view;
  for (let last = ""; ; ) {
    const r = effects.gh([
      "run",
      "view",
      String(run.databaseId),
      "--json",
      "status,conclusion",
    ]);
    if (!failedRun(r)) {
      try {
        view = JSON.parse(stdoutOf(r));
      } catch {
        view = undefined;
      }
      if (view?.status && view.status !== last) {
        last = view.status;
        effects.log(`e2e:stage run ${run.databaseId}: ${last}`);
      }
      if (view?.status === "completed") break;
    }
    if (effects.now() >= deadline) {
      effects.log(
        `e2e:stage: stopped waiting after ${RUN_WAIT_MS / 60_000} min — ${run.url}`,
      );
      return 1;
    }
    await effects.sleep(DISPATCH_POLL_MS);
  }

  const marker = runMarker(run.databaseId);
  const comments = effects.gh([
    "api",
    "--paginate",
    `repos/{owner}/{repo}/issues/${pr}/comments`,
    "--jq",
    `.[] | select(.body | startswith(${JSON.stringify(marker)})) | .body`,
  ]);
  const body = failedRun(comments) ? "" : stdoutOf(comments);
  if (body.startsWith(marker)) effects.log(body.slice(marker.length).trim());
  else
    effects.log(
      `e2e:stage: run ${run.databaseId} posted no verdict comment on #${pr}`,
    );
  for (const line of boxObservingNote(slot, effects.boxObservingTests()))
    effects.log(line);
  effects.log(`e2e:stage run ${run.url}: ${view.conclusion}`);
  return view.conclusion === "success" ? 0 : 1;
}

// --- the command --------------------------------------------------------------

export async function runE2eStage(
  argv,
  {
    env = process.env,
    effects = realEffects,
    liveTiers = LIVE_TIERS,
    dispatch = realDispatchEffects,
  } = {},
) {
  const options = parseE2eArgs(argv);
  const { slot } = options;
  if (dispatchesToActions(options)) return dispatchStageRun(options, dispatch);
  // `--verdict-file`: the block below, also written where the Actions job reads it
  // for the PR comment — the refusal included, so a refused run never reads as a pass.
  const recordVerdict = (text) => {
    if (options.verdictFile !== undefined) effects.writeFile(options.verdictFile, text);
  };

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
    const refusal =
      `e2e:stage refuses: ${healthUrl} — ${preflight.reason}${health.error ? ` (${health.error})` : ""}. ` +
      "This command runs against a CONVERGED slot; raise it with `pnpm stage:slot up " +
      `${slot}` +
      "` first.";
    effects.log(refusal);
    recordVerdict(`${["```text", refusal, "```"].join("\n")}\n`);
    return exitCodeFor({ preflightOk: false, legs: [] });
  }

  // The PR-slot Actions run (#4202) asserts the slot serves the dispatched PR head
  // before any scenario runs: a slot raised at an older SHA would otherwise certify
  // that older code under the head's name.
  if (options.slotSha !== undefined) {
    const served = healthVerdict({ ...health, sha: options.slotSha });
    if (!served.ok) {
      const refusal = slotShaRefusal(preflight.sha, options.slotSha, slot);
      effects.log(refusal);
      recordVerdict(`${["```text", refusal, "```"].join("\n")}\n`);
      return exitCodeFor({ preflightOk: false, legs: [] });
    }
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
  // `--no-box-observe` (the PR-slot Actions run, #4202): the box-observing tests are
  // left out by name — the suite's and every leg's Playwright config read
  // `E2E_GREP_INVERT` — and the verdict block names them.
  const notRun = options.boxObserve ? [] : effects.boxObservingTests();
  if (notRun.length > 0) suiteEnv.E2E_GREP_INVERT = boxObservingGrep(notRun);
  if (publicLogEnabled(env)) suiteEnv.E2E_PUBLIC_LOG = "1";
  const axeLeg = (host) => publicAxeLeg(env, suiteEnv.E2E_REPORT_DIR, host);

  const legs = [];
  const reports = new Map();
  const suiteReport = path.join(suiteEnv.E2E_REPORT_DIR, "results.json");
  const suiteArgv = ["pnpm", "--filter", "@ds/e2e", "test:e2e"];
  if (options.project) suiteArgv.push("--project", options.project);
  effects.removeReport(suiteReport);
  legs.push({
    name: "suite",
    ok: effects.run(suiteArgv, { env: suiteEnv }).status === 0,
  });
  reports.set("suite", effects.readReport(suiteReport));

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
    for (const tier of liveTiers.filter((t) => axeHost(t.host))) {
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
      if (tier.host === "admin") {
        legEnv.E2E_ADMIN_URL = `https://${slotHostnames(slot, baseDomain).admin}`;
        legEnv.E2E_STAGE_ADMIN_EMAIL = STAGE_AGENT_ADMIN.username;
        legEnv.E2E_STAGE_COMMITTEE_EMAIL = STAGE_AGENT_COMMITTEE.username;
        // Playwright's error-time ARIA snapshot is independent of trace and
        // screenshot settings. Keep the MFA form out of published reports.
        legEnv.PLAYWRIGHT_NO_COPY_PROMPT = "1";
        for (const name of STAGE_STAFF_SECRET_NAMES) legEnv[name] = env[name];
      }
      const plan = planLiveLeg(tier, { ...env, ...legEnv });
      if (!plan.run) {
        live.push(liveLegVerdict({ name: tier.name, plan }));
        continue;
      }
      const pnpm = ["pnpm", "--filter", tier.pkg];
      const reportFile = path.join(reporting.dir, "results.json");
      effects.removeReport(reportFile);
      let status = 0;
      if (tier.prepare) {
        status = effects.run([...pnpm, ...tier.prepare], {
          env: legEnv,
        }).status;
      }
      if (status === 0) {
        const selection = [];
        if (tier.include) {
          const listFile = `${reporting.dir}/selected.txt`;
          const files = tier.include.map((file) =>
            path.posix.relative(tier.rootDir, file),
          );
          effects.writeFile(listFile, `${files.join("\n")}\n`);
          selection.push(`--test-list=${listFile}`);
        } else {
          selection.push("--pass-with-no-tests");
        }
        if (plan.invertList.length > 0) {
          const listFile = `${reporting.dir}/not-run.txt`;
          effects.writeFile(listFile, `${plan.invertList.join("\n")}\n`);
          selection.push(`--test-list-invert=${listFile}`);
        }
        status = effects.run(
          [
            ...pnpm,
            "exec",
            "playwright",
            "test",
            `--config=${tier.config}`,
            ...selection,
            ...reporting.args,
          ],
          { env: legEnv },
        ).status;
      }
      const report = effects.readReport(reportFile);
      reports.set(tier.name, report);
      live.push(
        liveLegVerdict({
          name: tier.name,
          plan,
          status,
          report,
        }),
      );
    }
  }

  if (options.expectSha !== undefined) {
    const required = keyJourneyVerdict(effects.readKeyJourneys(), reports);
    for (const failure of required.failures)
      effects.log(`key journey FAIL: ${failure}`);
    legs.push(required);
  }
  const summary = summarizeReport(reports.get("suite"));
  const block = renderVerdictBlock({
    slot,
    healthUrl,
    sha: preflight.sha,
    summary,
    legs,
    live,
    axeNote: axe.note,
    reportDir,
    notRun,
  });
  effects.log(block);
  recordVerdict(block);
  return exitCodeFor({ preflightOk: true, legs: [...legs, ...live] });
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

export function runE2eStageCommand(argv, options) {
  // Keep staff credentials out of every ambient child environment (including
  // the SSH box read and gh lookup). Only the admin leg receives them explicitly.
  const env = { ...process.env };
  for (const name of Object.keys(process.env).filter(isStageStaffEnv)) {
    delete process.env[name];
  }
  return runE2eStage(argv, { ...options, env });
}

if (invokedDirectly) {
  runE2eStageCommand(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err instanceof SlotError ? err.message : err);
      process.exitCode = 2;
    },
  );
}
