import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";

/**
 * The PUBLIC console reporter (release-pipeline-off-workstation spec §4, #2985).
 *
 * The stage suite runs in GitHub Actions, whose logs are public on this
 * repository. Playwright's own console reporters (`list`, `line`, `dot`) print a
 * failure's error message, the test's stdout/stderr and attachment paths — any of
 * which can carry a response body, a stage URL or a credential a step echoed. This
 * reporter prints ONE line per finished test and a count line at the end, and
 * NOTHING else: no error text, no test output, no attachment, no URL. The full
 * evidence (HTML + JSON) is written by the `json`/`html` reporters into
 * `E2E_REPORT_DIR` only, which the workflow ships to the box, never to Actions.
 *
 * Selected by `E2E_PUBLIC_LOG=1` (`lib/reporters.ts`); without the flag the local
 * console reporter stays `list`.
 */

/** Any `scheme://…` run inside a title is replaced, so no URL reaches the log. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

export function redactTitle(title: string): string {
  return title.replace(URL_RE, "<url>");
}

export type SummaryLine = {
  project: string;
  titlePath: string[];
  status: TestResult["status"];
  durationMs: number;
  retry: number;
};

/**
 * `<status> [<project>] <describe › … › title> (<ms> ms, retry <n>)`. Only the
 * fields named here exist in the output — the format has no slot for anything
 * else, which is the whole guarantee.
 */
export function formatSummaryLine(line: SummaryLine): string {
  const title = line.titlePath.map(redactTitle).join(" › ");
  return `${line.status.padEnd(11)} [${line.project}] ${title} (${Math.round(line.durationMs)} ms, retry ${line.retry})`;
}

/** `titlePath()` is `['', project, file, ...describes, title]`. */
export function summaryLineFor(
  test: TestCase,
  result: TestResult,
): SummaryLine {
  const [, project = "", , ...titlePath] = test.titlePath();
  return {
    project,
    titlePath,
    status: result.status,
    durationMs: result.duration,
    retry: result.retry,
  };
}

export type SummaryCounts = Record<TestResult["status"], number>;

export function formatCounts(counts: SummaryCounts, status: string): string {
  return (
    `summary: ${counts.passed} passed, ${counts.failed} failed, ` +
    `${counts.timedOut} timed out, ${counts.interrupted} interrupted, ` +
    `${counts.skipped} skipped — run ${status}`
  );
}

export default class SummaryReporter implements Reporter {
  private readonly write: (line: string) => void;
  private readonly counts: SummaryCounts = {
    passed: 0,
    failed: 0,
    timedOut: 0,
    skipped: 0,
    interrupted: 0,
  };
  private globalErrors = 0;

  constructor(options: { write?: (line: string) => void } = {}) {
    this.write = options.write ?? ((line) => process.stdout.write(`${line}\n`));
  }

  /** `true`, or Playwright prepends its own `line`/`dot` reporter, which prints errors. */
  printsToStdio(): boolean {
    return true;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.counts[result.status] += 1;
    this.write(formatSummaryLine(summaryLineFor(test, result)));
  }

  /** A global error (config, worker crash) is COUNTED; its message stays in the report. */
  onError(_error: TestError): void {
    this.globalErrors += 1;
    this.write("global error: details are in the run's HTML/JSON report");
  }

  onEnd(result: FullResult): void {
    this.write(formatCounts(this.counts, result.status));
    if (this.globalErrors > 0) {
      this.write(`global errors: ${this.globalErrors}`);
    }
  }
}
