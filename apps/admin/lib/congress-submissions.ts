import {
  CONGRESS_ABSTRACT_SECTIONS,
  CONGRESS_COMMITTEE_COMMENT_MAX,
  CONGRESS_COMMITTEE_PROBLEM_CODES,
  CONGRESS_COMMITTEE_TRANSITIONS,
  CongressCommitteeProblemSchema,
  congressStatusNeedsComment,
  type CongressCommitteeStatus,
  type CongressSubmissionCard,
  type CongressSubmissionKind,
  type CongressSubmissionRegistryRow,
  type CongressSubmissionRegistrySort,
  type CongressSubmissionStatus,
} from "@ds/schemas";
import { formatMskDateTime } from "./msk";

/**
 * 046 EARS-27/28/35 (#2437) — the pure half of the programme committee's
 * screens: the submissions registry (`app/events/[id]/submissions/page.tsx`, an
 * `AdminDataList` mount in the pattern of `./congress-roster.ts`) and its card
 * (`components/submission-card-panel.tsx`). What a row shows, the query the
 * page owes the server and the checks the «Решение» block runs before it
 * writes are decided here, so the Node-only unit tier pins them. Every check
 * mirrors a server rule (`@ds/schemas`); the server stays the authority.
 */
export const CONGRESS_SUBMISSIONS_COLUMNS = [
  "number",
  "kind",
  "title",
  "submitter",
  "status",
  "submittedAt",
  "updatedAt",
] as const;

/** The text cells; вид and статус are catalog labels, № is the server's position. */
export interface SubmissionRegistryCells {
  title: string;
  submitter: string;
  submittedAt: string;
  updatedAt: string;
}

export function submissionRegistryCells(
  row: CongressSubmissionRegistryRow,
): SubmissionRegistryCells {
  return {
    title: row.title,
    submitter: row.submitter.fullName,
    // A row the API lists has been sent, but the contract allows `null`: the
    // cell is then EMPTY, never a placeholder.
    submittedAt: row.submittedAt ? formatMskDateTime(row.submittedAt) : "",
    updatedAt: formatMskDateTime(row.updatedAt),
  };
}

/** The registry's facets as the committee member set them; `""` = not chosen. */
export interface SubmissionRegistryFilter {
  kind: CongressSubmissionKind | "";
  status: Exclude<CongressSubmissionStatus, "draft"> | "";
  submitter: string;
  sentFrom: string;
  sentTo: string;
  sort: CongressSubmissionRegistrySort;
  order: "asc" | "desc";
}

/** The route's own defaults: newest send first. */
export const SUBMISSION_REGISTRY_FILTER_INITIAL: SubmissionRegistryFilter = {
  kind: "",
  status: "",
  submitter: "",
  sentFrom: "",
  sentTo: "",
  sort: "submittedAt",
  order: "desc",
};

export interface SubmissionRegistryQuery {
  q?: string;
  kind?: CongressSubmissionKind;
  status?: Exclude<CongressSubmissionStatus, "draft">;
  submitter?: string;
  sentFrom?: string;
  sentTo?: string;
  sort: CongressSubmissionRegistrySort;
  order: "asc" | "desc";
  page: number;
  pageSize: number;
}

/**
 * The GET query (EARS-27): every chosen facet, the search, the sort and the
 * page, composed. An unchosen facet is left out. A send-date range whose end
 * is before its start is a half-typed range — the route refuses it — so its
 * end is held back until it reads forward.
 */
