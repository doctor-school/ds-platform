import type { EventPageView, ParticipationCta } from "@ds/schemas";
import { API_BASE } from "@/lib/session";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "@/lib/specialty-choice";

/**
 * 020 EARS-1 (#1764, slice 3) — the doctor storefront's half of the shared
 * event-page read.
 *
 * Both reads go through the DOCTOR storefront envelope
 * (`/v1/storefront/doctor/events/:idOrSlug` + `…/participation`) rather than the
 * academy's public pair, because the envelope is the one thing that legitimately
 * differs per host: the api resolves the participation targets against THIS
 * host's route table (`/events/:slug`, its registration entry), so the CTA the
 * page renders leads somewhere that exists on doctor.school. The BODY of the
 * page read is the same `EventPageView` the academy gets — that identity is
 * EARS-18 and it is asserted end-to-end in the Playwright suite.
 *
 * The page is readable with NO account (EARS-1). Only 017's remembered-specialty
 * cookie travels with the page read, exactly as 019's feed read does; the
 * participation read additionally forwards the session, because WHO is asking
 * changes the answer (registered → «Вы записаны» / «Войти в эфир»).
 */

export const DOCTOR_EVENT_PAGE_PATH = "/v1/storefront/doctor/events";

/** The ONLY cookie the public page read needs — 017's remembered specialty. */
function specialtyCookieOnly(cookie: string | null): string {
  if (cookie === null) return "";
  return (
    cookie
      .split(";")
      .find((pair) => pair.trim().startsWith(`${SPECIALTY_CHOICE_COOKIE_NAME}=`)) ??
    ""
  ).trim();
}

/**
 * Fetch the shared `EventPageView`, or `null` when the event is not publicly
 * reachable (404 — draft or unknown), which the route turns into `notFound()`.
 *
 * Uncached: a lifecycle transition (`published → live → ended`) must surface on
 * the very next request, never after a timer window.
 */
export async function fetchDoctorEventPage(
  idOrSlug: string,
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<EventPageView | null> {
  const res = await fetchImpl(
    `${API_BASE}${DOCTOR_EVENT_PAGE_PATH}/${encodeURIComponent(idOrSlug)}`,
    {
      headers: {
        accept: "application/json",
        cookie: specialtyCookieOnly(headers.get("cookie")),
      },
      cache: "no-store",
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`doctor event page fetch failed (${res.status})`);
  return (await res.json()) as EventPageView;
}

/**
 * Fetch the server-resolved participation policy for this viewer on this event.
 * The endpoint is public with an OPTIONAL principal, so a guest issues the same
 * read and gets the guest answer — the host branches on nothing.
 *
 * The full session rides along (cookie + the fingerprint-bound surface headers,
 * ADR-0001 §6) because the answer is per-viewer; the response is
 * `Cache-Control: private, no-store` upstream and read `no-store` here.
 */
export async function fetchDoctorParticipationCta(
  idOrSlug: string,
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<ParticipationCta | null> {
  const cookie = headers.get("cookie");
  const res = await fetchImpl(
    `${API_BASE}${DOCTOR_EVENT_PAGE_PATH}/${encodeURIComponent(idOrSlug)}/participation`,
    {
      headers: {
        accept: "application/json",
        ...(cookie
          ? {
              cookie,
              "user-agent": headers.get("user-agent") ?? "",
              "accept-language": headers.get("accept-language") ?? "",
            }
          : {}),
      },
      cache: "no-store",
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`doctor participation cta fetch failed (${res.status})`);
  }
  return (await res.json()) as ParticipationCta;
}
