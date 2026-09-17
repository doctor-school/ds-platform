#!/usr/bin/env node
/**
 * `pnpm e2e:stage <slot>` — the REGRESSION RUN over a converged staging slot.
 *
 * Staging/previews/regression-contour tech spec, C4 and §8 step 7: the C6 suite and
 * the a11y suites are driven from the OPERATOR's machine against the slot's PUBLIC
 * hostnames — the same edge a reviewer uses, basic auth included — and the verdict is
 * pasted into the PR body or the release record by hand. There is deliberately no CI
 * check-run: staging is operated by hand like production (#2202), and a check-run
 * would need the LLM-free runner to hold the stand's credentials.
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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SlotError,
  STAGE_ENV_FILE,
  HEALTH_TIMEOUT_MS,
  assertBaseDomain,
  assertSlotName,
  basicAuthHeader,
  readBoxEnvFile,
  requiredBaseDomain,
  requiredBasicAuthUser,
  requiredOperatorPassword,
  shortSha,
  slotHostnames,
} from "./slot.mjs";
import { GOLDEN_PASSWORD_ENV_VARS } from "./idp.mjs";

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
        "[--no-axe] [--report-dir <path>] — the slot must be named",
    );
  }
  assertSlotName(slot);
  const options = {
    slot,
    project: undefined,
    grep: undefined,
    axe: true,
    reportDir: undefined,
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
      case "--report-dir":
        options.reportDir = takeValue(flag);
        break;
      default:
        throw new SlotError(`unknown flag: ${flag}`);
    }
  }
  return options;
}

/**
 * The env the suites read (§6.6): one base URL per storefront plus the stand's
 * basic-auth pair, which `packages/e2e/playwright.config.ts` turns into Playwright
 * `httpCredentials`. The portal serves under `academy-<slot>`, never `portal-`.
 */
export function slotE2eEnv({ slot, baseDomain, user, password }) {
  const hosts = slotHostnames(slot, baseDomain);
  return {
    E2E_PORTAL_URL: `https://${hosts.academy}`,
    E2E_DOCTOR_URL: `https://${hosts.doctor}`,
    E2E_HTTP_USER: user,
    E2E_HTTP_PASS: password,
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
  lines.push(
    row(
      "legs",
      legs.map((leg) => `${leg.name} ${leg.ok ? "PASS" : "FAIL"}`).join(" · "),
    ),
  );
  lines.push(row("report", reportDir));
  lines.push(
    row(
      "verdict",
      legs.length > 0 && legs.every((leg) => leg.ok) ? "PASS" : "FAIL",
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

  // ABSOLUTE: Playwright resolves a reporter's `outputFile`/`outputFolder` against
  // the CONFIG's directory, not the cwd, so a repo-relative path would bury the run
  // at `packages/e2e/packages/e2e/…` and the verdict block would report «no scenario
  // ran» over a suite that ran in full. The relative form stays for display only.
  const suiteEnv = {
    ...slotE2eEnv({ slot, baseDomain, user, password }),
    ...goldenPasswordEnv(env, boxEnv),
    E2E_REPORT_DIR: path.resolve(REPO_ROOT, reportDir),
  };
  if (options.grep) suiteEnv.E2E_GREP = options.grep;

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
      legs.push({
        name: "axe/academy",
        ok:
          effects.run(["pnpm", "--filter", "@ds/portal", "test:axe"], {
            env: suiteEnv,
          }).status === 0,
      });
    }
    if (axeHost("doctor")) {
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
            ],
            { env: suiteEnv },
          ).status === 0,
      });
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
      axeNote: axe.note,
      reportDir,
    }),
  );
  return exitCodeFor({ preflightOk: true, legs });
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
