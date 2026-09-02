import {
  PublicEventPageSchema,
  parseReturnTarget,
  type PublicEventPage,
} from "@ds/schemas";

import { API_BASE } from "./session";

/**
 * 021 EARS-2 (#1538) — resolving the RETURN CONTEXT the doctor arrived with.
 *
 * A doctor who pressed «Участвовать» on a gated эфир lands on `/register`
 * carrying the CANONICAL return target — `?returnTo=/webinars/<slug>`, the one
 * vocabulary 005 EARS-2 defined and 021 LD-3 mandates — and the surface then
 * shows them, beside the form, exactly what they will come back to. This module
 * is the resolution half of that: `returnTo` → `parseReturnTarget` → the public
 * event read → the card projection the shared `WebinarCard` renders.
 *
 * ONE RETURN VOCABULARY, ONE PARSER. The value is never read as a slug and never
 * pattern-matched here: `parseReturnTarget` (`@ds/schemas`, 005 EARS-2) is the
 * SINGLE entry point, and it is simultaneously the open-redirect guard and the
 * slug extractor — it accepts a value only when it resolves to exactly
 * `/webinars/<slug>` and hands back `{ eventSlug, returnTo }`. A storefront-local
 * guard or a second param name would be a forked security control (021 design,
 * «the return target»), so this module owns neither.
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
 * FAILURE IS ABSENCE, NEVER AN EMPTY FRAME. No `returnTo`, a `returnTo` the
 * parser rejects, one naming an event that does not resolve,
 * a body that fails the contract, or an api that is down all resolve to `null`,
 * and the caller renders no slot at all (EARS-3's honest-empty rule, and the
 * requirements invariant «absent rather than rendered empty»). A registration
 * form must never be taken down by the decoration beside it, so the fetch
 * failure is swallowed into `null` rather than thrown into the route.
 */

/**
 * The canonical return-target search param (005 EARS-2 / 021 LD-3). The gate and
 * the 003 auth round-trip already speak `returnTo`; this route reads the same
 * name so a single URL serves both the return context shown here and the
 * post-verification navigation, and never two params meaning one thing.
 */
export const RETURN_CONTEXT_PARAM = "returnTo";

/** What the return-context card needs — nothing more than the card renders. */
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
  // Some ICU builds emit the `ru-RU` short weekday with a trailing period
  // («чт.»), others without; `apps/portal/lib/msk.ts` strips it for exactly that
  // reason. The canvas sub-label is «27 августа · чт», so the same
  // normalization runs here — otherwise the two surfaces render different
  // strings for one instant depending on the runtime's ICU.
  const weekday = WEEKDAY_FORMAT.format(at).replace(/\.$/, "");
  return `${DAY_FORMAT.format(at)} · ${weekday}`;
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
 * Resolve the raw `returnTo` value to a card projection, or `null` when there is
 * nothing honest to show. `fetchImpl` is injected for tests, exactly as
 * `fetchScaleStatistics` / `fetchSessionClaims` do it.
 */
export async function resolveReturnContext(
  returnTo: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReturnContextEvent | null> {
  // The parser is the guard: an absent, cross-origin, traversal or otherwise
  // unsafe target never reaches the read, and a safe one yields the slug.
  const intent = parseReturnTarget(returnTo);
  if (!intent) return null;
  const key = intent.eventSlug;

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
