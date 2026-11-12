import { describe, expect, it } from "vitest";
import {
  assertCongressBackgrounds,
  congressOriginals,
  congressBackgrounds,
  congressRepeatOriginals,
  assertCongressRepeatBackgrounds,
  assertCongressRepeatReport,
  assertCongressReport,
  congressIntakeOriginals,
  assertCongressIntakeReport,
  assertCongressIntakeBackgrounds,
} from "./congress-originals-report.js";

describe("044 exact-three Background evidence", () => {
  const rows = () =>
    congressOriginals.flatMap((title) =>
      congressBackgrounds.map((clause) =>
        JSON.stringify({
          title,
          clause,
          eventId: "owned-event",
          verified: true,
        }),
      ),
    );
  it("EARS-28: accepts exactly six ordered post-assertion receipts per original", () => {
    expect(() => assertCongressBackgrounds(rows().join("\n"))).not.toThrow();
  });
  it.each([
    "missing",
    "duplicate",
    "unordered",
    "unverified",
    "extra",
    "wrong identity",
  ])("EARS-28: refuses %s Background evidence", (kind) => {
    const entries = rows();
    if (kind === "missing") entries.pop();
    if (kind === "duplicate") entries.push(entries[0]!);
    if (kind === "unordered")
      [entries[0], entries[1]] = [entries[1]!, entries[0]!];
    if (kind === "unverified")
      entries[0] = entries[0]!.replace('"verified":true', '"verified":false');
    if (kind === "extra")
      entries.push(
        JSON.stringify({
          title: "fourth",
          clause: congressBackgrounds[0],
          eventId: "owned-event",
          verified: true,
        }),
      );
    if (kind === "wrong identity")
      entries[1] = entries[1]!.replace("owned-event", "foreign-event");
    expect(() => assertCongressBackgrounds(entries.join("\n"))).toThrow();
  });
});

describe("044 intake exact-three identity", () => {
  const report = (titles: readonly string[]) => ({
    errors: [],
    suites: [
      {
        specs: titles.map((title) => ({
          title,
          tests: [
            {
              projectName: "admin",
              projectId: "admin",
              status: "expected",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        })),
      },
    ],
  });
  const receipts = () =>
    congressIntakeOriginals
      .flatMap((title) =>
        congressBackgrounds.map((clause) =>
          JSON.stringify({ title, clause, eventId: "owned", verified: true }),
        ),
      )
      .join("\n");
  it("EARS-1: accepts only the new, mail-failure and participant-throttling originals", () => {
    expect(() =>
      assertCongressIntakeReport(report(congressIntakeOriginals)),
    ).not.toThrow();
    expect(() => assertCongressIntakeBackgrounds(receipts())).not.toThrow();
    for (const prior of [congressOriginals, congressRepeatOriginals])
      expect(() => assertCongressIntakeReport(report(prior))).toThrow();
    expect(() =>
      assertCongressReport(report(congressIntakeOriginals)),
    ).toThrow();
    expect(() =>
      assertCongressRepeatReport(report(congressIntakeOriginals)),
    ).toThrow();
  });
  it.each(["missing", "fourth", "retry", "unverified"])(
    "EARS-2: refuses %s evidence",
    (kind) => {
      const value = report(congressIntakeOriginals);
      if (kind === "missing") value.suites[0]!.specs.pop();
      if (kind === "fourth")
        value.suites[0]!.specs.push(report(["fourth"]).suites[0]!.specs[0]!);
      if (kind === "retry")
        value.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
      if (kind === "unverified")
        expect(() =>
          assertCongressIntakeBackgrounds(
            receipts().replace('"verified":true', '"verified":false'),
          ),
        ).toThrow();
      else expect(() => assertCongressIntakeReport(value)).toThrow();
    },
  );
});

describe("044 repeat, consent and price exact-three identity", () => {
  const receipts = (titles: readonly string[]) =>
    titles
      .flatMap((title) =>
        congressBackgrounds.map((clause) =>
          JSON.stringify({
            title,
            clause,
            eventId: "owned-event",
            verified: true,
          }),
        ),
      )
      .join("\n");
  const report = (titles: readonly string[]) => ({
    errors: [],
    suites: [
      {
        specs: titles.map((title) => ({
          title,
          tests: [
            {
              projectName: "admin",
              projectId: "admin",
              status: "expected",
              results: [{ status: "passed", retry: 0 }],
            },
          ],
        })),
      },
    ],
  });
  it("EARS-8: keeps both accepted trios strict and disjoint", () => {
    expect(() =>
      assertCongressRepeatBackgrounds(receipts(congressRepeatOriginals)),
    ).not.toThrow();
    expect(() =>
      assertCongressRepeatReport(report(congressRepeatOriginals)),
    ).not.toThrow();
    expect(() =>
      assertCongressRepeatReport(report(congressOriginals)),
    ).toThrow();
    expect(() =>
      assertCongressReport(report(congressRepeatOriginals)),
    ).toThrow();
    expect(() =>
      assertCongressBackgrounds(receipts(congressRepeatOriginals)),
    ).toThrow();
    expect(() =>
      assertCongressRepeatBackgrounds(receipts(congressOriginals)),
    ).toThrow();
  });
  it("EARS-41: refuses a fourth, a missing original and any retry", () => {
    expect(() =>
      assertCongressRepeatReport(
        report([...congressRepeatOriginals, "fourth"]),
      ),
    ).toThrow();
    expect(() =>
      assertCongressRepeatReport(report(congressRepeatOriginals.slice(1))),
    ).toThrow();
    const value = report(congressRepeatOriginals);
    value.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    expect(() => assertCongressRepeatReport(value)).toThrow();
  });
});
