import { z } from "zod";
import {
  EventAdminListItemSchema,
  EventAdminListSchema,
  GRANTABLE_STAFF_ROLES,
  isEventBoundStaffRole,
  StaffAccessGrantRequestSchema,
  StaffAccessGrantResponseSchema,
  type GrantableStaffRole,
  type StaffAccessGrantRequest,
  type StaffAccessRow,
} from "@ds/schemas";
import { formatMskDateTime } from "./msk";
import { isStepUpRequired } from "./step-up";

/**
 * 047 — the pure projections behind «Доступы» (`app/access/page.tsx` and
 * `components/staff-access-grant-form.tsx`): what a row shows, what the grant
 * form sends, and how each answer reads. The page and the form are thin mounts;
 * the decisions live here so the Node-only unit tier pins them.
 */

/** `GET` — every holder of a grantable role (EARS-2). */
export const STAFF_ACCESS_PATH = "/v1/admin/staff-access";
/** `POST` — the grant (EARS-3…EARS-6). */
export const STAFF_ACCESS_GRANTS_PATH = "/v1/admin/staff-access/grants";
/** The grant as the step-up re-verification names it (EARS-8). */
export const STAFF_ACCESS_GRANT_ENDPOINT = `POST ${STAFF_ACCESS_GRANTS_PATH}`;
/** The page the code screen returns to. */
export const STAFF_ACCESS_ROUTE = "/access";

/** The roles the form offers, in the select's order. */
export const STAFF_ACCESS_ROLES: readonly GrantableStaffRole[] =
  GRANTABLE_STAFF_ROLES;

/** The RU label key of a role («Администратор платформы», …). */
export function staffAccessRoleLabelKey(role: GrantableStaffRole): string {
  return `staffAccess.roles.${role}`;
}

/** «Мероприятие» is asked for the two congress roles only (EARS-3). */
export function staffAccessRoleTakesEvent(role: string): boolean {
  return isEventBoundStaffRole(role);
}

export interface StaffAccessCells {
  fullName: string;
  email: string;
  /** Resolved by the page through its translator. */
  roleKey: string;
  /** Empty for `platform_admin` and for a binding row that is missing. */
  event: string;
}

/** One row as display strings — an absent value renders empty, never invented. */
export function staffAccessCells(row: StaffAccessRow): StaffAccessCells {
  return {
    fullName: row.fullName ?? "",
    email: row.email ?? "",
    roleKey: staffAccessRoleLabelKey(row.role),
    event: row.eventTitle ?? "",
  };
}

/** One row per person, role and event (EARS-2). */
export function staffAccessRowKey(row: StaffAccessRow): string {
  return `${row.userId}:${row.role}:${row.eventId ?? ""}`;
}

// ── the grant form ──────────────────────────────────────────────────────────

export interface GrantFormFields {
  email: string;
  fullName: string;
  role: GrantableStaffRole | "";
  /** Only read for a congress role. */
  eventId: string;
}

export const GRANT_FORM_EMPTY: GrantFormFields = {
  email: "",
  fullName: "",
  role: "",
  eventId: "",
};

/** What is wrong with a field — each has its RU line under `staffAccess.grant.validation`. */
export type GrantFieldIssue = "required" | "email" | "fullName" | "event";

/** The request the API would accept, built from the form — `null` when it would refuse it. */
export function grantRequestOf(
  fields: GrantFormFields,
): StaffAccessGrantRequest | null {
  const parsed = StaffAccessGrantRequestSchema.safeParse(toCandidate(fields));
  return parsed.success ? parsed.data : null;
}

function toCandidate(fields: GrantFormFields): Record<string, unknown> {
  return {
    email: fields.email,
    fullName: fields.fullName,
    role: fields.role,
    ...(staffAccessRoleTakesEvent(fields.role) && fields.eventId
      ? { eventId: fields.eventId }
      : {}),
  };
}

/**
 * The form's own refusal of a missing or malformed field (EARS-3), read off the
 * SSOT request schema by field — the browser refuses exactly what the API does.
 */
export function grantFormIssues(
  fields: GrantFormFields,
): Partial<Record<keyof GrantFormFields, GrantFieldIssue>> {
  const issues: Partial<Record<keyof GrantFormFields, GrantFieldIssue>> = {};
  const parsed = StaffAccessGrantRequestSchema.safeParse(toCandidate(fields));
  if (parsed.success) return issues;
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "email" && !issues.email) {
      issues.email = fields.email.trim() ? "email" : "required";
    } else if (field === "fullName" && !issues.fullName) {
      issues.fullName = fields.fullName.trim() ? "fullName" : "required";
    } else if (field === "role" && !issues.role) {
      issues.role = "required";
    } else if (field === "eventId" && !issues.eventId) {
      issues.eventId = "event";
    }
  }
  return issues;
}

