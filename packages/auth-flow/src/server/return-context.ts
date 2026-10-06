import {
  MOSCOW_TIME_ZONE,
  PublicEventPageSchema,
  RETURN_TARGET_PREFIX,
  formatEventTime,
  parseLandOnlyReturnTarget,
  parseReturnTarget,
  type PublicEventPage,
} from "@ds/schemas";

import { parseAccountReturnTarget } from "../return-target";
import {
  RETURN_CONTEXT_PARAM,
  resolveCarriedReturnTarget,
  resolveRoomReturnTarget,
  withReturnContext,
  type ReturnContextHost,
} from "../return-context-href";
import { serverApiBase } from "./session";

/**
 * The carry-vocabulary helpers live one level up, in a module with no server
 * import in its graph: the confirmation step is a CLIENT component and
 * hops through the same rule S3 value. Re-exported here so `@ds/auth-flow/server`
 * keeps its shipped surface - one implementation, two entry points.
 */
export {
  RETURN_CONTEXT_PARAM,
  resolveCarriedReturnTarget,
  resolveRoomReturnTarget,
  withReturnContext,
  type ReturnContextHost,
};

/**
 * 021 EARS-2 (#1538) / wave-1 gate row 46 - the RETURN CONTEXT a visitor arrived
 * with, resolved on the SERVER by the package (#2027 PR 1.5; was the doctor
 * host lib/return-context.ts).
 *
 * A visitor who pressed «Участвовать» on a gated эфир reaches a door carrying the
 * CANONICAL return target - `?returnTo=/webinars/<slug>`, the one vocabulary 005
 * EARS-2 defined and 021 LD-3 mandates - and the door shows them, beside the
 * form, exactly what they will come back to. This module is the resolution half:
 * `returnTo` -> `parseReturnTarget` -> the public event read -> the card projection.
 *
 * ONE RETURN VOCABULARY, ONE PARSER. `parseReturnTarget` (`@ds/schemas`) is the
 * single entry point - simultaneously the open-redirect guard and the slug
 * extractor; the account family is answered by the shared
 * `parseAccountReturnTarget` against the host config `routes.account`.
 * What differs per host is DATA (`routes.account`, `routes.eventPathTemplate`),
 * never a second parser.
 *
 * WHY THE PUBLIC EVENT READ. `GET /v1/public/events/:idOrSlug` is the same
 * `access: public` read the event page uses; a door-specific read would be a
 * second answer to «what is this event».
 *
 * FAILURE IS ABSENCE, NEVER AN EMPTY FRAME. No `returnTo`, a rejected one, an
 * unknown event, a body that fails the contract or an api that is down all
 * resolve to `null`, and the caller renders no slot at all - a door must never
 * be taken down by the decoration beside it.
 */

/** What the return-context card needs - nothing more than the card renders. */
export interface ReturnContextEvent {
  /** Start time formatted in `Europe/Moscow`, e.g. `19:00`. */
  time: string;
  /** «day · weekday» sub-label in `Europe/Moscow`, e.g. `27 августа · чт`. */
  dateLabel: string;
  school: string;
  title: string;
  specialties: readonly string[];
  speakers: readonly { name: string; org?: string }[];
}

/**
 * Both helpers are projections of the one event-time formatter
 * (`formatEventTime`, `@ds/schemas`) pinned to `Europe/Moscow`: this render is
 * a fact about the event, not about where the reader sits (021 EARS-12).
 */
export function formatMskTime(startsAt: string): string {
  return formatEventTime({ startsAt, viewerZone: MOSCOW_TIME_ZONE }).time;
}

/** «27 августа · чт» — the card's day sub-label. */
export function formatMskDateLabel(startsAt: string): string {
  const { date, weekdayShort } = formatEventTime({
    startsAt,
    viewerZone: MOSCOW_TIME_ZONE,
  });
  return `${date} · ${weekdayShort}`;
}

/** The card projection of the public event read. */
export function toReturnContextEvent(
  page: PublicEventPage,
): ReturnContextEvent {
  return {
    time: formatMskTime(page.startsAt),
    dateLabel: formatMskDateLabel(page.startsAt),
    school: page.school,
    title: page.title,
    specialties: page.specialties,
    // Name-only speaker projection (no PII, no credentials).
    speakers: page.speakers.map((speaker) => ({ name: speaker.name })),
  };
}

/**
 * 021 EARS-3 / LD-3 - the SAFE эфир return target of an arrival (the guard
 * reconstruction, never the raw param), or `null`. эфир-only by contract (#1987).
 */
