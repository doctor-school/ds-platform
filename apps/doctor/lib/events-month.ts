import {
  type DoctorEventsMonthGrid,
  DoctorEventsMonthGridSchema,
  parseDoctorEventsMonthQuery,
  type RawQueryValue,
} from "@ds/schemas";
import { API_BASE } from "@/lib/session";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "@/lib/specialty-choice";

/**
 * 019 EARS-4 (#1519) — the storefront half of the month read that stands the
 * calendar BESIDE the day feed (F-019-2 Б).
 *
 * The month grid is NAVIGATION over the same targeted read, never a second
 * listing engine (EARS-15): it decodes the incoming search params with the
 * SHARED codec `parseDoctorEventsMonthQuery` — which itself delegates the facet
 * half to the feed's codec — re-encodes exactly what it understood, and hands
 * that to `GET /v1/storefront/doctor/events/month`. The counts the grid paints
 * are therefore the feed's own day-group sizes for the same facets, and no
 * client-side month assembly exists to drift from them.
 *
 * Cookie forwarding matches `events-feed.ts` exactly: ONLY 017's remembered
 * specialty travels with the public read, so a guest with no remembered choice
 * gets the untargeted month (EARS-12).
 */
export const DOCTOR_EVENTS_MONTH_PATH = "/v1/storefront/doctor/events/month";

/**
 * What the route needs to render the pane. A failed month read is NOT a failed
 * screen: the feed is the body and the calendar is navigation over it, so an
 * unavailable month drops the pane rather than erroring the route (EARS-9, and
 * the canvas's own «Календарь и остальные блоки работают» division of labour
 * read the other way round).
 */
export type DoctorEventsMonthResult =
  | { ok: true; grid: DoctorEventsMonthGrid }
  | { ok: false; reason: "unavailable" };

/**
 * Re-encode the search params the shared month codec understood. Anything it
 * did not understand is DROPPED rather than forwarded, so a hand-edited URL
 * cannot smuggle an unknown parameter into the api read. `tense`, `day`, `from`
 * and `to` are absent by contract — the horizon of this read IS the month.
 */
export function encodeDoctorEventsMonthQuery(
  raw: Record<string, RawQueryValue>,
): URLSearchParams {
  const params = new URLSearchParams();
  const parsed = parseDoctorEventsMonthQuery(raw);
  if (!parsed.success) return params;

  const query = parsed.data;
  if (query.month) params.set("month", query.month);
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

/** See `events-feed.ts` — the same single-cookie rule, kept literally identical. */
function specialtyCookieOnly(cookie: string | null): string {
  if (cookie === null) return "";
  return (
    cookie
      .split(";")
      .find((pair) => pair.trim().startsWith(`${SPECIALTY_CHOICE_COOKIE_NAME}=`)) ??
    ""
  ).trim();
}

export async function fetchDoctorEventsMonthGrid(
  headers: Headers,
  raw: Record<string, RawQueryValue>,
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorEventsMonthResult> {
  const params = encodeDoctorEventsMonthQuery(raw);
  const url = `${API_BASE}${DOCTOR_EVENTS_MONTH_PATH}?${params.toString()}`;

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
    // every-day-present contract would otherwise paint a half-drawn month.
    return {
      ok: true,
      grid: DoctorEventsMonthGridSchema.parse(await res.json()),
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
