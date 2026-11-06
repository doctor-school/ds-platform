import { describe, expect, it } from "vitest";
import ordinaryConfig from "../playwright.config.js";
import { publicFeedStateTitles } from "./host-tags.js";
import {
  assertFeedEntryProcessIdentity,
  ownedFeedEntryDatabase,
} from "./feed-entry.js";
import {
  publicReadonlyOriginals,
  publicReadonlyPattern,
  publicReadonlyPatternFor,
  assertPublicReadonlyReport,
} from "./public-readonly-originals.js";

describe("public read-only original selection", () => {
  it("EARS-12: selects exactly the three original identities on their canonical hosts", () => {
    expect(publicReadonlyOriginals).toEqual([
      {
        host: "academy",
        title: "A mixed week list groups each event under the day it shows",
      },
      {
        host: "doctor",
        title: "The feed carries no Academy crossing of its own",
      },
      {
        host: "doctor",
        title: "The closed Минздрав book is visible but never editable",
      },
    ]);
    for (const { host, title } of publicReadonlyOriginals) {
      const full = `${host} feature ${title} @host:${host} @EARS-12 @happy`;
      expect(publicReadonlyPattern.test(full)).toBe(true);
      expect(publicReadonlyPatternFor(host).test(full)).toBe(true);
      expect(
        publicReadonlyPatternFor(host === "doctor" ? "academy" : "doctor").test(
          full,
        ),
      ).toBe(false);
      expect(
        publicReadonlyPattern.test(full.replace(title, title + " extended")),
      ).toBe(false);
    }
    expect(
      publicReadonlyPattern.test(
        "doctor An offline meet-up is a format of the event card @host:doctor",
      ),
    ).toBe(false);
    expect(
      publicReadonlyPattern.test(
        "academy The month read rejects an unknown timezone @host:academy",
      ),
    ).toBe(false);
  });
  it("EARS-19: ordinary runs exclude every owned-fixture original while retaining the old exclusions", () => {
    const invert = ordinaryConfig.grepInvert as RegExp;
    for (const { host, title } of publicReadonlyOriginals)
      expect(invert.test(`${host} ${title} @host:${host}`), title).toBe(true);
    for (const title of publicFeedStateTitles)
      expect(invert.test(`doctor ${title} @host:doctor`), title).toBe(true);
    expect(
      invert.test("doctor A harmless unrelated public scenario @host:doctor"),
    ).toBe(false);
  });
  it("EARS-19: accepts owned Linux Academy/Admin Next listeners and refuses a foreign cwd", () => {
    for (const name of ["portal", "admin"] as const) {
      const identity = {
        name,
        platform: "linux" as const,
        root: "/task",
        command: "next-server (v16.3.0)",
        cwd: `/task/apps/${name}`,
        executable: "/usr/bin/node",
        nodeExecutable: "/usr/bin/node",
      };
      expect(() => assertFeedEntryProcessIdentity(identity)).not.toThrow();
      expect(() =>
        assertFeedEntryProcessIdentity({
          ...identity,
          cwd: "/foreign/apps/admin",
        }),
      ).toThrow(/cwd/);
    }
    expect(
      ownedFeedEntryDatabase(
        "postgres://ds:secret@localhost/ds_dev_3785",
        3785,
      ),
    ).toContain("/ds_dev_3785");
    expect(() =>
      ownedFeedEntryDatabase("postgres://ds:secret@localhost/ds_dev", 3785),
    ).toThrow();
  });
  it("EARS-19: requires every original exactly once on its own host with no nonpass results", () => {
    const passed = () => ({
      errors: [] as unknown[],
      suites: [
        {
          specs: publicReadonlyOriginals.map(({ title, host }) => ({
            title: `${title} @host:${host}`,
            tests: [
              {
                projectName: host as string,
                projectId: host as string,
                status: "expected",
                results: [{ status: "passed", retry: 0 }],
              },
            ],
          })),
        },
      ],
    });
    expect(() => assertPublicReadonlyReport(passed())).not.toThrow();
    for (const mutate of [
      (report: ReturnType<typeof passed>) => {
        report.suites[0]!.specs.pop();
      },
      (report: ReturnType<typeof passed>) => {
        report.suites[0]!.specs.push(report.suites[0]!.specs[0]!);
      },
      (report: ReturnType<typeof passed>) => {
        report.suites[0]!.specs[0]!.tests[0]!.projectName = "doctor";
      },
      (report: ReturnType<typeof passed>) => {
        report.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped";
      },
      (report: ReturnType<typeof passed>) => {
        report.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
      },
      (report: ReturnType<typeof passed>) => {
        report.errors.push({ message: "runner failed" });
      },
    ]) {
      const report = passed();
      mutate(report);
      expect(() => assertPublicReadonlyReport(report)).toThrow();
    }
  });
});
