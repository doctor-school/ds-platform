import { describe, expect, it } from "vitest";
import type { AdminApplicationDetail } from "@ds/schemas";
import {
  APPLICATION_STATUS_FILTERS,
  applicationActions,
  applicationRefusal,
  applicationStatusLabelKey,
  applicationsCursorPager,
  applicationsUrl,
  kindOptionLabel,
  rememberNextCursor,
} from "./applications";

const ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

function detail(
  overrides: Partial<AdminApplicationDetail> = {},
): AdminApplicationDetail {
  return {
    id: ID,
    kind: "author",
    kindLabel: "Автор",
    submittedAt: "2026-11-20T10:00:00.000Z",
    subjectLine: "Курс по кардиологии",
    fields: [],
    applicant: null,
    consent: {
      purpose: "academy_author_application",
      versionTag: "v1",
      capturedAt: "2026-11-20T10:00:00.000Z",
    },
    teamNotice: "sent",
    receiptNotice: "sent",
    status: "new",
    outcome: null,
    statusChangedAt: null,
    statusChangedBy: null,
    closedAt: null,
    erased: false,
    pdErasedAt: null,
    notes: [],
    otherApplications: [],
    version: 1,
    ...overrides,
  };
}

describe("033 admin «Заявки» — the pure projections", () => {
  it("EARS-13: the list URL carries only the set filters, the cursor and the page size", () => {
    expect(applicationsUrl.list({ limit: 20 })).toBe(
      "/v1/admin/applications?limit=20",
    );
    expect(
      applicationsUrl.list({
        kind: "author",
        status: "in_review",
        cursor: "abc",
        limit: 20,
      }),
    ).toBe(
      "/v1/admin/applications?kind=author&status=in_review&cursor=abc&limit=20",
    );
    // An empty filter is «any», never `status=` (the query is strict).
    expect(applicationsUrl.list({ kind: "", status: "", limit: 20 })).toBe(
      "/v1/admin/applications?limit=20",
    );
  });

  it("EARS-14: the per-application routes (status, notes, erasure too) are built in one place", () => {
    expect(applicationsUrl.detail(ID)).toBe(`/v1/admin/applications/${ID}`);
    expect(applicationsUrl.status(ID)).toBe(
      `/v1/admin/applications/${ID}/status`,
    );
    expect(applicationsUrl.notes(ID)).toBe(
      `/v1/admin/applications/${ID}/notes`,
    );
    expect(applicationsUrl.erase(ID)).toBe(
      `/v1/admin/applications/${ID}/erase-personal-data`,
    );
  });

  it("EARS-13: «Статус» filters over the three statuses", () => {
    expect(APPLICATION_STATUS_FILTERS).toEqual(["new", "in_review", "closed"]);
  });

  it("EARS-13: a «Вид» chip reads the label the api served for the kind, the kind itself before any page came", () => {
    const kinds = [{ kind: "author" as const, label: "Автор" }];
    expect(kindOptionLabel(kinds, "author")).toBe("Автор");
    expect(kindOptionLabel([], "author")).toBe("author");
  });

  it("EARS-13: a closed application reads as its outcome, an open one as its status", () => {
    expect(applicationStatusLabelKey("new", null)).toBe(
      "applications.status.new",
    );
    expect(applicationStatusLabelKey("in_review", null)).toBe(
      "applications.status.in_review",
    );
    expect(applicationStatusLabelKey("closed", "accepted")).toBe(
      "applications.outcome.accepted",
    );
    expect(applicationStatusLabelKey("closed", "declined")).toBe(
      "applications.outcome.declined",
    );
    expect(applicationStatusLabelKey("closed", "expired")).toBe(
      "applications.outcome.expired",
    );
    expect(applicationStatusLabelKey("closed", null)).toBe(
      "applications.status.closed",
    );
  });

  it("EARS-15: a new application can be taken into work or closed; one in review only closed; a closed one neither", () => {
    expect(applicationActions(detail({ status: "new" }))).toMatchObject({
      takeIntoWork: true,
      close: true,
    });
    expect(applicationActions(detail({ status: "in_review" }))).toMatchObject({
      takeIntoWork: false,
      close: true,
    });
    expect(
      applicationActions(detail({ status: "closed", outcome: "accepted" })),
    ).toMatchObject({ takeIntoWork: false, close: false });
  });

  it("EARS-20: an erased application takes no note and no second erasure", () => {
    expect(applicationActions(detail())).toMatchObject({
      addNote: true,
      erase: true,
    });
    expect(applicationActions(detail({ erased: true }))).toMatchObject({
      addNote: false,
      erase: false,
    });
  });

  it("EARS-15: each refusal (the note and erasure ones too) reads as what happened", () => {
    expect(
      applicationRefusal({ statusCode: 412, errorCode: "PRECONDITION_FAILED" }),
    ).toBe("stale");
    expect(
      applicationRefusal({ statusCode: 409, errorCode: "ALREADY_ERASED" }),
    ).toBe("alreadyErased");
    expect(
      applicationRefusal({
        statusCode: 409,
        errorCode: "APPLICATION_TRANSITION_NOT_ALLOWED",
      }),
    ).toBe("transitionNotAllowed");
    expect(applicationRefusal({ statusCode: 403 })).toBe("forbidden");
    expect(applicationRefusal({ statusCode: 404 })).toBe("notFound");
    expect(
      applicationRefusal({ statusCode: 400, errorCode: "VALIDATION_FAILED" }),
    ).toBe("invalid");
    expect(applicationRefusal({ statusCode: 503 })).toBe("unavailable");
    expect(applicationRefusal(new Error("network"))).toBe("unavailable");
    expect(applicationRefusal({ statusCode: 500 })).toBe("generic");
  });

  it("EARS-13: the cursor pager knows only whether a page exists before and after the current one", () => {
    expect(applicationsCursorPager([undefined], 1, null)).toEqual({
      hasPrevious: false,
      hasNext: false,
    });
    expect(applicationsCursorPager([undefined], 1, "c2")).toEqual({
      hasPrevious: false,
      hasNext: true,
    });
    expect(applicationsCursorPager([undefined, "c2"], 2, null)).toEqual({
      hasPrevious: true,
      hasNext: false,
    });
    // Back on page 1 while page 2 is in flight: the remembered cursor still
    // proves the next page exists.
    expect(applicationsCursorPager([undefined, "c2"], 1, null)).toEqual({
      hasPrevious: false,
      hasNext: true,
    });
  });

  it("EARS-13: the cursor of the page after the current one is kept, and a changed one drops the pages beyond", () => {
    expect(rememberNextCursor([undefined], 1, "c2")).toEqual([undefined, "c2"]);
    const known = [undefined, "c2"];
    expect(rememberNextCursor(known, 1, "c2")).toBe(known);
    expect(rememberNextCursor([undefined, "c2", "c3"], 1, "x2")).toEqual([
      undefined,
      "x2",
    ]);
    expect(rememberNextCursor([undefined], 1, null)).toEqual([undefined]);
  });
});