// ── the grant answer ────────────────────────────────────────────────────────

export type GrantOutcome =
  /** A new account, or one without a password: shown once (EARS-6). */
  | { kind: "password"; password: string; row: StaffAccessRow }
  /** The role was added to an existing account; its password is unchanged (EARS-4). */
  | { kind: "existing"; row: StaffAccessRow };

export function grantOutcome(data: unknown): GrantOutcome | null {
  const parsed = StaffAccessGrantResponseSchema.safeParse(data);
  if (!parsed.success) return null;
  const { row, temporaryPassword } = parsed.data;
  return temporaryPassword
    ? { kind: "password", password: temporaryPassword, row }
    : { kind: "existing", row };
}

export type GrantRefusal =
  | { kind: "stepUp"; stepUpUrl: string }
  | { kind: "unverified" }
  | { kind: "ambiguous" }
  | { kind: "alreadyComplete" }
  /** The event the person is bound to, read off the loaded list when it holds it. */
  | { kind: "boundElsewhere"; eventTitle: string | null }
  | { kind: "eventNotFound" }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "generic" };

/**
 * How a refused grant reads at the form (EARS-3, EARS-8). The API names a
 * registrar bound elsewhere by its code only; the list the administrator is
 * looking at holds that binding, so the form names the event from it.
 */
export function grantRefusal(
  error: unknown,
  context: { email: string; rows: readonly StaffAccessRow[] },
): GrantRefusal {
  if (isStepUpRequired(error)) {
    return { kind: "stepUp", stepUpUrl: error.stepUpUrl };
  }
  const { statusCode, errorCode } =
    typeof error === "object" && error !== null
      ? (error as { statusCode?: unknown; errorCode?: unknown })
      : {};
  switch (errorCode) {
    case "STAFF_GRANT_EMAIL_UNVERIFIED":
      return { kind: "unverified" };
    case "STAFF_GRANT_EMAIL_AMBIGUOUS":
      return { kind: "ambiguous" };
    case "GRANT_ALREADY_COMPLETE":
      return { kind: "alreadyComplete" };
    case "EVENT_NOT_FOUND":
      return { kind: "eventNotFound" };
    case "REGISTRAR_BOUND_ELSEWHERE": {
      const email = context.email.trim().toLowerCase();
      const binding = context.rows.find(
        (row) =>
          row.role === "event-registrar" &&
          row.email?.toLowerCase() === email &&
          row.eventTitle,
      );
      return {
        kind: "boundElsewhere",
        eventTitle: binding?.eventTitle ?? null,
      };
    }
  }
  if (statusCode === 503) return { kind: "unavailable" };
  if (statusCode === 403) return { kind: "forbidden" };
  if (statusCode === 400) return { kind: "invalid" };
  return { kind: "generic" };
}

// ── «Мероприятие» ───────────────────────────────────────────────────────────

export interface StaffAccessEventOption {
  id: string;
  title: string;
  /** «<название> · <дата МСК>» — two events of one title stay apart. */
  label: string;
}

/**
 * One server page of the event selector: the operator event list
 * (`GET /v1/admin/events`, title/slug search), which a platform administrator —
 * the only caller of this section — reads.
 */
/** The slice of the operator event list the selector reads (title, date, id). */
const EventPickerPageSchema = EventAdminListSchema.pick({
  total: true,
  page: true,
}).extend({
  data: z.array(
    EventAdminListItemSchema.pick({ id: true, title: true, startsAt: true }),
  ),
});

export async function fetchStaffAccessEventPage(
  { q, page, pageSize }: { q: string; page: number; pageSize: number },
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ data: StaffAccessEventOption[]; total: number; page: number }> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (q.trim()) params.set("q", q.trim());
  const res = await fetchImpl(`/v1/admin/events?${params.toString()}`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`event list: HTTP ${res.status}`);
  const answer = EventPickerPageSchema.parse(await res.json());
  return {
    data: answer.data.map((event) => ({
      id: event.id,
      title: event.title,
      label: `${event.title} · ${formatMskDateTime(event.startsAt)}`,
    })),
    total: answer.total,
    page: answer.page,
  };
}
