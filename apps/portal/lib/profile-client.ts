"use client";

import type { MyProfile } from "@ds/schemas";

/**
 * 003 EARS-27/28 — same-origin portal client for the account-profile v1
 * self-read (`GET /v1/me/profile`, design §12). Like the sibling display-name
 * client, it hits a RELATIVE `/v1/…` path with `credentials: "include"`, so the
 * request rides the portal origin and carries the `__Host-ds_session` cookie
 * (Next `rewrites()` proxies `/v1/*` to the api — see `next.config.ts`). No
 * token ever touches this client; identity is the session `sub` server-side
 * (self-only — the route takes no identifier parameter).
 */

/** A non-2xx, non-401 `GET /v1/me/profile` response (transient/server). */
export class ProfileError extends Error {
  constructor(readonly status: number) {
    super(`profile request failed (${status})`);
    this.name = "ProfileError";
  }
}

/**
 * Read the caller's own account profile. Returns `null` on a 401 (no/expired
 * session — the page mirrors the EARS-9 silent-refresh-then-redirect dance
 * without try/catch noise) and throws {@link ProfileError} on any other
 * non-2xx. The response is the `@ds/schemas` `MyProfile` SSOT shape — every
 * field present, unset values as explicit `null`s (design §12).
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const res = await fetch("/v1/me/profile", {
    method: "GET",
    headers: { accept: "application/json" },
    // Same-origin, but explicit: the session cookie must ride the request.
    credentials: "include",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new ProfileError(res.status);
  return (await res.json()) as MyProfile;
}
