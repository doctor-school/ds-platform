"use client";

import type { SessionClaims } from "@ds/schemas";

/**
 * Client-side session probe for the doctor storefront.
 *
 * Mirrors `apps/portal/lib/auth-client.ts` deliberately narrowly — only the
 * `session()` read, because this app owns no auth FORMS (the login/register
 * journeys live on `academy.doctor.school`; ADR-0015 §4 REQ-24 gives the doctor
 * exactly one link into the Academy, with no reverse portal-surface nav).
 *
 * The call goes to a RELATIVE `/v1/auth/session` with `credentials: "include"`,
 * so it rides THIS origin and Next's rewrite proxies it to the api. That is the
 * whole point of the same-origin proxy: the `__Host-ds_session` cookie is locked
 * to `doctor.school`, so it is only ever sent here — never cross-origin — and the
 * access/refresh tokens never reach this client.
 */
export async function readSession(): Promise<SessionClaims | null> {
  const res = await fetch("/v1/auth/session", {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`session request failed (${res.status})`);
  return (await res.json()) as SessionClaims;
}