export function resolveReturnTargetPath(
  returnTo: string | undefined,
): string | null {
  return parseReturnTarget(returnTo)?.returnTo ?? null;
}

/**
 * The public event read of an arrival, in the three answers its callers tell
 * apart (021 EARS-10, #2455): the page answers, the эфир no longer exists, or
 * the read could not tell. `null` when the arrival names no эфир at all.
 * `fetchImpl` is injected for tests.
 */
export type ReturnEventRead =
  | { status: "found"; event: ReturnContextEvent }
  | { status: "gone" }
  | { status: "unavailable" };

export async function readReturnEvent(
  returnTo: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReturnEventRead | null> {
  // The parser is the guard: an unsafe target never reaches the read.
  const intent = parseReturnTarget(returnTo);
  if (!intent) return null;

  try {
    const res = await fetchImpl(
      `${serverApiBase()}/v1/public/events/${encodeURIComponent(intent.eventSlug)}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
    // 004 EARS-6 — not-found is the one answer that means «no longer exists»;
    // any other failure says nothing about existence (021 EARS-10, #2455).
    if (res.status === 404) return { status: "gone" };
    if (!res.ok) return { status: "unavailable" };
    const parsed = PublicEventPageSchema.safeParse(await res.json());
    if (!parsed.success) return { status: "unavailable" };
    return { status: "found", event: toReturnContextEvent(parsed.data) };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Resolve the raw `returnTo` value to a card projection, or `null` when there is
 * nothing honest to show. `fetchImpl` is injected for tests.
 */
export async function resolveReturnContext(
  returnTo: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReturnContextEvent | null> {
  const read = await readReturnEvent(returnTo, fetchImpl);
  return read?.status === "found" ? read.event : null;
}

/**
 * Rule S4 - does this arrival name a page of THIS host account family? Asked
 * of the codec (every path under `routes.account`), never by comparing with the
 * cabinet index.
 */
export function isAccountReturnTarget(
  host: ReturnContextHost,
  returnTo: string | undefined,
): boolean {
  return parseAccountReturnTarget(returnTo, host.routes.account) !== null;
}

/**
 * 006 EARS-6 - does this arrival name THIS host room? Like the account family, a
 * room return is a landing in its own right: it resolves no эфир card, and the
 * room gate re-runs when the doctor arrives back on it.
 */
export function isRoomReturnTarget(
  host: ReturnContextHost,
  returnTo: string | undefined,
): boolean {
  return resolveRoomReturnTarget(host, returnTo) !== null;
}

/**
 * 014 EARS-6 amendment 2026-09-30 (#2487) - is this arrival a LAND-ONLY эфир
 * return (the shell header's sign-in)? Like a room or account return it is a
 * landing in its own right: it resolves no эфир card, registers nothing, and the
 * door lands the visitor back on the event page.
 */
export function isLandOnlyReturnTarget(returnTo: string | undefined): boolean {
  return parseLandOnlyReturnTarget(returnTo) !== null;
}

/**
 * 021 #1945 / #1987 - the host LANDING for an arrival return target (the path
 * the host NAVIGATES to once the door is passed), or `null`.
 *
 * The canonical target and the landing are two facts. The academy shape
 * `/webinars/<slug>` is re-homed onto THIS host event route by rebuilding the
 * path from the guard-validated slug through `routes.eventPathTemplate` (the
 * doctor host serves the same эфир at `/events/<slug>`; on the Academy the
 * template is the canonical shape itself). The account family is answered first
 * against `routes.account`, then this host room against `routes.room`. A target that is already a host path (the doctor
 * feed `/events?...&resume=<slug>`) passes through verbatim.
 */
export function resolveReturnLandingPath(
  host: ReturnContextHost,
  returnTo: string | undefined,
): string | null {
  const account = parseAccountReturnTarget(returnTo, host.routes.account);
  if (account) return account;

  // 006 EARS-6 - this host room, answered before the эфир vocabulary.
  const room = resolveRoomReturnTarget(host, returnTo);
  if (room) return room;

  // 014 EARS-6 amendment 2026-09-30 (#2487) — a land-only return lands on its
  // event page, re-homed like an intent; the completion (not this landing) is
  // what keeps it from registering.
  const landOnly = parseLandOnlyReturnTarget(returnTo);
  const intent = parseReturnTarget(landOnly ? landOnly.page : returnTo);
  if (!intent) return null;
  return intent.returnTo.startsWith(RETURN_TARGET_PREFIX)
    ? host.routes.eventPathTemplate.replace(":slug", intent.eventSlug)
    : intent.returnTo;
}
