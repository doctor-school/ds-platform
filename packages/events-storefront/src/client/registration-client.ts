"use client";

import type { EventRegistrationState } from "@ds/schemas";

/**
 * 005 — same-origin browser client for the `RegisterForEvent` command (EARS-1,
 * fired on the guest's post-auth return for EARS-2). It POSTs to a RELATIVE
 * `/v1/…` path with `credentials: "include"`, so the request rides the CALLING
 * storefront's own origin and carries the `__Host-ds_session` cookie that origin's
 * BFF set during the 003 round-trip (each Next host `rewrites()` `/v1/*` to the
 * api — see the host's `next.config.ts`). No token ever touches this client.
 *
 * Being origin-relative is exactly why one implementation serves BOTH storefronts
 * (ADR-0015 §4): `academy.doctor.school` and `doctor.school` hold SEPARATE
 * `__Host-` cookies under the same name, and a relative POST always addresses the
 * one the current document owns.
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
