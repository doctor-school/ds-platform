"use client";

import { fetchFreshChatToken } from "./room-chat-token";
import { setDisplayName as putDisplayName } from "./display-name-client";

/**
 * 006 EARS-2 / EARS-3 / EARS-4 / EARS-14 — the ONE home of every browser call the
 * room makes.
 *
 * All four endpoints are **relative** (`/v1/…`) and send `credentials: "include"`.
 * That is not an implementation detail to be parameterised away: the session rides
 * the `__Host-ds_session` cookie, and the `__Host-` prefix LOCKS that cookie to the
 * exact origin that set it. Each host serves the BFF under its OWN origin through
 * its own `next.config.ts` rewrite (`/v1/:path*` → the api), so `doctor.school` and
 * `academy.doctor.school` hold SEPARATE sessions and an absolute base would be
 * wrong on at least one of them (ADR-0015 §4). The host-side half of this invariant
 * is asserted per app in `apps/portal/lib/next-config-rewrite.test.ts` and
 * `apps/doctor/lib/next-config-rewrite.test.ts` — it cannot live here, because a
 * `next.config.ts` import would drag `next` into this package.
 *
 * `fetchImpl` exists so the contract is unit-testable against a double; it defaults
 * to the ambient `fetch` and no caller passes it in production.
 */

/** A non-2xx room API response (gate refusal, validation reject, transient). */
export class RoomApiError extends Error {
  constructor(
    readonly status: number,
    endpoint: string,
  ) {
    super(`room api ${endpoint} failed (${status})`);
    this.name = "RoomApiError";
  }
}

export interface BrowserRoomApiOptions {
  readonly slug: string;
  readonly fetchImpl?: typeof fetch;
}

export interface BrowserRoomApi {
  /** EARS-3 — post one chat message to the room. */
  postChatMessage(text: string): Promise<void>;
  /** EARS-4 — one presence beat; resolves with the ack body for the caller to parse. */
  sendHeartbeat(): Promise<unknown>;
  /** EARS-2 — a fresh gate-scoped chat connection token (centrifuge `getToken`). */
  refreshChatToken(): Promise<string>;
  /** EARS-14 — persist the doctor's display name (self-scoped by the session). */
  setDisplayName(displayName: string): Promise<void>;
}

export function createBrowserRoomApi({
  slug,
  fetchImpl,
}: BrowserRoomApiOptions): BrowserRoomApi {
  const doFetch: typeof fetch = (...args) => (fetchImpl ?? globalThis.fetch)(...args);
  const event = `/v1/events/${encodeURIComponent(slug)}`;

  return {
    async postChatMessage(text: string): Promise<void> {
      const res = await doFetch(`${event}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new RoomApiError(res.status, "chat");
    },

    async sendHeartbeat(): Promise<unknown> {
      const res = await doFetch(`${event}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
        // A beat is a fire-and-forget signal; keep it alive across an unload.
        keepalive: true,
      });
      if (!res.ok) throw new RoomApiError(res.status, "heartbeat");
      return (await res.json()) as unknown;
    },

    // Delegated so the centrifuge `getToken` refusal contract (UnauthorizedError on
    // a gate refusal, a plain retryable error on a transient) lives in exactly one
    // place — `./room-chat-token`.
    refreshChatToken: () => fetchFreshChatToken(slug, doFetch),

    // Delegated for the same reason: `DisplayNameError` is the typed non-2xx the
    // prompt already surfaces.
    setDisplayName: (displayName: string) => putDisplayName(displayName, doFetch),
  };
}
