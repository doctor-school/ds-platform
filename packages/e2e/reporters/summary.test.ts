import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { TestCase, TestResult } from "@playwright/test/reporter";
import { afterAll, describe, expect, it } from "vitest";

import SummaryReporter, { formatSummaryLine, redactTitle } from "./summary.js";

/**
 * The public console reporter (#2985): one line per test with project, title
 * path, status, duration and retry — and nothing a public Actions log must not
 * carry: no error text, no test output, no attachment, no URL, no secret.
 */
const SECRET = "s3cret-AbCdEf0123456789";

function fakeTest(titlePath: string[]): TestCase {
  return { titlePath: () => titlePath } as unknown as TestCase;
}

function failedResult(): TestResult {
  return {
    status: "failed",
    duration: 1234.4,
    retry: 1,
    error: {
      message: `expected https://stage:${SECRET}@api-main.stage.doctor.school`,
      stack: `Error: ${SECRET}\n    at step (https://academy-main.stage.doctor.school/x)`,
    },
    errors: [{ message: `body: {"token":"${SECRET}"}` }],
    stdout: [`stdout ${SECRET}`],
    stderr: [`stderr ${SECRET}`],
    attachments: [
      { name: "trace", contentType: "application/zip", path: "/tmp/trace.zip" },
    ],
    steps: [],
    annotations: [],
    workerIndex: 0,
    parallelIndex: 0,
    startTime: new Date(0),
  } as unknown as TestResult;
}

describe("SummaryReporter — a failing fixture", () => {
  const lines: string[] = [];
  const reporter = new SummaryReporter({ write: (l) => lines.push(l) });
  reporter.onTestEnd(
    fakeTest([
      "",
      "academy",
      "auth/login.feature.spec.js",
      "Вход",
      "неверный пароль",
    ]),
    failedResult(),
  );
  reporter.onError({ message: `worker crashed: ${SECRET} https://x.example` });
  reporter.onEnd({ status: "failed" } as never);
  const out = lines.join("\n");

  it("prints project, title path, status, duration and retry", () => {
    expect(lines[0]).toBe(
      "failed      [academy] Вход › неверный пароль (1234 ms, retry 1)",
    );
    expect(out).toMatch(
      /summary: 0 passed, 1 failed, 0 timed out, 0 interrupted, 0 skipped — run failed/,
    );
  });

  it("prints no error text, no test output, no attachment, no URL and no secret", () => {
    expect(out).not.toContain(SECRET);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toMatch(
      /expected|body:|stdout|stderr|trace\.zip|worker crashed/,
    );
  });

  it("claims stdio, so Playwright adds no `line`/`dot` reporter of its own", () => {
    expect(reporter.printsToStdio()).toBe(true);
  });
});

describe("formatSummaryLine", () => {
  it("redacts a URL inside a test title", () => {
    expect(
      redactTitle("doctor guest → https://doctor-main.stage.doctor.school/a"),
    ).toBe("doctor guest → <url>");
    expect(
      formatSummaryLine({
        project: "walks",
        titlePath: ["doctor navigation", "doctor guest → /events"],
        status: "passed",
        durationMs: 10,
        retry: 0,
      }),
    ).toBe(
      "passed      [walks] doctor navigation › doctor guest → /events (10 ms, retry 0)",
    );
  });
});

// --- a REAL Playwright run over a failing fixture -----------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const reportDir = mkdtempSync(path.join(tmpdir(), "e2e-summary-"));
afterAll(() => rmSync(reportDir, { recursive: true, force: true }));

describe("E2E_PUBLIC_LOG=1 — the whole console of a real failing run", () => {
  const run = spawnSync(
    process.execPath,
    [
      path.join(here, "..", "node_modules", "@playwright", "test", "cli.js"),
      "test",
      "--config",
      path.join(here, "fixtures", "fixture.playwright.ts"),
    ],
    {
      cwd: path.join(here, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        E2E_PUBLIC_LOG: "1",
        E2E_REPORT_DIR: reportDir,
        FORCE_COLOR: "0",
      },
      timeout: 120_000,
    },
  );
  const console = `${run.stdout}\n${run.stderr}`;

  it("fails, and prints one summary line per test", () => {
    expect(run.status).toBe(1);
    expect(console).toMatch(
      /^failed +\[\] leak probe › fails with a secret in its error \(\d+ ms, retry 0\)$/m,
    );
    expect(console).toMatch(
      /^passed +\[\] leak probe › passes \(\d+ ms, retry 0\)$/m,
    );
  });

  it("leaks no error text, test output, URL or secret to the console", () => {
    expect(console).not.toContain("s3cret");
    expect(console).not.toMatch(/https?:\/\//);
    expect(console).not.toMatch(/toBe|Expected|stdout carries|stderr carries/);
  });

  it("keeps the full evidence in E2E_REPORT_DIR only", () => {
    expect(existsSync(path.join(reportDir, "html", "index.html"))).toBe(true);
    const json = readFileSync(path.join(reportDir, "results.json"), "utf8");
    expect(json).toContain("s3cret");
  });
}, 150_000);
