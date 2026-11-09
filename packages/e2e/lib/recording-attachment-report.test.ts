import { describe, expect, it } from "vitest";
import {
  assertRecordingAttachmentReport,
  recordingAttachmentTitles,
} from "./recording-attachment-report.js";
const clauses = [
  "ended-only",
  "hidden-exclusion",
  "mutation-protocol",
  "retention",
  "derived-display",
  "approved-composition",
];
function report() {
  const specs = recordingAttachmentTitles.map((title, index) => ({
    title,
    tests: [
      {
        projectId: "recording-attachment",
        projectName: "recording-attachment",
        status: "expected",
        results: [
          {
            status: "passed",
            retry: 0,
            attachments: [
              {
                name: "recording-attachment",
                contentType: "application/json",
                body: Buffer.from(
                  JSON.stringify({
                    sourceHost: "academy",
                    caseKind:
                      index === 0 ? "raw" : index === 1 ? "edited" : undefined,
                    backgrounds: clauses.map((clause) => ({
                      clause,
                      evidence: [{ id: crypto.randomUUID() }],
                    })),
                  }),
                ).toString("base64"),
              },
            ],
          },
        ],
      },
    ],
  }));
  return {
    errors: [] as unknown[],
    suites: [
      { title: "An operator attaches a recording of an explicit kind", specs },
    ],
  };
}
function amend(
  value: ReturnType<typeof report>,
  override: Record<string, unknown>,
) {
  const attachment =
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!;
  const receipt = JSON.parse(
    Buffer.from(attachment.body, "base64").toString("utf8"),
  );
  attachment.body = Buffer.from(
    JSON.stringify({ ...receipt, ...override }),
  ).toString("base64");
}
describe("014 attachment receipts", () => {
  it("accepts exactly four cases, both original kinds and 24 Background groups", () => {
    expect(() => assertRecordingAttachmentReport(report())).not.toThrow();
  });
  it("rejects green labels without the executed Background receipt", () => {
    const value = report();
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments = [];
    expect(() => assertRecordingAttachmentReport(value)).toThrow(/Background/);
  });
  it("rejects an omitted, repeated, out-of-order or empty Background group", () => {
    for (const backgrounds of [
      [],
      clauses.slice(1).map((clause) => ({ clause, evidence: [1] })),
      clauses.map(() => ({ clause: "ended-only", evidence: [1] })),
      [...clauses].reverse().map((clause) => ({ clause, evidence: [1] })),
      clauses.map((clause) => ({ clause, evidence: [] })),
    ]) {
      const value = report();
      amend(value, { backgrounds });
      expect(() => assertRecordingAttachmentReport(value)).toThrow(
        /Background/,
      );
    }
  });
  it("rejects the wrong source host, duplicated kind or different outline", () => {
    for (const override of [{ sourceHost: "admin" }, { caseKind: "edited" }]) {
      const value = report();
      amend(value, override);
      expect(() => assertRecordingAttachmentReport(value)).toThrow();
    }
    const value = report();
    value.suites[0]!.title = "Different outline";
    expect(() => assertRecordingAttachmentReport(value)).toThrow(/identity/);
  });
  it("rejects skips, retries, runner errors, a missing case and a fifth case", () => {
    const skipped = report();
    skipped.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
    const retry = report();
    retry.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    const error = report();
    error.errors.push({ message: "runner error" });
    const missing = report();
    missing.suites[0]!.specs.pop();
    const extra = report();
    extra.suites[0]!.specs.push(extra.suites[0]!.specs[0]!);
    for (const value of [skipped, retry, error, missing, extra])
      expect(() => assertRecordingAttachmentReport(value)).toThrow();
  });
});
