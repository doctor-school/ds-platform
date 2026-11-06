import { afterEach, expect, it, vi } from "vitest";
import ordinaryConfig from "../playwright.config.js";
import {
  publicSpecialtyMemoryTitles,
  publicSpecialtyMemoryPattern,
} from "./host-tags.js";
import { feedEntryTask, ownedFeedEntryDatabase } from "./feed-entry.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";

afterEach(() => vi.unstubAllEnvs());

it("EARS-7: selects only the frozen Doctor memory/link originals and excludes them from ordinary runs", () => {
  expect(publicSpecialtyMemoryTitles).toEqual([
    "The home collapses the catalog to the remembered specialty",
    "Re-choosing opens the newly chosen specialty's feed without a save step",
    "The link surface is named after the link",
  ]);
  for (const title of publicSpecialtyMemoryTitles) {
    const full = `doctor feature ${title} @host:doctor @EARS-7 @happy`;
    expect(publicSpecialtyMemoryPattern.test(full)).toBe(true);
    expect((ordinaryConfig.grepInvert as RegExp).test(full)).toBe(true);
    expect(
      publicSpecialtyMemoryPattern.test(full.replace(title, title + " extra")),
    ).toBe(false);
  }
  expect(
    publicSpecialtyMemoryPattern.test(
      "doctor A choice opens the chosen specialty's feed @host:doctor",
    ),
  ).toBe(false);
});

it("EARS-7: routes the new contour to its own exact database without changing earlier tasks", () => {
  vi.stubEnv("E2E_PUBLIC_SPECIALTY_MEMORY", "1");
  expect(feedEntryTask()).toBe(3789);
  expect(
    ownedFeedEntryDatabase("postgres://ds:secret@localhost/ds_dev_3789"),
  ).toContain("/ds_dev_3789");
  for (const name of ["ds_dev", "ds_dev_3785", "ds_dev_37890", "production"])
    expect(() =>
      ownedFeedEntryDatabase(`postgres://ds:secret@localhost/${name}`),
    ).toThrow();
});

it("EARS-16: requires the exact three once on Doctor and rejects extras, wrong hosts and every nonpass result", () => {
  const passed = () => ({
    errors: [] as unknown[],
    suites: [
      {
        specs: publicSpecialtyMemoryTitles.map((title) => ({
          title: `${title} @host:doctor`,
          tests: [
            {
              projectName: "doctor",
              projectId: "doctor",
              status: "expected",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        })),
      },
    ],
  });
  const check = (value: unknown) =>
    assertOperationalReport(value, publicSpecialtyMemoryTitles, "doctor");
  expect(() => check(passed())).not.toThrow();
  for (const mutate of [
    (r: ReturnType<typeof passed>) => {
      r.suites[0]!.specs.pop();
    },
    (r: ReturnType<typeof passed>) => {
      r.suites[0]!.specs.push(r.suites[0]!.specs[0]!);
    },
    (r: ReturnType<typeof passed>) => {
      r.suites[0]!.specs[0]!.tests[0]!.projectName = "academy";
    },
    (r: ReturnType<typeof passed>) => {
      r.suites[0]!.specs[0]!.tests[0]!.status = "flaky";
    },
    (r: ReturnType<typeof passed>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
    },
    (r: ReturnType<typeof passed>) => {
      r.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    },
    (r: ReturnType<typeof passed>) => {
      r.errors.push({ message: "runner failed" });
    },
  ]) {
    const value = passed();
    mutate(value);
    expect(() => check(value)).toThrow();
  }
});
