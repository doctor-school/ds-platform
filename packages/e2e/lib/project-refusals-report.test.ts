import { expect, it } from "vitest";
import { publicProjectRefusalTitles } from "./host-tags.js";
import { assertProjectRefusalsReport } from "./project-refusals-report.js";

const background = () => [
  {
    group: "active output kinds",
    ids: ["school", "congress", "club", "podcast"],
  },
  { group: "Фарма Плюс — Инвестор", ids: ["pharma", "investor"] },
  { group: "ЦИТО — Клиническая площадка", ids: ["cito", "clinical"] },
];
const report = () => ({
  errors: [],
  suites: [
    {
      specs: publicProjectRefusalTitles.map((title) => ({
        title,
        tests: [
          {
            projectName: "academy",
            projectId: "academy",
            status: "expected",
            results: [
              {
                status: "passed",
                retry: 0,
                attachments: [
                  {
                    name: "project-refusals",
                    contentType: "application/json",
                    body: Buffer.from(
                      JSON.stringify({ backgrounds: background() }),
                    ).toString("base64"),
                  },
                ],
              },
            ],
          },
        ],
      })),
    },
  ],
});

it("EARS-19: requires exact three Academy identities and nine distinct actual Background groups", () => {
  expect(() => assertProjectRefusalsReport(report())).not.toThrow();
  for (const mutate of [
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs.pop();
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs.push(r.suites[0]!.specs[0]!);
    },
    (r: ReturnType<typeof report>) => {
      r.errors.push("runner error" as never);
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.projectId = "doctor";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments = [];
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!.body =
        Buffer.from(
          JSON.stringify({ backgrounds: Array(3).fill(background()[0]) }),
        ).toString("base64");
    },
    (r: ReturnType<typeof report>) => {
      const backgrounds = background();
      backgrounds[1]!.ids = [];
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!.body =
        Buffer.from(JSON.stringify({ backgrounds })).toString("base64");
    },
  ]) {
    const value = report();
    mutate(value);
    expect(() => assertProjectRefusalsReport(value)).toThrow();
  }
});
