import {
  DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS,
  type DoctorEventsFeed,
  DoctorEventsFeedSchema,
  encodeDoctorEventsFeedQueryEntries,
  type RawQueryValue,
} from "@ds/schemas";
import { API_BASE } from "@/lib/session";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "@/lib/specialty-choice";

/**
 * 019 EARS-3 (#1518) — the storefront half of the day-grouped feed read.
 *
 * The URL IS the feed state (EARS-8/LD-1): this module decodes the incoming
 * search params with the SHARED codec from `@ds/schemas` — the same function the
 * api controller decodes with — re-encodes exactly what it understood, and hands
 * the result to `GET /v1/storefront/doctor/events`. There is no client-side
 * query model, no local paging state and no second listing engine: «показать
 * ещё» is a LINK that widens `to=` in the address bar (EARS-15).
 *
 * The read is server-side and absolute against `API_BASE`, forwarding ONLY
 * 017's remembered-specialty cookie (`__Host-ds_specialty`) so the targeting
 * resolver has what it needs and nothing else travels with a public read. A guest with no remembered choice gets the
 * untargeted feed — the surface is fully readable with no account (EARS-12).
 */
export const DOCTOR_EVENTS_FEED_PATH = "/v1/storefront/doctor/events";

/** What the route needs to render, including the honest failure branch (EARS-9). */
export type DoctorEventsFeedResult =
  | { ok: true; feed: DoctorEventsFeed }
  | { ok: false; reason: "unavailable" };

/**
 * 019 EARS-8 (#1523) — the host adapter, and nothing more.
 *
 * Both halves of the round-trip (decode the URL, re-encode exactly what was
 * understood) live on the ONE portable codec in `@ds/schemas`
 * (`event-listing-query.schema.ts` + the doctor field table). The codec returns
 * ORDERED wire entries because `@ds/schemas` is platform-free by contract; the
 * only thing this host adds is the `URLSearchParams` those entries go into.
 * That single line is the whole adapter — any query grammar re-implemented here
 * would be the EARS-15 «second listing engine» failure in its cheapest form.
 */
export function encodeDoctorEventsFeedQuery(
  raw: Record<string, RawQueryValue>,
): URLSearchParams {
  return new URLSearchParams(encodeDoctorEventsFeedQueryEntries(raw));
}

/**
 * The ONLY cookie this read needs is 017's remembered specialty; the session
 * cookie and everything else stay in the browser rather than travelling with an
 * unauthenticated public read.
 */
function specialtyCookieOnly(cookie: string | null): string {
  if (cookie === null) return "";
  return (cookie.split(";").find(
    (pair) => pair.trim().startsWith(`${SPECIALTY_CHOICE_COOKIE_NAME}=`),
  ) ?? "").trim();
}

export async function fetchDoctorEventsFeed(
  headers: Headers,
  raw: Record<string, RawQueryValue>,
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorEventsFeedResult> {
  const params = encodeDoctorEventsFeedQuery(raw);
  const url = `${API_BASE}${DOCTOR_EVENTS_FEED_PATH}?${params.toString()}`;

  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        cookie: specialtyCookieOnly(headers.get("cookie")),
        "user-agent": headers.get("user-agent") ?? "",
        "accept-language": headers.get("accept-language") ?? "",
      },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    // Validated against the SSOT rather than cast: a body that broke the
    // day-group contract is an error render, never a half-drawn feed.
    return { ok: true, feed: DoctorEventsFeedSchema.parse(await res.json()) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The href «показать ещё» points at — the CURRENT URL with `from`/`to` widened
 * to the horizon the server named. The control is a link precisely so the
 * extended range is shareable and survives the back button (EARS-8).
 */
export function showMoreHref(
  raw: Record<string, RawQueryValue>,
  feed: DoctorEventsFeed,
): string | null {
  if (feed.nextTo === null) return null;
  // Widen the horizon THROUGH the codec, not with `params.set` afterwards:
  // `set` appends when the key is absent, so a link built from a URL that
  // carried no `from`/`to` would emit the horizon keys last instead of in
  // field-table positions 3-4. The feature's headline property is that the same
  // state always yields the same, comparable URL, and this is the one link the
  // feature writes.
  const params = new URLSearchParams(
    encodeDoctorEventsFeedQueryEntries({
      ...raw,
      from: feed.from,
      to: feed.nextTo,
    }),
  );
  return `/events?${params.toString()}`;
}

/** The horizon step, re-exported so the route copy and the test read one number. */
export { DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS };
