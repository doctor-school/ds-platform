import { describe, expect, it } from "vitest";
import { assertOperationalReport } from "../api-probes/operational-report.js";
import {
  publicFeedStateTitles,
  publicFeedStatePattern,
} from "./host-tags.js";
import { ownedFeedEntryDatabase } from "./feed-entry.js";

describe("018 dedicated public feed states", () => {
  it("EARS-1: confines fixtures to the exact owned database", () => {
    expect(
      ownedFeedEntryDatabase(
        "postgres://ds:secret@localhost/ds_dev_3772",
        3772,
      ),
    ).toContain("/ds_dev_3772");
    for (const name of ["ds_dev", "ds_dev_3751", "ds_dev_37720", "production"])
      expect(() =>
        ownedFeedEntryDatabase(`postgres://ds:secret@localhost/${name}`, 3772),
      ).toThrow();
  });
  it("EARS-1: selects only the frozen three titles including their inherited Doctor tags", () => {
    for (const title of publicFeedStateTitles) {
      expect(
        publicFeedStatePattern.test(
          `doctor feature ${title} @host:doctor @EARS-4 @happy`,
        ),
      ).toBe(true);
      expect(
        publicFeedStatePattern.test(
          `doctor feature ${title} extended @host:doctor`,
        ),
      ).toBe(false);
    }
    expect(
      publicFeedStatePattern.test(
        "doctor A choice opens the chosen specialty's feed @host:doctor @public-feed-entry",
      ),
    ).toBe(false);
  });
  it("EARS-4: accepts each Doctor original once and rejects every nonpass or identity drift", () => {
    const passed = () => ({
      suites: [
        {
          specs: publicFeedStateTitles.map((title) => ({
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
      errors: [] as unknown[],
    });
    const assert = (value: unknown) =>
      assertOperationalReport(value, publicFeedStateTitles, "doctor");
    expect(() => assert(passed())).not.toThrow();
    for (const mutate of [
      (r: ReturnType<typeof passed>) => {
        r.suites[0]!.specs.pop();
      },
      (r: ReturnType<typeof passed>) => {
        r.suites[0]!.specs.push(r.suites[0]!.specs[0]!);
      },
      (r: ReturnType<typeof passed>) => {
        r.suites[0]!.specs[0]!.title = "wrong";
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
        r.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "failed";
      },
      (r: ReturnType<typeof passed>) => {
        r.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
      },
      (r: ReturnType<typeof passed>) => {
        r.errors.push({ message: "runtime failure" });
      },
    ]) {
      const value = passed();
      mutate(value);
      expect(() => assert(value)).toThrow();
    }
  });
});
