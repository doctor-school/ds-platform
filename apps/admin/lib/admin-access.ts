import type { AdminSessionResponse } from "@ds/schemas";

/**
 * 044 EARS-20 / EARS-38 — what the admin app DRAWS for the signed-in principal,
 * derived from the `GET /v1/admin/auth/session` read (`roles` + `eventGrants`).
 *
 * A projection, never the authority: the server refuses a registrar on every
 * route but its bound event's desk (EARS-19/38), so a link this module hides is
 * still refused if reached directly, and one it draws is still checked on every
 * request. The module only keeps the chrome from offering a registrar sections
 * the server would refuse.
 *
 * - `platform_admin` → the full section set, not limited by any binding (EARS-38:
 *   «Роль платформенного администратора не ограничивается привязкой»).
 * - only `event-registrar` → exactly the roster of each bound event (the partial
 *   unique index keeps that at one), no events list, no other section; with no
 *   binding row → nothing at all.
 * - only `congress-program-committee` (046 EARS-31) → exactly the «Заявки»
 *   (submissions registry) of each bound event — a member may be bound to
 *   several — and nothing else; with no binding row → nothing at all.
 * - both coarse roles → the union, each grant opening only its own role's
 *   screen of its own event.
 * - an unreadable session (`null`) → nothing: fail closed, like
 *   `readAdminAuthState`.
 */

const PLATFORM_ADMIN = "platform_admin";
const EVENT_REGISTRAR = "event-registrar";
const PROGRAM_COMMITTEE = "congress-program-committee";

type EventRef = { eventId: string; eventSlug: string };

export interface AdminAccess {
  /** `platform_admin`: every section, every event. */
  readonly full: boolean;
  /** Events whose roster a registrar is bound to — ids and slugs both match. */
  readonly rosterEvents: ReadonlyArray<EventRef>;
  /** 046 EARS-31 — events whose submissions a committee member is bound to. */
  readonly committeeEvents: ReadonlyArray<EventRef>;
}

export interface AdminNavItem {
  href: string;
  testId: string;
  /** RU catalog key (`messages/ru.json`). */
  labelKey: string;
}

/** The platform administrator's sections, in the chrome's reading order. */
export const ADMIN_SECTION_NAV: readonly AdminNavItem[] = [
  { href: "/events", testId: "nav-events", labelKey: "app.nav.events" },
  { href: "/projects", testId: "nav-projects", labelKey: "app.nav.projects" },
  { href: "/experts", testId: "nav-experts", labelKey: "app.nav.experts" },
  { href: "/partners", testId: "nav-partners", labelKey: "app.nav.partners" },
  // 012 EARS-25 (#2509) — the event-kind dictionary classifies events, so it
  // sits with the event-side books, before directions and their relations.
  {
    href: "/event-kinds",
    testId: "nav-event-kinds",
    labelKey: "app.nav.eventKinds",
  },
  {
    href: "/directions",
    testId: "nav-directions",
    labelKey: "app.nav.directions",
  },
  // The two #1483 relation books sit next to the directions they relate.
  {
    href: "/direction-specialties",
    testId: "nav-direction-specialties",
    labelKey: "app.nav.directionSpecialties",
  },
  {
    href: "/direction-adjacency",
    testId: "nav-direction-adjacency",
    labelKey: "app.nav.directionAdjacency",
  },
  // The Минздрав book (017 EARS-19) closes the row: it is the vocabulary the
  // specialty links are drawn FROM.
  {
    href: "/specialties",
    testId: "nav-specialties",
    labelKey: "app.nav.specialties",
  },
];

const NO_ACCESS: AdminAccess = {
  full: false,
  rosterEvents: [],
  committeeEvents: [],
};

/** The bound events of one coarse role — only when the role itself is held. */
function grantsOf(session: AdminSessionResponse, role: string): EventRef[] {
  if (!session.roles.includes(role)) return [];
  return session.eventGrants
    .filter((grant) => grant.role === role)
    .map(({ eventId, eventSlug }) => ({ eventId, eventSlug }));
}