export function submissionRegistryQuery(
  filter: SubmissionRegistryFilter,
  list: { q: string; page: number; pageSize: number },
): SubmissionRegistryQuery {
  const q = list.q.trim();
  const submitter = filter.submitter.trim();
  return {
    ...(q ? { q } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(submitter ? { submitter } : {}),
    ...appliedSentRange(filter),
    sort: filter.sort,
    order: filter.order,
    page: list.page,
    pageSize: list.pageSize,
  };
}

/**
 * The send-date bounds the query actually carries: a range whose end is
 * before its start is a half-typed range — the route refuses it — so its end
 * is held back until it reads forward.
 */
function appliedSentRange(
  filter: Pick<SubmissionRegistryFilter, "sentFrom" | "sentTo">,
): { sentFrom?: string; sentTo?: string } {
  const inverted =
    filter.sentFrom !== "" &&
    filter.sentTo !== "" &&
    filter.sentFrom > filter.sentTo;
  return {
    ...(filter.sentFrom ? { sentFrom: filter.sentFrom } : {}),
    ...(filter.sentTo && !inverted ? { sentTo: filter.sentTo } : {}),
  };
}

/**
 * The applied-filter chips of the send-date range: only the bounds the query
 * carries, each day as ДД.ММ.ГГГГ like the rest of the admin.
 */
export function submissionSentRangeChips(
  filter: Pick<SubmissionRegistryFilter, "sentFrom" | "sentTo">,
): { id: "sentFrom" | "sentTo"; day: string }[] {
  const applied = appliedSentRange(filter);
  return (["sentFrom", "sentTo"] as const).flatMap((id) => {
    const day = applied[id];
    return day ? [{ id, day: mskDayLabel(day) }] : [];
  });
}

// ---------------------------------------------------------------------------
// The card (EARS-28)
// ---------------------------------------------------------------------------

/** The statuses the «Решение» select offers from `from` — none on `withdrawn`. */
export function committeeTargets(
  from: CongressSubmissionStatus,
): CongressCommitteeStatus[] {
  return [...(CONGRESS_COMMITTEE_TRANSITIONS[from] ?? [])];
}

export type CommitteeDecisionError =
  "statusRequired" | "commentRequired" | "commentTooLong";

/**
 * The client half of the status change request schema: a status is chosen,
 * and `rejected` / `needs_revision` carry a trimmed comment of 1–2000
 * characters.
 */
export function committeeDecisionError(
  status: CongressCommitteeStatus | "",
  comment: string,
): CommitteeDecisionError | null {
  if (!status) return "statusRequired";
  if (!congressStatusNeedsComment(status)) return null;
  const text = comment.trim();
  if (text.length === 0) return "commentRequired";
  if (text.length > CONGRESS_COMMITTEE_COMMENT_MAX) return "commentTooLong";
  return null;
}

export type CommitteeWriteFailure =
  | (typeof CONGRESS_COMMITTEE_PROBLEM_CODES)[number]
  | "forbidden"
  | "unavailable"
  | "invalid"
  | "failed";

/**
 * Why a committee write (status change or extension) was refused: the
 * server's named problem when it gave one; else `forbidden` — the grant or
 * session is gone (401/403); `unavailable` — the live revalidation could not
 * run (503); `invalid` — the body was refused (400); `failed` — anything else.
 */
export function committeeWriteFailure(error: unknown): CommitteeWriteFailure {
  const { statusCode, problems } = (error ?? {}) as {
    statusCode?: number;
    problems?: unknown[];
  };
  if (Array.isArray(problems) && problems.length > 0) {
    const problem = CongressCommitteeProblemSchema.safeParse(problems[0]);
    return problem.success ? problem.data.code : "failed";
  }
  if (statusCode === 401 || statusCode === 403) return "forbidden";
  if (statusCode === 503) return "unavailable";
  if (statusCode === 400) return "invalid";
  return "failed";
}

/** A refusal the «Решение» block names: the client's own check or the server's. */
export type CommitteeDecisionRefusal =
  CommitteeWriteFailure | CommitteeDecisionError | "dayRequired";

/**
 * The «Решение» block's state. It lives as long as the card of one submission
 * is open — NOT per status — because every write and every concurrent-change
 * refusal re-reads the card: the outcome of that write (its confirmation, or
 * the named refusal with the comment the member typed) must survive the
 * re-read that follows it.
 */
export interface CommitteeDecisionState {
  /** The stored status and deadline the controls were built from. */
  basis: string;
  status: CongressCommitteeStatus | "";
  comment: string;
  extendTo: string;
  notice: "saved" | "extensionSaved" | null;
  decisionRefusal: CommitteeDecisionRefusal | null;
  extensionRefusal: CommitteeDecisionRefusal | null;
}

export type CommitteeDecisionEvent =
  | { type: "choose"; status: CongressCommitteeStatus | "" }
  | { type: "type"; comment: string }
  | { type: "day"; day: string }
  | { type: "submit" }
  | { type: "decision-refused"; failure: CommitteeDecisionRefusal }
  | { type: "decision-saved" }
  | { type: "extension-refused"; failure: CommitteeDecisionRefusal }
  | { type: "extension-saved" }
  | { type: "card-read"; basis: string };

/** What the decision controls depend on: the stored status and deadline. */
export function committeeDecisionBasis(
  card: Pick<CongressSubmissionCard, "status" | "revisionDueAt">,
): string {
  return `${card.status}:${card.revisionDueAt ?? ""}`;
}

export function committeeDecisionInitial(
  basis: string,
): CommitteeDecisionState {
  return {
    basis,
    status: "",
    comment: "",
    extendTo: "",
    notice: null,
    decisionRefusal: null,
    extensionRefusal: null,
  };
}

export function committeeDecisionReducer(
  state: CommitteeDecisionState,
  event: CommitteeDecisionEvent,
): CommitteeDecisionState {
  switch (event.type) {
    case "choose":
      return { ...state, status: event.status };
    case "type":
      return { ...state, comment: event.comment };
    case "day":
      return { ...state, extendTo: event.day };
    case "submit":
      return {
        ...state,
        notice: null,
        decisionRefusal: null,
        extensionRefusal: null,
      };
    case "decision-refused":
      return { ...state, notice: null, decisionRefusal: event.failure };
    case "extension-refused":
      return { ...state, notice: null, extensionRefusal: event.failure };
    case "decision-saved":
      return {
        ...state,
        status: "",
        comment: "",
        notice: "saved",
        decisionRefusal: null,
      };
    case "extension-saved":
      return {
        ...state,
        extendTo: "",
        notice: "extensionSaved",
        extensionRefusal: null,
      };
    case "card-read":
      // A new stored status may not offer the chosen edge: the select starts
      // over. The outcome message and the typed comment stay.
      return event.basis === state.basis
        ? state
        : { ...state, basis: event.basis, status: "", extendTo: "" };
  }
}

/** The content sections of each kind, in its form's order. */
const BODY_SECTIONS: Record<CongressSubmissionKind, readonly string[]> = {
  oral: ["goal", "summary"],
  poster: ["goal", "content"],
  abstract: CONGRESS_ABSTRACT_SECTIONS,
};

/**
 * The card's content: the kind's sections in form order, each with its
 * catalog key (`<kind>.<section>`); an empty section is left out.
 */
export function submissionBodySections(
  kind: CongressSubmissionKind,
  body: Record<string, string>,
): { key: string; text: string }[] {
  return BODY_SECTIONS[kind]
    .filter((section) => (body[section] ?? "").trim() !== "")
    .map((section) => ({ key: `${kind}.${section}`, text: body[section]! }));
}

/** One author of the card's «Содержание»: the name, the workplace apart, the presenter flag. */
export interface SubmissionAuthorLine {
  name: string;
  workplace: string | null;
  presenting: boolean;
}

/**
 * The card's author list: one line per author — the full name in the
 * form's order (фамилия, имя, отчество), the workplace as its own secondary
 * part, the presenter marked. Blank parts are left out.
 */
export function submissionAuthorLines(
  authors: CongressSubmissionCard["authors"],
): SubmissionAuthorLine[] {
  return authors.map((author) => ({
    name: [author.surname, author.firstName, author.patronymic]
      .map((part) => part?.trim() ?? "")
      .filter(Boolean)
      .join(" "),
    workplace: author.workplace?.trim() || null,
    presenting: author.presenting === true,
  }));
}

/** What the committee reads first under the card's header. */
export interface SubmissionDecisionSummary {
  /** The revision deadline — a `needs_revision` card's only. */
  deadline: { day: string; expired: boolean } | null;
  comment: string | null;
  lastLetter: CongressSubmissionCard["lastLetter"];
}

/**
 * The card's decision summary: the revision deadline (only while the card is
 * `needs_revision`), the committee's comment and the last letter to the
 * author. `null` when the card carries none of them — the block is then left
 * out rather than shown empty.
 */
export function submissionDecisionSummary(
  card: Pick<
    CongressSubmissionCard,
    | "status"
    | "revisionDueAt"
    | "revisionLastDay"
    | "committeeComment"
    | "lastLetter"
  >,
  now: Date,
): SubmissionDecisionSummary | null {
  const deadline =
    card.status === "needs_revision" ? revisionDeadlineView(card, now) : null;
  const comment = card.committeeComment || null;
  if (!deadline && !comment && !card.lastLetter) return null;
  return { deadline, comment, lastLetter: card.lastLetter };
}

// ---------------------------------------------------------------------------
// The revision deadline (EARS-34, EARS-35)
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` → `ДД.ММ.ГГГГ`, the letters' «до {дата}, 23:59 МСК». */
function mskDayLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

/**
 * The card's deadline line: the last day as the letters name it, and whether
 * the stored (exclusive) instant has passed. `null` when there is none.
 */
export function revisionDeadlineView(
  card: Pick<CongressSubmissionCard, "revisionDueAt" | "revisionLastDay">,
  now: Date,
): { day: string; expired: boolean } | null {
  if (!card.revisionDueAt || !card.revisionLastDay) return null;
  return {
    day: mskDayLabel(card.revisionLastDay),
    expired: new Date(card.revisionDueAt).getTime() <= now.getTime(),
  };
}

/** EARS-35 — the extension is the platform administrator's, on `needs_revision` only. */
export function mayExtendRevision(
  platformAdmin: boolean,
  status: CongressSubmissionStatus,
): boolean {
  return platformAdmin && status === "needs_revision";
}

/**
 * The extension refusal the card shows outside the extension form: the form
 * exists only on `needs_revision`, so a refusal whose re-read took the
 * submission off that status (`not-needs-revision`) would unmount with it.
 * `null` while the form is offered — there its refusal renders inside it.
 */
export function extensionRefusalOutsideForm(
  state: Pick<CommitteeDecisionState, "extensionRefusal">,
  platformAdmin: boolean,
  status: CongressSubmissionStatus,
): CommitteeDecisionRefusal | null {
  return mayExtendRevision(platformAdmin, status)
    ? null
    : state.extensionRefusal;
}

/**
 * The client half of the extension rules (EARS-35): a day is chosen, it is
 * after the current last day and not before today (Moscow). The codes are
 * the server's own, so one message table covers both refusals.
 */
export function revisionExtensionError(
  day: string,
  currentLastDay: string | null,
  today: string,
): "dayRequired" | "revision-day-not-later" | "revision-day-in-past" | null {
  if (!day) return "dayRequired";
  if (day < today) return "revision-day-in-past";
  if (currentLastDay && day <= currentLastDay) return "revision-day-not-later";
  return null;
}

/** The address search parameter carrying the open submission card. */
export const SUBMISSION_CARD_PARAM = "submission";

/**
 * The registry address with the open card in `?submission=` (or without it,
 * for `null`), every other parameter kept as it was.
 */
export function submissionCardHref(
  pathname: string,
  search: string,
  submissionId: string | null,
): string {
  const params = new URLSearchParams(search);
  if (submissionId) params.set(SUBMISSION_CARD_PARAM, submissionId);
  else params.delete(SUBMISSION_CARD_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
