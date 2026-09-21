import {
  PublicEventPageSchema,
  RETURN_TARGET_PREFIX,
  parseReturnTarget,
  type PublicEventPage,
} from "@ds/schemas";

import { parseAccountReturnTarget } from "../return-target";
import {
  RETURN_CONTEXT_PARAM,
  resolveCarriedReturnTarget,
  withReturnContext,
  type ReturnContextHost,
} from "../return-context-href";
import { serverApiBase } from "./session";

/**
 * The carry-vocabulary helpers live one level up, in a module with no server
 * import in its graph: the inline confirmation step is a CLIENT component and
 * hops through the same rule S3 value. Re-exported here so `@ds/auth-flow/server`
 * keeps its shipped surface - one implementation, two entry points.
 */
export {
  RETURN_CONTEXT_PARAM,
  resolveCarriedReturnTarget,
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

const MSK = "Europe/Moscow";

/**
 * Both formatters pin `timeZone` explicitly: this render is a fact about the
 * event, not about where the reader sits (021 EARS-12).
 */
const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const DAY_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK,
  day: "numeric",
  month: "long",
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK,
  weekday: "short",
});

export function formatMskTime(startsAt: string): string {
  return TIME_FORMAT.format(new Date(startsAt));
}

export function formatMskDateLabel(startsAt: string): string {
  const at = new Date(startsAt);
  // Some ICU builds emit the ru-RU short weekday with a trailing period
  // («чт.»), others without; the canvas sub-label is «27 августа · чт».
  const weekday = WEEKDAY_FORMAT.format(at).replace(/\.$/, "");
  return `${DAY_FORMAT.format(at)} · ${weekday}`;
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
 * Resolve the raw `returnTo` value to a card projection, or `null` when there is
 * nothing honest to show. `fetchImpl` is injected for tests.
 */
export async function resolveReturnContext(
  returnTo: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReturnContextEvent | null> {
  // The parser is the guard: an unsafe target never reaches the read.
  const intent = parseReturnTarget(returnTo);
  if (!intent) return null;

  try {
    const res = await fetchImpl(
      `${serverApiBase()}/v1/public/events/${encodeURIComponent(intent.eventSlug)}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const parsed = PublicEventPageSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return toReturnContextEvent(parsed.data);
  } catch {
    return null;
  }
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
 * 021 #1945 / #1987 - the host LANDING for an arrival return target (the path
 * the host NAVIGATES to once the door is passed), or `null`.
 *
 * The canonical target and the landing are two facts. The academy shape
 * `/webinars/<slug>` is re-homed onto THIS host event route by rebuilding the
 * path from the guard-validated slug through `routes.eventPathTemplate` (the
 * doctor host serves the same эфир at `/events/<slug>`; on the Academy the
 * template is the canonical shape itself). The account family is answered first
 * against `routes.account`. A target that is already a host path (the doctor
 * feed `/events?...&resume=<slug>`) passes through verbatim.
 */
export function resolveReturnLandingPath(
  host: ReturnContextHost,
  returnTo: string | undefined,
): string | null {
  const account = parseAccountReturnTarget(returnTo, host.routes.account);
  if (account) return account;

  const intent = parseReturnTarget(returnTo);
  if (!intent) return null;
  return intent.returnTo.startsWith(RETURN_TARGET_PREFIX)
    ? host.routes.eventPathTemplate.replace(":slug", intent.eventSlug)
    : intent.returnTo;
}