export function adminAccess(session: AdminSessionResponse | null): AdminAccess {
  if (!session) return NO_ACCESS;
  if (session.roles.includes(PLATFORM_ADMIN)) {
    return { ...NO_ACCESS, full: true };
  }
  return {
    full: false,
    rosterEvents: grantsOf(session, EVENT_REGISTRAR),
    committeeEvents: grantsOf(session, PROGRAM_COMMITTEE),
  };
}

export function adminNavItems(access: AdminAccess): AdminNavItem[] {
  if (access.full) return [...ADMIN_SECTION_NAV];
  return [
    ...access.rosterEvents.map(({ eventId }) => ({
      href: `/events/${eventId}/roster`,
      testId: "nav-roster",
      labelKey: "congressRoster.entryLink",
    })),
    ...access.committeeEvents.map(({ eventId }) => ({
      href: `/events/${eventId}/submissions`,
      testId: "nav-submissions",
      labelKey: "congressSubmissions.entryLink",
    })),
  ];
}

function boundTo(
  events: ReadonlyArray<EventRef>,
  event: string | undefined,
): boolean {
  if (!event) return false;
  return events.some(
    ({ eventId, eventSlug }) => eventId === event || eventSlug === event,
  );
}

/** Each bound-event screen, with the grant set that opens it. */
const EVENT_SCREENS: ReadonlyArray<{
  path: RegExp;
  resource: string;
  events: (access: AdminAccess) => ReadonlyArray<EventRef>;
}> = [
  {
    path: /^\/events\/([^/]+)\/roster\/?$/,
    resource: "congress-roster",
    events: (access) => access.rosterEvents,
  },
  // 046 EARS-31 — the programme committee's submissions registry.
  {
    path: /^\/events\/([^/]+)\/submissions\/?$/,
    resource: "congress-submissions",
    events: (access) => access.committeeEvents,
  },
];

/** May the chrome render this admin route's content for the principal? */
export function canAccessPath(access: AdminAccess, pathname: string): boolean {
  if (access.full) return true;
  return EVENT_SCREENS.some((screen) => {
    const match = screen.path.exec(pathname);
    return (
      match?.[1] !== undefined &&
      boundTo(screen.events(access), decodeURIComponent(match[1]))
    );
  });
}

/**
 * The Refine `can` answer — the roster resource is `congress-roster`, the
 * submissions registry `congress-submissions`, both keyed by event.
 */
export function canAccessResource(
  access: AdminAccess,
  resource: string | undefined,
  params?: { id?: string | number },
): boolean {
  if (access.full) return true;
  const screen = EVENT_SCREENS.find((entry) => entry.resource === resource);
  return (
    screen !== undefined &&
    boundTo(
      screen.events(access),
      params?.id === undefined ? undefined : String(params.id),
    )
  );
}

/**
 * The admin-tier landings: `/` (redirects to `/events`) and `/events`, where
 * every sign-in lands (`app/login`, `app/mfa/*`).
 */
const LANDING_PATHS = new Set(["/", "/events", "/events/"]);

/**
 * 044 EARS-20: where a principal whose access yields exactly ONE link lands.
 *
 * A registrar reaching an admin landing it may not open (the sign-in always
 * lands on `/events`) is sent straight to its one roster instead of a refusal
 * with one link to click. Any other refused route — a direct navigation — keeps
 * the refusal (EARS-38.7), and a principal with zero or several links is never
 * redirected: there is no single place that is obviously theirs.
 */
export function landingRedirect(
  access: AdminAccess,
  pathname: string,
): string | null {
  if (canAccessPath(access, pathname) || !LANDING_PATHS.has(pathname)) {
    return null;
  }
  const items = adminNavItems(access);
  return items.length === 1 ? items[0]!.href : null;
}
