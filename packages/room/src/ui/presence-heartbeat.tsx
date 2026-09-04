"use client";

import { useEffect } from "react";
import { PresenceHeartbeatAckSchema } from "@ds/schemas";
import type { BrowserRoomApi } from "../client/room-api";
import { usePresenceCountSetter } from "./room-presence";

/**
 * Leave a diagnostic breadcrumb for a swallowed beat. The loop is best-effort by
 * design (EARS-4: a failed beat never surfaces an error to the doctor and never
 * clears the last known count), but a beat that fails with ZERO signal makes a
 * prod-only stall (refused beat / schema drift / transport failure) undiagnosable
 * — #1122. `console.debug` is the measured hedge: dev-visible when investigating,
 * filtered by default so a transient blip never spams, and never a user-facing
 * change or an extra request (no retry — behavior-preserving).
 */
function reportBeatFailure(reason: string, error?: unknown): void {
  console.debug(`[presence-heartbeat] beat not applied: ${reason}`, error ?? "");
}

/**
 * 006 EARS-4 — the client presence-capture loop. It POSTs an authenticated
 * heartbeat immediately on entry / visible resume, then every N seconds while visible
 * (`intervalSeconds` = `RoomConfig.heartbeatIntervalSeconds`, the server-config
 * cadence delivered in the EARS-1 grant) to the gated
 * `POST /v1/events/:slug/heartbeat` endpoint through the injected
 * {@link BrowserRoomApi} — same-origin and `credentials: "include"`, so the
 * `__Host-` session cookie rides automatically (each host rewrites `/v1/*` to its
 * own BFF; see `../client/room-api`).
 *
 * There is NO doctor-facing affordance — no "prove you're here" control, no
 * rendered output (it returns `null`): presence is captured from mount, from
 * minute one (requirements EARS-4). It is a client-side CAPTURE gate; the server
 * still refuses any beat from an ungated caller or a closed room, so a stray beat
 * is harmless (the server-side gate is authoritative — design §5).
 *
 * **Visibility-gated (Page Visibility API).** While the tab is backgrounded
 * (`document.hidden` true) the loop emits NO beats — a backgrounded tab's minutes
 * do not count toward the sponsor report — and it RESUMES when the tab becomes
 * visible again (an immediate beat on (re)entry, then every N seconds). A failed
 * post is swallowed: presence capture never surfaces an error to the doctor, and
 * concurrent-tab coalescing is an EARS-5 server-side read-time derivation, so a
 * duplicate beat on rapid re-focus is harmless.
 *
 * **Live presence count fallback (EARS-5).** Each accepted beat's ack carries the
 * server-derived distinct-doctor count (never PII). The primary realtime path is
 * Centrifugo fan-out; this loop applies the ack to {@link RoomPresenceProvider} only
 * as a best-effort fallback, with no extra poll.
 */
export function PresenceHeartbeat({
  api,
  intervalSeconds,
}: {
  /** The room's ONE browser transport — `createBrowserRoomApi({ slug })`. */
  api: BrowserRoomApi;
  intervalSeconds: number;
}) {
  const setPresenceCount = usePresenceCountSetter();
  useEffect(() => {
    // A non-positive cadence is inert — never a busy-loop (defence in depth; the
    // schema pins N positive, but the client does not trust that blindly).
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const beat = (): void => {
      // Visibility gate: a backgrounded tab emits nothing (EARS-4).
      if (document.hidden) return;
      void api
        .sendHeartbeat()
        .then((body) => {
          // Apply the ack as a best-effort fallback to primary Centrifugo count
          // fan-out. A parse failure leaves the last known count untouched, but no
          // longer disappears with zero signal — #1122. A REFUSED beat rejects
          // inside `sendHeartbeat` (RoomApiError) and lands in `catch` below.
          const ack = PresenceHeartbeatAckSchema.safeParse(body);
          if (ack.success) setPresenceCount(ack.data.presenceCount);
          else reportBeatFailure("ack payload failed the schema contract");
        })
        .catch((error: unknown) => {
          // Presence capture is best-effort — a failed beat never reaches the
          // doctor, but it does leave a dev-visible breadcrumb (#1122).
          reportBeatFailure("beat request failed (refused/network/transport)", error);
        });
    };

    const start = (): void => {
      if (timer) return;
      beat(); // capture from minute one / on re-entry, then on the N-second grid.
      timer = setInterval(beat, intervalSeconds * 1000);
    };

    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [api, intervalSeconds, setPresenceCount]);

  return null;
}
