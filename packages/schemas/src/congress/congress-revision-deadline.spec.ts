import { describe, expect, it } from "vitest";

import {
  CONGRESS_REVISION_BUSINESS_DAYS,
  revisionDueAt,
  revisionExtensionDueAt,
  revisionLastDay,
} from "./congress-revision-deadline.js";

/** An instant as Moscow wall-clock (`+03:00`, no seasonal time). */
const msk = (local: string) => new Date(`${local}+03:00`);

describe("046 EARS-34 — the per-submission revision deadline", () => {
  it("046 EARS-34: the term is three business days, a product constant", () => {
    expect(CONGRESS_REVISION_BUSINESS_DAYS).toBe(3);
  });

  it("046 EARS-34: set on Tuesday 2027-02-16 → stored 2027-02-20T00:00+03:00, Friday the 19th inclusive (V-12)", () => {
    const due = revisionDueAt(msk("2027-02-16T11:30:00"));
    expect(due.toISOString()).toBe(msk("2027-02-20T00:00:00").toISOString());
    expect(revisionLastDay(due)).toBe("2027-02-19");
  });

  it("046 EARS-34: set on Friday 2027-02-19 → stored 2027-02-25T00:00+03:00, the weekend skipped (V-12)", () => {
    const due = revisionDueAt(msk("2027-02-19T18:00:00"));
    expect(due.toISOString()).toBe(msk("2027-02-25T00:00:00").toISOString());
    expect(revisionLastDay(due)).toBe("2027-02-24");
  });

  it("046 EARS-34: the day of the change is the Moscow day, not the UTC day", () => {
    // 2027-02-15T22:30Z is already Tuesday 01:30 in Moscow.
    const due = revisionDueAt(new Date("2027-02-15T22:30:00Z"));
    expect(due.toISOString()).toBe(msk("2027-02-20T00:00:00").toISOString());
  });

  it("046 EARS-34: a change on Saturday or Sunday counts from Monday; no holiday calendar", () => {
    expect(revisionDueAt(msk("2027-02-20T10:00:00")).toISOString()).toBe(
      msk("2027-02-25T00:00:00").toISOString(),
    );
    expect(revisionDueAt(msk("2027-02-21T23:59:59")).toISOString()).toBe(
      msk("2027-02-25T00:00:00").toISOString(),
    );
    // 2027-03-08 is a Russian public holiday — still a business day here.
    expect(revisionDueAt(msk("2027-03-05T09:00:00")).toISOString()).toBe(
      msk("2027-03-11T00:00:00").toISOString(),
    );
  });

  it("046 EARS-35: an extension to 2027-03-03 is stored as 2027-03-04T00:00+03:00 (V-12)", () => {
    const due = revisionExtensionDueAt("2027-03-03");
    expect(due.toISOString()).toBe(msk("2027-03-04T00:00:00").toISOString());
    expect(revisionLastDay(due)).toBe("2027-03-03");
  });
});
