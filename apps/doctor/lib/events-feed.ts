import {
  DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS,
  type DoctorEventsFeed,
  DoctorEventsFeedSchema,
  parseDoctorEventsFeedQuery,
  type RawQueryValue,
} from "@ds/schemas";
import { API_BASE } from "@/lib/session";

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
 * The read is server-side and absolute against `API_BASE`, forwarding the
 * incoming `Cookie` header so 017's remembered specialty (`__Host-ds_specialty`)
 * reaches the targeting resolver. A guest with no remembered choice gets the
 * untargeted feed — the surface is fully readable with no account (EARS-12).
 */
export const DOCTOR_EVENTS_FEED_PATH = "/v1/storefront/doctor/events";

/** What the route needs to render, including the honest failure branch (EARS-9). */
export type DoctorEventsFeedResult =
  | { ok: true; feed: DoctorEventsFeed }
  | { ok: false; reason: "unavailable" };

/**
 * Re-encode the search params the shared codec understood. Anything it did not
 * understand is DROPPED rather than forwarded blindly, so a hand-edited URL can
 * never smuggle an unknown parameter into the api read.
 */
export function encodeDoctorEventsFeedQuery(
  raw: Record<string, RawQueryValue>,
): URLSearchParams {
  const params = new URLSearchParams();
  const parsed = parseDoctorEventsFeedQuery(raw);
  if (!parsed.success) return params;

  const query = parsed.data;
  if (query.day) params.set("day", query.day);
  params.set("tense", query.tense);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  for (const format of query.format) params.append("format", format);
  for (const kind of query.kind) params.append("kind", kind);
  if (Array.isArray(query.specialty)) {
    for (const reference of query.specialty) {
      params.append("specialty", reference);
    }
  } else {
    params.set("specialty", query.specialty);
  }
  for (const city of query.city) params.append("city", city);
  if (query.nmo !== undefined) params.set("nmo", String(query.nmo));
  if (query.free !== undefined) params.set("free", String(query.free));
  if (query.q !== undefined) params.set("q", query.q);
  return params;
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
        cookie: headers.get("cookie") ?? "",
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
  const params = encodeDoctorEventsFeedQuery(raw);
  params.set("from", feed.from);
  params.set("to", feed.nextTo);
  return `/events?${params.toString()}`;
}

/** The horizon step, re-exported so the route copy and the test read one number. */
export { DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS };
