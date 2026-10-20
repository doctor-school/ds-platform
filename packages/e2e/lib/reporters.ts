import path from "node:path";
import { fileURLToPath } from "node:url";

/** Playwright's `[name, options?]` reporter tuple — the config casts the list. */
export type ReporterEntry = [string] | [string, Record<string, unknown>];

/**
 * The public console reporter — ABSOLUTE, so any config that uses this selection
 * (the suite's, the reporter test's fixture config) resolves the same file.
 */
export const SUMMARY_REPORTER = fileURLToPath(
  new URL("../reporters/summary.ts", import.meta.url),
);

/**
 * The suite's reporter list (`playwright.config.ts`).
 *
 * `publicLog` (`E2E_PUBLIC_LOG=1`, set only by the stage workflow, #2985) swaps the
 * console reporter `list` — which prints error messages, test output and URLs —
 * for `reporters/summary.ts`, and keeps `json` + `html` writing ONLY into
 * `E2E_REPORT_DIR`. A public run without a report dir would leave its evidence in
 * the runner's `test-results/`, so it is refused rather than silently kept.
 * Without the flag the local behaviour is unchanged.
 */
export function reportersFor({
  publicLog,
  reportDir,
}: {
  publicLog: boolean;
  reportDir: string | undefined;
}): ReporterEntry[] {
  if (publicLog && !reportDir) {
    throw new Error(
      "E2E_PUBLIC_LOG=1 requires E2E_REPORT_DIR — the full report must land in the report dir, never in the public log.",
    );
  }
  const jsonReport = reportDir
    ? path.join(reportDir, "results.json")
    : "test-results/results.json";
  return [
    publicLog ? [SUMMARY_REPORTER] : ["list"],
    ["json", { outputFile: jsonReport }],
    ...(reportDir
      ? [
          [
            "html",
            { outputFolder: path.join(reportDir, "html"), open: "never" },
          ] as ReporterEntry,
        ]
      : []),
  ];
}

/** `E2E_PUBLIC_LOG` is on only for the literal `1`, like `CI`-style flags elsewhere. */
export function publicLogEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.E2E_PUBLIC_LOG === "1";
}
