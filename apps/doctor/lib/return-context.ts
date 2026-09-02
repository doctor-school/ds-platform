import { PublicEventPageSchema, type PublicEventPage } from "@ds/schemas";

import { API_BASE } from "./session";

/**
 * 021 EARS-2 (#1538) — resolving the RETURN CONTEXT the doctor arrived with.
 *
 * A doctor who pressed «Участвовать» on a gated эфир lands on `/register` with
 * the event carried in the URL (`?from=<slug-or-id>`); the surface then shows
 * them, beside the form, exactly what they will come back to. This module is
 * the resolution half of that: URL param → the public event read → the card
 * projection the shared `WebinarCard` renders.
 *
 * WHY THE PUBLIC EVENT READ AND NOT A 021-LOCAL ENDPOINT. `GET /v1/public/
 * events/:idOrSlug` is the same `access: public` read the 020 event page uses,
 * and it already answers by slug OR id, already refuses drafts as not-found and
 * already carries no per-viewer state. A registration-specific read would be a
 * second answer to «what is this event» — the divergence AGENTS.md §6 forbids.
 * The richer 019 card payload (format kicker, Pul cost, sign-up count, seats)
 * arrives with the 019 guest hand-off contract (#1527); until it lands the card
 * simply renders the facts this read carries, and the ones it does not are
 * ABSENT rather than filled with a stand-in.
 *
 * FAILURE IS ABSENCE, NEVER AN EMPTY FRAME. No `from`, an unresolvable `from`,
 * a body that fails the contract, or an api that is down all resolve to `null`,
 * and the caller renders no slot at all (EARS-3's honest-empty rule, and the
 * requirements invariant «absent rather than rendered empty»). A registration
 * form must never be taken down by the decoration beside it, so the fetch
 * failure is swallowed into `null` rather than thrown into the route.
 */

/** The URL search param the 019 gate hand-off carries the event in. */
export const RETURN_CONTEXT_PARAM = "from";

/** What the return-context card needs — nothing more than the card renders. */
export interface ReturnContextEvent {
  /** Start time formatted in `Europe/Moscow`, e.g. `19:00`. */
  time: string;
  /** «day · weekday» sub-label in `Europe/Moscow`, e.g. `28 августа · чт`. */
  dateLabel: string;
  school: string;
  title: string;
  specialties: readonly string[];
  speakers: readonly { name: string; org?: string }[];
}

const MSK = "Europe/Moscow";

/**
 * The МСК wall-clock of an instant. Both formatters pin `timeZone` explicitly:
 * this render is a fact about the event, not about where the reader sits, so it
 * must not drift to the server's or the browser's zone (EARS-12).
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
  // `ru-RU` short weekdays come back as «чт» already; the canvas sub-label is
  // «28 августа · чт», so the two parts are joined, never re-cased.
  return `${DAY_FORMAT.format(at)} · ${WEEKDAY_FORMAT.format(at)}`;
}

/** The card projection of the public event read. */
export function toReturnContextEvent(page: PublicEventPage): ReturnContextEvent {
  return {
    time: formatMskTime(page.startsAt),
    dateLabel: formatMskDateLabel(page.startsAt),
    school: page.school,
    title: page.title,
    specialties: page.specialties,
    // The card's speaker projection is name-only (no PII, no credentials), so
    // the page's richer speaker rows are narrowed here rather than passed on.
    speakers: page.speakers.map((speaker) => ({ name: speaker.name })),
  };
}

/**
 * Resolve the `from` param to a card projection, or `null` when there is
 * nothing honest to show. `fetchImpl` is injected for tests, exactly as
 * `fetchScaleStatistics` / `fetchSessionClaims` do it.
 */
export async function resolveReturnContext(
  from: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReturnContextEvent | null> {
  const key = from?.trim();
  if (!key) return null;

  try {
    const res = await fetchImpl(
      `${API_BASE}/v1/public/events/${encodeURIComponent(key)}`,
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
