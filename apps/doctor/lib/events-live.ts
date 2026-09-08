import {
  type DoctorEventsLiveRead,
  DoctorEventsLiveReadSchema,
} from "@ds/schemas";
import { API_BASE, forwardedHeaders, forwardedSessionFrom } from "@/lib/session";

/**
 * 019 EARS-6 (#1521) — the doctor storefront's half of the «Идёт сейчас» read.
 *
 * Unlike 019's feed read, which forwards ONLY 017's remembered-specialty cookie,
 * this read forwards the WHOLE cookie header — the specialty cookie AND the
 * session — for the same reason 020's participation read does: WHO is asking
 * changes the answer. The endpoint resolves the entry policy (the room for a
 * registered doctor, the event page for everyone else), so an anonymised read
 * would silently downgrade every signed-in doctor to the guest target. The
 * response is `Cache-Control: private, no-store` upstream and read `no-store`
 * here.
 *
 * The host branches on nothing: a guest issues the same read and gets the guest
 * answer, and `null` means «nothing targeted is running» — which the route turns
 * into NO block in the tree rather than an empty frame.
 */
export const DOCTOR_EVENTS_LIVE_PATH = "/v1/storefront/doctor/events/live";

/**
 * The strip, or `null` — including when the read itself fails.
 *
 * A transport failure degrades to «no block», never to an error surface: the
 * live strip is an ADDITIVE affordance above the feed (019-design §3 dataState
 * matrix — the live block is «not rendered» on загрузка and on ошибка), so a
 * server that did not answer must not take the events page down with it. The
 * CLIENT half keeps the last known strip across a blip; the SERVER half simply
 * starts without one.
 */
export async function fetchDoctorEventsLive(
  headers: Headers,
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorEventsLiveRead> {
  try {
    const res = await fetchImpl(`${API_BASE}${DOCTOR_EVENTS_LIVE_PATH}`, {
      // The whole forwarded surface (ADR-0001 §6 + the client chain, #2054):
      // since #1655 the api reads `request.ip` from `x-forwarded-for`, so an SSR
      // hop that drops it presents the container address.
      headers: forwardedHeaders(forwardedSessionFrom(headers)),
      cache: "no-store",
    });
    if (!res.ok) return null;
    // Validated against the SSOT rather than cast: a body that broke the
    // contract renders no strip at all, never a half-drawn one.
    return DoctorEventsLiveReadSchema.parse(await res.json());
  } catch {
    return null;
  }
}
