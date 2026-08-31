import type { MyEventItem, MyEvents, MyEventsTab } from "@ds/schemas";
import type { EventListItem } from "@ds/design-system/blocks";

import {
  formatMskDayLabel,
  formatMskMonth,
  formatMskParts,
  formatMskWeekdayShort,
  mskDayKey,
  mskMonthKey,
} from "./msk";
import { resolveRoomEntryHref, type ForwardedSession } from "./registration-state";
import { toCanvasStatus } from "./event-lifecycle";

/**
 * 005 EARS-6 / 014 EARS-9 — the `MyEvents` read composed onto the «Мои события»
 * surface, a SEPARATE authenticated read like {@link fetchEventRegistrationState}.
 *
 * `GET /v1/me/events?tab=upcoming|recordings` is `doctor_guest`-authenticated
 * (EARS-10): the surface is server-rendered, so this runs on the server and
 * forwards the incoming request's session cookie AND its fingerprint headers (the
 * BFF session is fingerprint-bound, ADR-0001 §6 — a server-to-server read must
 * present the same `user-agent` + `accept-language` the browser bound at login, or
 * the api 401s a valid session). The upstream is the same env-driven
 * `API_PROXY_TARGET` the rest of the portal's server reads use — never a
 * hardcoded host.
 */
const API_BASE = (process.env.API_PROXY_TARGET ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);

/**
 * The read outcome the «Мои события» page renders from:
 *   • `{ authenticated: true, events }` — the `MyEvents` envelope for the requested
 *     tab (`{ tab, data, counts }`; `data` may be `[]`, which renders the tab's
 *     empty-state, EARS-6/EARS-12), the `counts` feeding BOTH tab chips so the
 *     other tab's number is right without a second read;
 *   • `{ authenticated: false }` — no/expired session (401) or no cookie rode the
 *     request; the page redirects the guest to login (the surface is authenticated,
 *     unlike the public 004 pages).
 */
export type MyEventsResult =
  | { readonly authenticated: true; readonly events: MyEvents }
  | { readonly authenticated: false };

/**
 * Read one tab of the calling doctor's `MyEvents` envelope, forwarding the
 * request's session cookie + fingerprint headers. A missing cookie or a 401
 * collapses to `{ authenticated: false }` (the page sends the guest to login); an
 * empty `data` array is a valid authenticated result (the empty-state). Per-user
 * ⇒ never shared-cacheable (`cache: "no-store"`), keeping this out of the data
 * cache that backs the public projections (design §5).
 */
export async function fetchMyEvents(
  session: ForwardedSession,
  tab: MyEventsTab = "upcoming",
): Promise<MyEventsResult> {
  // No session cookie rode the request → a guest; never issue the authed read.
  if (!session.cookie) return { authenticated: false };

  const res = await fetch(`${API_BASE}/v1/me/events?tab=${tab}`, {
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      // Forward the fingerprint surface (ADR-0001 §6) — without it the api
      // re-derives a different fingerprint and 401s a valid session.
      "user-agent": session.userAgent,
      "accept-language": session.acceptLanguage,
    },
    // Per-user, authenticated — MUST NOT be shared-cached (design §5).
    cache: "no-store",
  });
  if (res.status === 401) return { authenticated: false };
  if (!res.ok) {
    throw new Error(`my events fetch failed (${res.status})`);
  }
  return { authenticated: true, events: (await res.json()) as MyEvents };
}

/** Copy the pure row→card projection needs; every string comes from the catalog. */
export interface MyEventListCopy {
  readonly cardTz: string;
  readonly dateLabel: (parts: { date: string; weekday: string }) => string;
  readonly live: string;
  readonly recordingLabel: (
    state: NonNullable<MyEventItem["recording"]>["state"],
  ) => string;
  readonly recordingCta: string;
  readonly roomCta: string;
}

/**
 * Project the `MyEvents` rows of ONE tab onto the shared `EventList` block's item
 * shape (014 EARS-9). Pure — the single unit the «Мои события» surface renders,
 * unit-tested independent of any browser.
 *
 * Grouping mirrors the public listing so the two feeds share one rhythm: the
 * **Предстоящие** tab is grouped by Europe/Moscow calendar DAY (the server's
 * nearest-first order preserved, EARS-6/EARS-11), the **Записи** tab by МСК MONTH
 * over the newest-first history. Both keys come from `lib/msk`, never recomputed
 * here, so the grouping can never drift to the viewer's timezone.
 *
 * A `live` row is one of the caller's OWN registrations (the read returns only
 * registered events), so it admits the doctor into the room through the hardened
 * {@link resolveRoomEntryHref} — the same open-redirect defence as the event-page
 * CTA (006 EARS-6). An `ended` row's CTA leads back to its event page, where the
 * recording lives; its badge carries the recording state (including `preparing`
 * for an ended event whose recording is not published yet).
 */
export function buildMyEventListItems(
  events: readonly MyEventItem[],
  tab: MyEventsTab,
  copy: MyEventListCopy,
): EventListItem[] {
  const past = tab === "recordings";
  return events.map((event) => {
    const parts = formatMskParts(event.startsAt);
    const roomEntryHref = past
      ? null
      : resolveRoomEntryHref(
          { registered: true },
          toCanvasStatus(event.state),
          event.slug,
        );
    const href = `/webinars/${event.slug}`;
    return {
      id: event.eventId,
      groupKey: past ? mskMonthKey(event.startsAt) : mskDayKey(event.startsAt),
      groupLabel: past
        ? formatMskMonth(event.startsAt)
        : formatMskDayLabel(event.startsAt),
      href,
      time: parts.time,
      tzLabel: copy.cardTz,
      dateLabel: copy.dateLabel({
        date: parts.date,
        weekday: formatMskWeekdayShort(event.startsAt),
      }),
      school: event.school,
      title: event.title,
      live: !past && event.state === "live",
      liveLabel: copy.live,
      recordingLabel: event.recording
        ? copy.recordingLabel(event.recording.state)
        : undefined,
      variant: past ? ("past" as const) : ("upcoming" as const),
      ctaHref: past ? href : (roomEntryHref ?? undefined),
      ctaLabel: past
        ? copy.recordingCta
        : roomEntryHref
          ? copy.roomCta
          : undefined,
    };
  });
}
