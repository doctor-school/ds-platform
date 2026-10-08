import { describe, expect, it } from "vitest";

import {
  CongressSubmissionRegistryQuerySchema,
  CongressSubmissionStatusChangeRequestSchema,
  CongressRevisionDeadlineRequestSchema,
  isCongressCommitteeTransition,
} from "./congress-submission-admin.schema.js";

describe("046 EARS-28 — the committee status change contract", () => {
  it("046 EARS-28: rejected and needs_revision require a comment of 1–2000 characters", () => {
    for (const status of ["rejected", "needs_revision"] as const) {
      expect(
        CongressSubmissionStatusChangeRequestSchema.safeParse({
          status,
          expectedStatus: "submitted",
        }).success,
      ).toBe(false);
      expect(
        CongressSubmissionStatusChangeRequestSchema.safeParse({
          status,
          expectedStatus: "submitted",
          comment: "   ",
        }).success,
      ).toBe(false);
      expect(
        CongressSubmissionStatusChangeRequestSchema.safeParse({
          status,
          expectedStatus: "submitted",
          comment: "x".repeat(2001),
        }).success,
      ).toBe(false);
      expect(
        CongressSubmissionStatusChangeRequestSchema.safeParse({
          status,
          expectedStatus: "submitted",
          comment: "x".repeat(2000),
        }).success,
      ).toBe(true);
    }
  });

  it("046 EARS-28: in_review and accepted take no required comment", () => {
    for (const status of ["in_review", "accepted"] as const) {
      expect(
        CongressSubmissionStatusChangeRequestSchema.safeParse({
          status,
          expectedStatus: "submitted",
        }).success,
      ).toBe(true);
    }
  });

  it("046 EARS-28: the committee edges follow the status machine; withdrawn and draft offer nothing", () => {
    expect(isCongressCommitteeTransition("submitted", "needs_revision")).toBe(
      true,
    );
    expect(isCongressCommitteeTransition("needs_revision", "accepted")).toBe(
      true,
    );
    expect(isCongressCommitteeTransition("needs_revision", "rejected")).toBe(
      true,
    );
    expect(isCongressCommitteeTransition("needs_revision", "in_review")).toBe(
      false,
    );
    expect(isCongressCommitteeTransition("accepted", "in_review")).toBe(true);
    expect(isCongressCommitteeTransition("accepted", "rejected")).toBe(false);
    for (const to of [
      "in_review",
      "accepted",
      "rejected",
      "needs_revision",
    ] as const) {
      expect(isCongressCommitteeTransition("withdrawn", to)).toBe(false);
      expect(isCongressCommitteeTransition("draft", to)).toBe(false);
    }
  });
});

describe("046 EARS-27 — the registry query", () => {
  it("046 EARS-27: drafts cannot be asked for; defaults sort by send date, newest first", () => {
    expect(
      CongressSubmissionRegistryQuerySchema.safeParse({ status: "draft" })
        .success,
    ).toBe(false);
    const q = CongressSubmissionRegistryQuerySchema.parse({});
    expect(q).toMatchObject({
      sort: "submittedAt",
      order: "desc",
      page: 1,
      pageSize: 20,
    });
  });

  it("046 EARS-27: a send-date range whose start is after its end is refused", () => {
    expect(
      CongressSubmissionRegistryQuerySchema.safeParse({
        sentFrom: "2027-02-20",
        sentTo: "2027-02-19",
      }).success,
    ).toBe(false);
  });
});

describe("046 EARS-35 — the extension request", () => {
  it("046 EARS-35: the new last day is a calendar date", () => {
    expect(
      CongressRevisionDeadlineRequestSchema.safeParse({ lastDay: "2027-03-03" })
        .success,
    ).toBe(true);
    expect(
      CongressRevisionDeadlineRequestSchema.safeParse({
        lastDay: "2027-03-03T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
