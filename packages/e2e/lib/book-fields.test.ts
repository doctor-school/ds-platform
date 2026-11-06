import { afterEach, expect, it, vi } from "vitest";
import { assertOperationalReport } from "../api-probes/operational-report.js";
import { feedEntryTask, ownedFeedEntryDatabase } from "./feed-entry.js";
import { assertBookFieldsReport } from "./book-fields-report.js";
import { recordFormBackgrounds } from "./record-forms-report.js";
import { assertBookFieldProvenance } from "./book-fields-provenance.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { feedEntryRoot } from "./feed-entry.js";
import ordinary from "../playwright.config.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const outline =
  "Derived and internal fields never reach the operator interface";
const parents = [
  ".features-gen/book-fields/017-doctor-shell-specialties/017-scenarios.feature.spec.js",
  "A doctor arrives at their own storefront, picks a specialty, and the site becomes theirs",
  "Remaining storefront and operator scenarios",
];
const expected = [
  ...["list", "record", "create form"].map((surface, index) => ({
    title: `Example #${index + 1}`,
    suitePath: [...parents, outline],
    source: {
      file: "017-doctor-shell-specialties/017-scenarios.feature",
      line: 423,
      row: 431 + index,
      surface,
    },
  })),
  ...[
    "The page address is derived on create and frozen on first publish",
    "Status chips stay readable over the row hover state",
  ].map((title, index) => ({
    title,
    suitePath: parents,
    source: {
      file: "017-doctor-shell-specialties/017-scenarios.feature",
      line: index ? 443 : 436,
    },
  })),
];
function report() {
  const spec = (item: (typeof expected)[number]) => ({
    title: item.title,
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
                body: Buffer.from(
                  JSON.stringify({ backgrounds: recordFormBackgrounds }),
                ).toString("base64"),
              },
              {
                name: "public-book-fields",
                contentType: "application/json",
                body: Buffer.from(
                  JSON.stringify({ source: item.source }),
                ).toString("base64"),
              },
            ],
          },
        ],
      },
    ],
  });
  return {
    errors: [] as unknown[],
    suites: [
      {
        title: parents[0]!,
        suites: [
          {
            title: parents[1]!,
            suites: [
              {
                title: parents[2]!,
                specs: expected.slice(3).map(spec),
                suites: [
                  { title: outline, specs: expected.slice(0, 3).map(spec) },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

it("EARS-18: the new owned task selects five actual cases from three originals", async () => {
  vi.stubEnv("E2E_PUBLIC_BOOK_FIELDS", "1");
  vi.stubEnv("E2E_FEED_ENTRY_BOOT", "0");
  expect(feedEntryTask()).toBe(3804);
  expect(
    ownedFeedEntryDatabase("postgres://ds:secret@localhost/ds_dev_3804"),
  ).toContain("ds_dev_3804");
  const { default: config } = await import("../feed-entry.config.js");
  for (const item of expected) {
    expect(
      (config.grep as RegExp).test(
        `doctor file ${item.suitePath.join(" ")} ${item.title} @host:doctor @EARS-18 @happy`,
      ),
    ).toBe(true);
    expect(
      (ordinary.grepInvert as RegExp).test(
        `${item.suitePath.join(" ")} ${item.title}`,
      ),
    ).toBe(true);
  }
  expect(
    (config.grep as RegExp).test(
      "doctor Unrelated outline Example #1 @host:doctor",
    ),
  ).toBe(false);
});

it("EARS-18: each actual Example proves its canonical source row and surface plus six typed Background groups", () => {
  expect(() => assertBookFieldsReport(report())).not.toThrow();
  type Attachment = { name: string; contentType: string; body: string };
  for (const mutate of [
    (items: Attachment[]) => {
      items[1]!.body = Buffer.from(
        JSON.stringify({ source: { ...expected[0]!.source, row: 432 } }),
      ).toString("base64");
    },
    (items: Attachment[]) => {
      items[1]!.body = Buffer.from(
        JSON.stringify({
          source: { ...expected[0]!.source, surface: "record" },
        }),
      ).toString("base64");
    },
    (items: Attachment[]) => {
      items[0]!.contentType = "text/plain";
    },
    (items: Attachment[]) => {
      items[0]!.body = Buffer.from(
        JSON.stringify({ backgrounds: recordFormBackgrounds.slice(1) }),
      ).toString("base64");
    },
    (items: Attachment[]) => {
      items.push(items[0]!);
    },
  ]) {
    const value = report();
    mutate(
      value.suites[0]!.suites[0]!.suites[0]!.suites[0]!.specs[0]!.tests[0]!
        .results[0]!.attachments,
    );
    expect(() => assertBookFieldsReport(value)).toThrow();
  }
});

it("EARS-18: rendered JSX and mounted imports, rather than comments or API-only members, establish hidden-field provenance", () => {
  const path = "apps/admin/app/directions/page.tsx",
    source = readFileSync(resolve(feedEntryRoot, path), "utf8");
  expect(() => assertBookFieldProvenance(path, source)).not.toThrow();
  for (const broken of [
    source.replace("{row.title}", "{row.slug}"),
    source.replace('"@/components/status-chip"', '"./fake"'),
    source.replace("<StatusChip ", "<FakeChip "),
  ])
    expect(() => assertBookFieldProvenance(path, broken)).toThrow();
});

it("EARS-18: a full parent suite and leaf identify each Outline row without weakening legacy title receipts", () => {
  expect(() =>
    assertOperationalReport(report(), expected, "doctor"),
  ).not.toThrow();
  for (const mutate of [
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.suites[0]!.specs.pop();
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.suites[0]!.specs.push(
        r.suites[0]!.suites[0]!.suites[0]!.suites[0]!.specs[0]!,
      );
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.suites[0]!.title = "Wrong Outline";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.title = "Wrong Feature";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.specs[0]!.tests[0]!.projectName =
        "academy";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.specs[0]!.tests[0]!.status = "flaky";
    },
    (r: ReturnType<typeof report>) => {
      r.suites[0]!.suites[0]!.suites[0]!.specs[0]!.tests[0]!.results[0]!.status =
        "skipped";
    },
    (r: ReturnType<typeof report>) => {
      r.errors.push({ message: "runner error" });
    },
  ]) {
    const value = report();
    mutate(value);
    expect(() => assertOperationalReport(value, expected, "doctor")).toThrow();
  }
});
