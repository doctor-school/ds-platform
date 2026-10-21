import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  publicLogEnabled,
  reportersFor,
  SUMMARY_REPORTER,
} from "./reporters.js";

/** The reporter selection `playwright.config.ts` uses (#2985). */
describe("reportersFor", () => {
  it("E2E_PUBLIC_LOG=1 selects the summary reporter and drops `list`", () => {
    const reporters = reportersFor({
      publicLog: publicLogEnabled({ E2E_PUBLIC_LOG: "1" }),
      reportDir: "/tmp/run",
    });
    const names = reporters.map(([name]) => name);
    expect(names).toEqual([SUMMARY_REPORTER, "json", "html"]);
    expect(names).not.toContain("list");
    expect(SUMMARY_REPORTER).toMatch(/reporters[\\/]summary\.ts$/);
    expect(reporters[1]?.[1]).toEqual({
      outputFile: path.join("/tmp/run", "results.json"),
    });
    expect(reporters[2]?.[1]).toEqual({
      outputFolder: path.join("/tmp/run", "html"),
      open: "never",
    });
  });

  it("without the flag keeps the local `list` + json (+ html with a report dir)", () => {
    expect(publicLogEnabled({})).toBe(false);
    expect(reportersFor({ publicLog: false, reportDir: undefined })).toEqual([
      ["list"],
      ["json", { outputFile: "test-results/results.json" }],
    ]);
    expect(
      reportersFor({ publicLog: false, reportDir: "/tmp/run" }).map(([n]) => n),
    ).toEqual(["list", "json", "html"]);
  });

  it("refuses a public run with no report dir — the evidence would stay on the runner", () => {
    expect(() =>
      reportersFor({ publicLog: true, reportDir: undefined }),
    ).toThrow(/E2E_REPORT_DIR/);
  });

  it("is the selection the suite config actually uses", () => {
    const config = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "playwright.config.ts",
      ),
      "utf8",
    );
    expect(config).toMatch(
      /reporter: reportersFor\(\{\s*publicLog: publicLogEnabled\(process\.env\),\s*reportDir,\s*\}\)/,
    );
  });
});
