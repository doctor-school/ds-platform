import { describe, expect, it } from "vitest";
import {
  assertRecordingAttachmentReport as assertRawReport,
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
  const titles = [
    ...recordingAttachmentTitles,
    "Publication is a separate act from attachment",
    "Example #1",
    "Example #2",
    "Example #3",
    "Example #4",
    "Every committed recording mutation is audited",
  ];
  const specs = titles.map((title, index) => ({
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
                    caseState:
                      index >= 5 && index <= 8
                        ? ["draft", "published", "live", "hidden"][index - 5]
                        : undefined,
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
      {
        title: "An operator attaches a recording of an explicit kind",
        specs: specs.slice(0, 2),
      },
      {
        title: "Recording lifecycle, playback and remaining archive contracts",
        specs: specs.slice(2, 5),
      },
      {
        title: "A recording is publishable only while the event is ended",
        specs: specs.slice(5, 9),
      },
      {
        title: "Recording lifecycle, playback and remaining archive contracts",
        specs: specs.slice(9),
      },
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
function assertRecordingAttachmentReport(
  value: ReturnType<typeof report>,
  scope: "full" | "new" = "full",
) {
  return assertRawReport(
    {
      ...value,
      suites: [
        {
          title:
            "A finished broadcast keeps its value as a recording, and the archive is browsable",
          suites: [
            {
              title:
                "Recording lifecycle, playback and remaining archive contracts",
              specs: value.suites
                .filter(
                  (s) =>
                    s.title ===
                    "Recording lifecycle, playback and remaining archive contracts",
                )
                .flatMap((s) => s.specs),
              suites: value.suites.filter(
                (s) =>
                  s.title !==
                  "Recording lifecycle, playback and remaining archive contracts",
              ),
            },
          ],
        },
      ],
    },
    scope,
  );
}
describe("014 attachment receipts", () => {
  it("accepts only the six new cases with an explicit narrow scope", () => {
    const value = report();
    value.suites[0]!.specs = [];
    value.suites[1]!.specs = value.suites[1]!.specs.slice(2);
    expect(() => assertRecordingAttachmentReport(value, "new")).not.toThrow();
    expect(() => assertRecordingAttachmentReport(value)).toThrow();
    expect(() => assertRecordingAttachmentReport(report(), "new")).toThrow();
  });
  it("rejects identical example titles moved into the other source outline", () => {
    const value = report();
    value.suites[0]!.specs[0] = value.suites[2]!.specs[0]!;
    expect(() => assertRecordingAttachmentReport(value)).toThrow(/identity/);
    const wrongRule = report();
    wrongRule.suites[1]!.title = "Another rule";
    expect(() => assertRecordingAttachmentReport(wrongRule)).toThrow(
      /identity/,
    );
  });
  it("accepts exactly ten cases, both outlines and 60 Background groups", () => {
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
  it("rejects skips, retries, runner errors, a missing case and an extra case", () => {
    const skipped = report();
    skipped.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
    const retry = report();
    retry.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    const error = report();
    error.errors.push({ message: "runner error" });
    const missing = report();
    missing.suites[2]!.specs.pop();
    const extra = report();
    extra.suites[0]!.specs.push(extra.suites[0]!.specs[0]!);
    for (const value of [skipped, retry, error, missing, extra])
      expect(() => assertRecordingAttachmentReport(value)).toThrow();
  });
});

// The guard must distinguish equal Example titles by their source outline.
it("rejects a non-ended outline example with another state identity", () => {
  const value = report();
  const attachment =
    value.suites[2]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!;
  const receipt = JSON.parse(
    Buffer.from(attachment.body, "base64").toString("utf8"),
  );
  attachment.body = Buffer.from(
    JSON.stringify({ ...receipt, caseState: "ended" }),
  ).toString("base64");
  expect(() => assertRecordingAttachmentReport(value)).toThrow(/identity/);
});
it("rejects flaky, failed, duplicate results and the wrong project", () => {
  for (const change of [
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.status = "flaky";
    },
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.results[0]!.status = "failed";
    },
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.results.push(t.results[0]!);
    },
    (
      t: ReturnType<
        typeof report
      >["suites"][number]["specs"][number]["tests"][number],
    ) => {
      t.projectName = "chromium";
    },
  ]) {
    const value = report();
    change(value.suites[2]!.specs[0]!.tests[0]!);
    expect(() => assertRecordingAttachmentReport(value)).toThrow();
  }
});
