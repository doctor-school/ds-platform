"use client";

/**
 * 006 EARS-14 — same-origin portal client for the `SetDisplayName` command fired
 * by the JIT room-entry prompt. Like the sibling registration client, it PUTs to a
 * RELATIVE `/v1/…` path with `credentials: "include"`, so the request rides the
 * portal origin and carries the `__Host-ds_session` cookie the BFF set at login
 * (Next `rewrites()` proxies `/v1/*` to the api — see `next.config.ts`). No token
 * ever touches this client, and the identity is the session `sub` server-side
 * (self-scoped, never a body user id — EARS-16).
 */

/** A non-2xx `SetDisplayName` response (validation reject, unauthenticated, transient). */
export class DisplayNameError extends Error {
  constructor(readonly status: number) {
    super(`display-name request failed (${status})`);
    this.name = "DisplayNameError";
  }
}

/**
 * Persist the doctor's trimmed display name via `PUT /v1/me/display-name`. The
 * body is validated server-side by the same `@ds/schemas` SSOT the prompt form
 * enforces, so a malformed value is a 400 the caller surfaces. Throws
 * {@link DisplayNameError} on a non-2xx.
 */
export async function setDisplayName(displayName: string): Promise<void> {
  const res = await fetch("/v1/me/display-name", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    // Same-origin, but explicit: the session cookie must ride the request.
    credentials: "include",
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new DisplayNameError(res.status);
}
