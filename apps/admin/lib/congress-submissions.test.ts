import { describe, expect, it } from "vitest";
import type {
  CongressSubmissionCard,
  CongressSubmissionRegistryRow,
} from "@ds/schemas";
import {
  CONGRESS_SUBMISSIONS_COLUMNS,
  SUBMISSION_REGISTRY_FILTER_INITIAL,
  committeeDecisionBasis,
  committeeDecisionError,
  committeeDecisionInitial,
  committeeDecisionReducer,
  committeeTargets,
  committeeWriteFailure,
  extensionRefusalOutsideForm,
  mayExtendRevision,
  revisionDeadlineView,
  revisionExtensionError,
  submissionAuthorLines,
  submissionBodySections,
  submissionCardHref,
  submissionDecisionSummary,
  submissionRegistryCells,
  submissionRegistryQuery,
  submissionSentRangeChips,
} from "./congress-submissions";
import { congressSubmissionsUrl } from "@/providers/data-provider";

/**
 * 046 EARS-27/28/35 — the pure half of the programme committee's screens: the
 * registry projection the page hands to `AdminDataList`, the query it owes the
 * server, and the decisions the card's «Решение» block takes before it writes.
 * The server stays the authority on every one of them.
 */
const EVENT = "0b5f7c1e-4c1a-4e7e-9a55-0a4f2d9b1a0a";
const SUBMISSION = "7c0e2d0a-2d7c-4a7f-9c55-0a4f2d9b1a01";

const row: CongressSubmissionRegistryRow = {
  id: SUBMISSION,
  position: 21,
  kind: "oral",
  title: "Новые подходы к терапии",
  submitter: {
    fullName: "Иванова Мария Петровна",
    email: "ivanova@example.test",
  },
  status: "submitted",
  // 09:00 МСК == 06:00Z.
  submittedAt: "2026-11-20T06:00:00.000Z",
  updatedAt: "2026-11-21T07:30:00.000Z",
};

describe("046 EARS-27 submissions registry projection", () => {
  it("046 EARS-27: the columns are №, вид, тема, подающий, статус, отправлена, изменена", () => {
    expect(CONGRESS_SUBMISSIONS_COLUMNS).toEqual([
      "number",
      "kind",
      "title",
      "submitter",
      "status",
      "submittedAt",
      "updatedAt",
    ]);
  });

  it("046 EARS-27: a row renders its МСК instants and the submitter's name", () => {
    expect(submissionRegistryCells(row)).toEqual({
      title: "Новые подходы к терапии",
      submitter: "Иванова Мария Петровна",
      submittedAt: "20 ноября 2026 г., 09:00",
      updatedAt: "21 ноября 2026 г., 10:30",
    });
    // A row never sent carries no send instant — the cell is EMPTY.
    expect(
      submissionRegistryCells({ ...row, submittedAt: null }).submittedAt,
    ).toBe("");
  });

  it("046 EARS-27: every filter, the sort and the page compose into one server query", () => {
    expect(
      submissionRegistryQuery(SUBMISSION_REGISTRY_FILTER_INITIAL, {
        q: "",
        page: 1,
        pageSize: 20,
      }),
    ).toEqual({ sort: "submittedAt", order: "desc", page: 1, pageSize: 20 });

    expect(
      submissionRegistryQuery(
        {
          kind: "poster",
          status: "needs_revision",
          submitter: "ivanova",
          sentFrom: "2026-11-01",
          sentTo: "2026-11-30",
          sort: "title",
          order: "asc",
        },
        { q: "терапия", page: 3, pageSize: 20 },
      ),
    ).toEqual({
      q: "терапия",
      kind: "poster",
      status: "needs_revision",
      submitter: "ivanova",
      sentFrom: "2026-11-01",
      sentTo: "2026-11-30",
      sort: "title",
      order: "asc",
      page: 3,
      pageSize: 20,
    });
  });

  it("046 EARS-27: an inverted send-date range is not sent — the route would refuse it", () => {
    expect(
      submissionRegistryQuery(
        {
          ...SUBMISSION_REGISTRY_FILTER_INITIAL,
          sentFrom: "2026-11-30",
          sentTo: "2026-11-01",
        },
        { q: "", page: 1, pageSize: 20 },
      ),
    ).toEqual({
      sentFrom: "2026-11-30",
      sort: "submittedAt",
      order: "desc",
      page: 1,
      pageSize: 20,
    });
  });

  it("046 EARS-27: the send-date chips name only the applied bounds, as ДД.ММ.ГГГГ", () => {
    expect(
      submissionSentRangeChips({
        ...SUBMISSION_REGISTRY_FILTER_INITIAL,
        sentFrom: "2026-11-01",
        sentTo: "2026-11-30",
      }),
    ).toEqual([
      { id: "sentFrom", day: "01.11.2026" },
      { id: "sentTo", day: "30.11.2026" },
    ]);
    // An inverted range holds its end back, so no chip claims it.
    expect(
      submissionSentRangeChips({
        ...SUBMISSION_REGISTRY_FILTER_INITIAL,
        sentFrom: "2026-11-30",
        sentTo: "2026-11-01",
      }),
    ).toEqual([{ id: "sentFrom", day: "30.11.2026" }]);
    expect(
      submissionSentRangeChips(SUBMISSION_REGISTRY_FILTER_INITIAL),
    ).toEqual([]);
  });

  it("046 EARS-27: the registry, card and writes address the event's submissions", () => {
    expect(
      congressSubmissionsUrl.list(EVENT, {
        q: "",
        kind: "oral",
        sort: "status",
        order: "asc",
        page: 2,
        pageSize: 20,
      }),
    ).toBe(
      `/v1/admin/events/${EVENT}/congress-submissions?kind=oral&sort=status&order=asc&page=2&pageSize=20`,
    );
    expect(congressSubmissionsUrl.card(EVENT, SUBMISSION)).toBe(
      `/v1/admin/events/${EVENT}/congress-submissions/${SUBMISSION}`,
    );
    expect(congressSubmissionsUrl.status(EVENT, SUBMISSION)).toBe(
      `/v1/admin/events/${EVENT}/congress-submissions/${SUBMISSION}/status`,
    );
    expect(congressSubmissionsUrl.revisionDeadline(EVENT, SUBMISSION)).toBe(
      `/v1/admin/events/${EVENT}/congress-submissions/${SUBMISSION}/revision-deadline`,
    );
  });
});

