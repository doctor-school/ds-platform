import { describe, expect, it } from "vitest";
import {
  assertOperationalReport,
  operationalOriginals,
} from "../api-probes/operational-report.js";
import { ownedFeedEntryDatabase } from "./feed-entry.js";

describe("017 public feed-entry receipt", () => {
  it("EARS-1: confines managed preconditions to the task database", () => {
    expect(
      ownedFeedEntryDatabase("postgres://ds:secret@localhost/ds_dev_3751"),
    ).toContain("/ds_dev_3751");
    expect(
      ownedFeedEntryDatabase("postgres://ds:secret@localhost/ds_probe_3751"),
    ).toContain("/ds_probe_3751");
    for (const name of ["ds_dev", "ds_dev_37510", "ds_dev_3702", "production"])
      expect(() =>
        ownedFeedEntryDatabase(`postgres://ds:secret@localhost/${name}`),
      ).toThrow("dedicated #3751");
  });
  it("EARS-6: requires all three entry originals once and refuses a fourth or a skipped entry", () => {
    const titles = operationalOriginals.feedEntry;
    expect(titles).toEqual([
      "A choice opens the chosen specialty's feed",
      "«Моя лента» opens the remembered specialty's feed",
      "«Моя лента» with nothing chosen opens the home specialty catalog, never an empty feed",
    ]);
    const passed = (title: string) => ({
      title,
      tests: [
        { status: "expected", results: [{ status: "passed", retry: 0 }] },
      ],
    });
    const report = (specs: unknown[]) => ({ suites: [{ specs }], errors: [] });
    expect(() =>
      assertOperationalReport(report(titles.map(passed)), titles),
    ).not.toThrow();
    expect(() =>
      assertOperationalReport(report(titles.slice(0, 2).map(passed)), titles),
    ).toThrow("identity mismatch");
    expect(() =>
      assertOperationalReport(
        report([...titles.map(passed), passed("fourth")]),
        titles,
      ),
    ).toThrow("identity mismatch");
    expect(() =>
      assertOperationalReport(
        report(
          titles.map((title, i) =>
            i
              ? passed(title)
              : { title, tests: [{ status: "skipped", results: [] }] },
          ),
        ),
        titles,
      ),
    ).toThrow("no skip");
  });
});
