"use client";

import { useEffect } from "react";
import { PresenceHeartbeatAckSchema } from "@ds/schemas";
import { usePresenceCountSetter } from "./room-presence";

/**
 * 006 EARS-4 — the client presence-capture loop. While the room tab is the
 * VISIBLE, active tab it POSTs an authenticated heartbeat every N seconds
 * (`intervalSeconds` = `RoomConfig.heartbeatIntervalSeconds`, the server-config
 * cadence delivered in the EARS-1 grant) to the gated
 * `POST /v1/events/:slug/heartbeat` endpoint — same-origin, so the `__Host-`
 * session cookie rides automatically (`credentials: "include"`; the portal
 * rewrites `/v1/*` to the BFF, next.config).
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
 * **Live presence count (EARS-5).** Each accepted beat's ack carries the live
 * room-presence count (distinct doctors within the freshness window — a server-side
 * aggregate, never PII); the loop pushes it into {@link RoomPresenceProvider} so the
 * header's «N врачей в комнате» indicator refreshes every beat with no extra poll.
 */
export function PresenceHeartbeat({
  slug,
  intervalSeconds,
}: {
  slug: string;
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
      void fetch(`/v1/events/${encodeURIComponent(slug)}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
        // A beat is a fire-and-forget signal; never block on the result.
        keepalive: true,
      })
        .then(async (res) => {
          // Refresh the live presence count from the ack (best-effort — a parse
          // failure or a refused beat leaves the last known count untouched).
          if (!res.ok) return;
          const ack = PresenceHeartbeatAckSchema.safeParse(await res.json());
          if (ack.success) setPresenceCount(ack.data.presenceCount);
        })
        .catch(() => {
          // Presence capture is best-effort — a failed beat never reaches the doctor.
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
  }, [slug, intervalSeconds, setPresenceCount]);

  return null;
}