describe("046 EARS-28 the card's decision", () => {
  it("046 EARS-28: the status control offers only the machine's edges from the current status", () => {
    expect(committeeTargets("submitted")).toEqual([
      "in_review",
      "accepted",
      "rejected",
      "needs_revision",
    ]);
    expect(committeeTargets("needs_revision")).toEqual([
      "accepted",
      "rejected",
    ]);
    expect(committeeTargets("accepted")).toEqual(["in_review"]);
    // A withdrawn submission is final: nothing to offer.
    expect(committeeTargets("withdrawn")).toEqual([]);
  });

  it("046 EARS-28: rejected and needs_revision need a comment of 1–2000 characters", () => {
    expect(committeeDecisionError("", "")).toBe("statusRequired");
    expect(committeeDecisionError("rejected", "   ")).toBe("commentRequired");
    expect(committeeDecisionError("needs_revision", "")).toBe(
      "commentRequired",
    );
    expect(committeeDecisionError("needs_revision", "x".repeat(2001))).toBe(
      "commentTooLong",
    );
    expect(
      committeeDecisionError("needs_revision", "x".repeat(2000)),
    ).toBeNull();
    expect(committeeDecisionError("rejected", "Не по теме")).toBeNull();
    // Other targets carry no comment requirement.
    expect(committeeDecisionError("accepted", "")).toBeNull();
    expect(committeeDecisionError("in_review", "")).toBeNull();
  });

  it("046 EARS-28: a refused write names its reason from the server's problem code", () => {
    expect(
      committeeWriteFailure({
        statusCode: 409,
        problems: [
          { code: "status-conflict", params: { status: "withdrawn" } },
        ],
      }),
    ).toBe("status-conflict");
    expect(
      committeeWriteFailure({
        statusCode: 422,
        problems: [{ code: "revision-day-in-past" }],
      }),
    ).toBe("revision-day-in-past");
    expect(committeeWriteFailure({ statusCode: 403 })).toBe("forbidden");
    expect(committeeWriteFailure({ statusCode: 401 })).toBe("forbidden");
    expect(committeeWriteFailure({ statusCode: 503 })).toBe("unavailable");
    expect(committeeWriteFailure({ statusCode: 400 })).toBe("invalid");
    expect(committeeWriteFailure({ statusCode: 500 })).toBe("failed");
    expect(
      committeeWriteFailure({
        statusCode: 409,
        problems: [{ code: "unknown" }],
      }),
    ).toBe("failed");
  });

  it("046 EARS-28: the saved decision's confirmation outlives the card's re-read", () => {
    const before = committeeDecisionBasis({
      status: "submitted",
      revisionDueAt: null,
    });
    let state = committeeDecisionInitial(before);
    state = committeeDecisionReducer(state, {
      type: "choose",
      status: "needs_revision",
    });
    state = committeeDecisionReducer(state, { type: "type", comment: "Да" });
    state = committeeDecisionReducer(state, { type: "decision-saved" });
    // The write changed the status: the re-read brings a new basis.
    state = committeeDecisionReducer(state, {
      type: "card-read",
      basis: committeeDecisionBasis({
        status: "needs_revision",
        revisionDueAt: "2026-10-22T21:00:00.000Z",
      }),
    });
    expect(state.notice).toBe("saved");
    // The next decision starts fresh from the stored status.
    expect(state.status).toBe("");
    expect(state.comment).toBe("");
    expect(state.decisionRefusal).toBeNull();
  });

  it("046 EARS-28: a status conflict keeps its named refusal and the typed comment across the re-read", () => {
    let state = committeeDecisionInitial(
      committeeDecisionBasis({ status: "in_review", revisionDueAt: null }),
    );
    state = committeeDecisionReducer(state, {
      type: "choose",
      status: "rejected",
    });
    state = committeeDecisionReducer(state, {
      type: "type",
      comment: "Не по теме конгресса.",
    });
    state = committeeDecisionReducer(state, {
      type: "decision-refused",
      failure: "status-conflict",
    });
    state = committeeDecisionReducer(state, {
      type: "card-read",
      basis: committeeDecisionBasis({
        status: "accepted",
        revisionDueAt: null,
      }),
    });
    expect(state.decisionRefusal).toBe("status-conflict");
    expect(state.comment).toBe("Не по теме конгресса.");
    // The chosen edge may not exist from the new status: the select resets.
    expect(state.status).toBe("");
  });

  it("046 EARS-28: a re-read of the same status keeps the draft as typed", () => {
    const basis = committeeDecisionBasis({
      status: "submitted",
      revisionDueAt: null,
    });
    let state = committeeDecisionInitial(basis);
    state = committeeDecisionReducer(state, {
      type: "choose",
      status: "accepted",
    });
    expect(committeeDecisionReducer(state, { type: "card-read", basis })).toBe(
      state,
    );
  });

  it("046 EARS-28: the content sections follow the kind's form order and labels", () => {
    expect(
      submissionBodySections("oral", { summary: "Итог", goal: "Цель доклада" }),
    ).toEqual([
      { key: "oral.goal", text: "Цель доклада" },
      { key: "oral.summary", text: "Итог" },
    ]);
    expect(
      submissionBodySections("abstract", {
        conclusions: "В",
        relevance: "А",
        results: "",
      }),
    ).toEqual([
      { key: "abstract.relevance", text: "А" },
      { key: "abstract.conclusions", text: "В" },
    ]);
  });

  it("046 EARS-28: an author reads as one line — the full name, the workplace apart, the presenter marked", () => {
    expect(
      submissionAuthorLines([
        {
          surname: "Иванова",
          firstName: "Анна",
          patronymic: "Сергеевна",
          workplace: " НМИЦ ",
          presenting: true,
        },
        { surname: "Петров", firstName: " ", workplace: "" },
      ]),
    ).toEqual([
      {
        name: "Иванова Анна Сергеевна",
        workplace: "НМИЦ",
        presenting: true,
      },
      { name: "Петров", workplace: null, presenting: false },
    ]);
  });

  it("046 EARS-28: the decision summary gathers the deadline, the comment and the last letter, and is absent without any", () => {
    const now = new Date("2026-11-20T09:00:00.000Z");
    const undecided = {
      status: "submitted",
      revisionDueAt: null,
      revisionLastDay: null,
      committeeComment: null,
      lastLetter: null,
    } as Pick<
      CongressSubmissionCard,
      | "status"
      | "revisionDueAt"
      | "revisionLastDay"
      | "committeeComment"
      | "lastLetter"
    >;
    expect(submissionDecisionSummary(undecided, now)).toBeNull();

    const letter = {
      status: "sent",
      at: "2026-11-18T10:00:00.000Z",
    } as NonNullable<CongressSubmissionCard["lastLetter"]>;
    expect(
      submissionDecisionSummary(
        {
          ...undecided,
          status: "needs_revision",
          revisionDueAt: "2026-11-25T21:00:00.000Z",
          revisionLastDay: "2026-11-25",
          committeeComment: "Уточните выборку.",
          lastLetter: letter,
        },
        now,
      ),
    ).toEqual({
      deadline: { day: "25.11.2026", expired: false },
      comment: "Уточните выборку.",
      lastLetter: letter,
    });

    // A deadline left from an earlier needs_revision is not the summary's.
    expect(
      submissionDecisionSummary(
        {
          ...undecided,
          status: "accepted",
          revisionDueAt: "2026-11-25T21:00:00.000Z",
          revisionLastDay: "2026-11-25",
        },
        now,
      ),
    ).toBeNull();
  });
});

