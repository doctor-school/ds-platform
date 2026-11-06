import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import ordinaryConfig from "../playwright.config.js";
import {
  assertRecordFormComposition,
  feedEntryRoot,
  feedEntryTask,
  ownedFeedEntryDatabase,
} from "./feed-entry.js";
import {
  publicRecordFormPattern,
  publicRecordFormTitles,
} from "./host-tags.js";
import { assertRecordFormsReport } from "./record-forms-report.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("EARS-18: the dedicated runner selects the three on Doctor and CI preserves all four earlier task arms", async () => {
  vi.stubEnv("E2E_PUBLIC_RECORD_FORMS", "1");
  vi.stubEnv("E2E_FEED_ENTRY_BOOT", "0");
  vi.resetModules();
  const { default: config } = await import("../feed-entry.config.js");
  expect(config.projects!.map((project) => project.name)).toEqual(["doctor"]);
  expect(config.retries).toBe(0);
  for (const title of publicRecordFormTitles)
    expect((config.grep as RegExp).test(title)).toBe(true);
  const workflow = parse(
    readFileSync(
      resolve(feedEntryRoot, ".github/workflows/public-feed-entry.yml"),
      "utf8",
    ),
  );
  expect(workflow.jobs["public-feed-entry"].strategy.matrix.task).toEqual([
    3751, 3772, 3785, 3789, 3797, 3826,
  ]);
});

it("EARS-18: selects exactly the three record originals and excludes them from ordinary runs", () => {
  expect(publicRecordFormTitles).toEqual([
    "A single-tab record page renders no tab bar",
    "The adjacency kind is a closed explained vocabulary",
    "A record form is one framed panel of ruled sections",
  ]);
  for (const title of publicRecordFormTitles) {
    expect(
      publicRecordFormPattern.test(`doctor ${title} @host:doctor @EARS-18`),
    ).toBe(true);
    expect((ordinaryConfig.grepInvert as RegExp).test(title)).toBe(true);
    expect(publicRecordFormPattern.test(title + " extra")).toBe(false);
  }
  expect(
    publicRecordFormPattern.test("The link surface is named after the link"),
  ).toBe(false);
  vi.stubEnv("E2E_PUBLIC_RECORD_FORMS", "1");
  expect(feedEntryTask()).toBe(3797);
  for (const kind of ["dev", "probe"])
    expect(
      ownedFeedEntryDatabase(
        `postgres://ds:secret@localhost/ds_${kind}_3797`,
        3797,
      ),
    ).toContain(`ds_${kind}_3797`);
  for (const name of ["ds_dev", "ds_dev_37970", "ds_dev_3789", "production"])
    expect(() =>
      ownedFeedEntryDatabase(`postgres://ds:secret@localhost/${name}`, 3797),
    ).toThrow("dedicated #3797");
});

const backgrounds = [
  "storefront and shared design system",
  "closed Ministry book plus Other",
  "managed links and adjacency",
  "anonymous readable home",
  "no financing or commerce",
  "vendored composition and shell provenance",
];
const report = () => ({
  errors: [],
  suites: [
    {
      specs: publicRecordFormTitles.map((title) => ({
        title,
        tests: [
          {
            projectName: "doctor",
            projectId: "doctor",
            status: "expected",
            results: [
              {
                status: "passed",
                retry: 0,
                attachments: [
                  {
                    name: "public-feed-entry",
                    contentType: "application/json",
                    body: Buffer.from(JSON.stringify({ backgrounds })).toString(
                      "base64",
                    ),
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

it("EARS-18: requires three actual Doctor passes and all eighteen distinct completed Background groups", () => {
  expect(() => assertRecordFormsReport(report())).not.toThrow();
  for (const mutate of [
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!.contentType =
        "text/plain";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs.pop();
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs.push(r.suites[0]!.specs[0]!);
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.specs[0]!.tests[0]!.projectName = "academy";
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
          JSON.stringify({ backgrounds: Array(6).fill(backgrounds[0]) }),
        ).toString("base64");
    },
  ]) {
    const value = report();
    mutate(value);
    expect(() => assertRecordFormsReport(value)).toThrow();
  }
});

it("EARS-18: owning Field imports must be mounted in the returned form rather than local layout or dead imports", () => {
  const source = readFileSync(
    resolve(
      feedEntryRoot,
      "apps/admin/components/direction-adjacency-form.tsx",
    ),
    "utf8",
  );
  expect(() => assertRecordFormComposition(source)).not.toThrow();
  for (const broken of [
    source.replace('"@ds/design-system/blocks"', '"./fake"'),
    source
      .replaceAll("FormSection", "LocalSection")
      .replace("  LocalSection,", "  FormSection,"),
    source
      .replace('<FormFieldGroup columns="two">', "<div>")
      .replace("</FormFieldGroup>", "</div>"),
    source.replace("<Form {...form}>", "<div>").replace("</Form>", "</div>"),
    source.replace(
      "  const t =",
      "  const FormSection = () => <fieldset />;\n  const t =",
    ),
    source
      .replace("<FormActions>", "<div>")
      .replace("</FormActions>", "</div>"),
  ])
    expect(() => assertRecordFormComposition(broken)).toThrow();
});
