"use client";

import type { EventRegistrationState } from "@ds/schemas";

/**
 * 005 — same-origin portal client for the `RegisterForEvent` command (EARS-1,
 * fired on the guest's post-auth return for EARS-2). Like {@link authClient}, it
 * POSTs to a RELATIVE `/v1/…` path with `credentials: "include"`, so the request
 * rides the portal origin and carries the `__Host-ds_session` cookie the BFF set
 * during the 003 round-trip (Next `rewrites()` proxies `/v1/*` to the api — see
 * `next.config.ts`). No token ever touches this client.
 *
 * The response is the registered `EventRegistrationState` (`{ registered: true,
 * registeredAt }`) so the caller can land the doctor on the event page already in
 * the registered state. The command is idempotent server-side (EARS-3): firing it
 * again for the same (doctor, event) is a no-op returning the existing
 * registration, so a retry on the return path never creates a duplicate.
 */

/** A non-2xx registration response (gating refusal, unauthenticated, missing event). */
export class RegistrationError extends Error {
  constructor(readonly status: number) {
    super(`registration request failed (${status})`);
    this.name = "RegistrationError";
  }
}

/**
 * Fire `RegisterForEvent` for `slug` against the current session. The slug is
 * `encodeURIComponent`-escaped into the same-origin path so it can never break
 * out of `/v1/events/…`. Throws {@link RegistrationError} on a non-2xx.
 */
export async function registerForEvent(
  slug: string,
): Promise<EventRegistrationState> {
  const res = await fetch(
    `/v1/events/${encodeURIComponent(slug)}/registration`,
    {
      method: "POST",
      headers: { accept: "application/json" },
      // Same-origin, but explicit: the session cookie must ride the request.
      credentials: "include",
    },
  );
  if (!res.ok) throw new RegistrationError(res.status);
  return (await res.json()) as EventRegistrationState;
}