describe("046 EARS-35 the revision deadline in the card", () => {
  const card = {
    status: "needs_revision",
    revisionDueAt: "2026-11-25T21:00:00.000Z",
    revisionLastDay: "2026-11-25",
  } as Pick<
    CongressSubmissionCard,
    "status" | "revisionDueAt" | "revisionLastDay"
  >;

  it("046 EARS-35: the deadline reads as the letters do — до ДД.ММ.ГГГГ, 23:59 МСК — or as expired", () => {
    expect(
      revisionDeadlineView(card, new Date("2026-11-24T10:00:00.000Z")),
    ).toEqual({ day: "25.11.2026", expired: false });
    expect(
      revisionDeadlineView(card, new Date("2026-11-25T21:00:00.000Z")),
    ).toEqual({ day: "25.11.2026", expired: true });
    expect(
      revisionDeadlineView(
        { ...card, revisionDueAt: null, revisionLastDay: null },
        new Date(),
      ),
    ).toBeNull();
  });

  it("046 EARS-35: the extension's confirmation outlives the card's re-read", () => {
    let state = committeeDecisionInitial(
      committeeDecisionBasis({
        status: "needs_revision",
        revisionDueAt: "2026-10-22T21:00:00.000Z",
      }),
    );
    state = committeeDecisionReducer(state, { type: "day", day: "2026-10-30" });
    state = committeeDecisionReducer(state, {
      type: "extension-refused",
      failure: "revision-day-not-later",
    });
    state = committeeDecisionReducer(state, { type: "day", day: "2026-11-05" });
    state = committeeDecisionReducer(state, { type: "extension-saved" });
    state = committeeDecisionReducer(state, {
      type: "card-read",
      basis: committeeDecisionBasis({
        status: "needs_revision",
        revisionDueAt: "2026-11-05T21:00:00.000Z",
      }),
    });
    expect(state.notice).toBe("extensionSaved");
    expect(state.extensionRefusal).toBeNull();
    expect(state.extendTo).toBe("");
  });

  it("046 EARS-35: an extension refused because the submission left needs_revision names the refusal after the re-read", () => {
    let state = committeeDecisionInitial(
      committeeDecisionBasis({
        status: "needs_revision",
        revisionDueAt: "2026-10-22T21:00:00.000Z",
      }),
    );
    state = committeeDecisionReducer(state, { type: "day", day: "2026-11-05" });
    // While the form is offered, its own refusal renders inside it.
    expect(
      committeeDecisionReducer(state, {
        type: "extension-refused",
        failure: "revision-day-not-later",
      }),
    ).toMatchObject({ extensionRefusal: "revision-day-not-later" });
    expect(
      extensionRefusalOutsideForm(
        { ...state, extensionRefusal: "revision-day-not-later" },
        true,
        "needs_revision",
      ),
    ).toBeNull();
    // The status changed elsewhere: the write is refused and the card re-reads.
    state = committeeDecisionReducer(state, {
      type: "extension-refused",
      failure: "not-needs-revision",
    });
    state = committeeDecisionReducer(state, {
      type: "card-read",
      basis: committeeDecisionBasis({
        status: "in_review",
        revisionDueAt: null,
      }),
    });
    // The extension form is gone with the status; its refusal is not.
    expect(mayExtendRevision(true, "in_review")).toBe(false);
    expect(extensionRefusalOutsideForm(state, true, "in_review")).toBe(
      "not-needs-revision",
    );
  });

  it("046 EARS-35: only the platform administrator extends, and only a needs_revision submission", () => {
    expect(mayExtendRevision(true, "needs_revision")).toBe(true);
    expect(mayExtendRevision(false, "needs_revision")).toBe(false);
    expect(mayExtendRevision(true, "rejected")).toBe(false);
    expect(mayExtendRevision(true, "withdrawn")).toBe(false);
  });

  it("046 EARS-35: the new last day must be after the current one and not before today", () => {
    const today = "2026-11-24";
    expect(revisionExtensionError("", "2026-11-25", today)).toBe("dayRequired");
    expect(revisionExtensionError("2026-11-25", "2026-11-25", today)).toBe(
      "revision-day-not-later",
    );
    expect(revisionExtensionError("2026-11-23", null, today)).toBe(
      "revision-day-in-past",
    );
    expect(
      revisionExtensionError("2026-11-28", "2026-11-25", today),
    ).toBeNull();
  });
});

describe("046 EARS-28 the open card lives in the address", () => {
  it("046 EARS-28: ?submission= opens a card and closing drops it, other parameters kept", () => {
    expect(submissionCardHref("/events/e/submissions", "q=x", SUBMISSION)).toBe(
      `/events/e/submissions?q=x&submission=${SUBMISSION}`,
    );
    expect(
      submissionCardHref(
        "/events/e/submissions",
        `submission=${SUBMISSION}`,
        null,
      ),
    ).toBe("/events/e/submissions");
  });
});
