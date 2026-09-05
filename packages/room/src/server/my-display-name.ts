import type { MyDisplayName } from "@ds/schemas";

import type { RoomServerReadOptions } from "./room-config";
import { normalizeApiBase } from "./room-config";
import type { RoomSession } from "./session";

/**
 * 006 EARS-14 / EARS-16 — the authenticated server-side read of the calling
 * doctor's OWN display name (`GET /v1/me/display-name` → `MyDisplayName`). The
 * room page reads it to decide the one-time JIT prompt (null → prompt before the
 * room renders) and to derive the header-avatar initials.
 *
 * Self-only (EARS-16): the endpoint serves the name to its owner alone, keyed off
 * the session `sub` — never a body/path user id. Like the sibling room-config /
 * registration-state reads, this forwards the incoming request's session cookie
 * AND its fingerprint headers (ADR-0001 §6): the BFF session is fingerprint-bound,
 * so a server-to-server read on the doctor's behalf must present the same
 * `user-agent` + `accept-language` the browser bound at login, or the api
 * re-derives a different fingerprint and 401s a valid session.
 *
 * Per-caller ⇒ `cache: "no-store"`, never shared. The caller already holds a
 * granted room session, so a non-ok is a REAL error (not a silent skip) — it
 * throws, matching room-config's `!res.ok` contract.
 *
 * The API base is injected for the same reason the grant read's is — a shared
 * unit takes its upstream from its host, never from the ambient environment.
 */

export async function fetchMyDisplayName(
  session: RoomSession,
  { apiBase, fetchImpl }: RoomServerReadOptions,
): Promise<string | null> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const res = await doFetch(`${normalizeApiBase(apiBase)}/v1/me/display-name`, {
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      // Forward the fingerprint surface (ADR-0001 §6) — without it the api
      // re-derives a different fingerprint and 401s a valid session.
      "user-agent": session.userAgent,
      "accept-language": session.acceptLanguage,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`display-name fetch failed (${res.status})`);
  }
  return ((await res.json()) as MyDisplayName).displayName;
}
