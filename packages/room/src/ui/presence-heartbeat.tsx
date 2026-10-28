"use client";

import { useEffect, useRef } from "react";
import { PresenceHeartbeatAckSchema } from "@ds/schemas";
import { RoomApiError, type BrowserRoomApi } from "../client/room-api";
import { usePresenceCountSetter } from "./room-presence";

/**
 * 006 EARS-7 — does this refused beat PROVE the event left `live`?
 *
 * Only a 409 whose body names a lifecycle state other than `live` qualifies: that
 * is the exact shape the server's close path answers with
 * (`ConflictException({ message, state })`, pinned by
 * `apps/api/test/room/room-close.e2e-spec.ts`). Everything else — 401 (unknown
 * subject), 403 (not registered), 5xx, a network drop, a proxy error page whose
 * body will not parse — is a diagnostics-only failure. Promoting any of those
 * would paint «Эфир завершён» over a running broadcast on a transient blip, which
 * is strictly worse than the stale-live state this feature removes.
 */
function provesRoomClosed(error: unknown): boolean {
  return (
    error instanceof RoomApiError &&
    error.status === 409 &&
    error.state !== undefined &&
    error.state !== "live"
  );
}

/**
 * 006 EARS-7 (#1974) — what an out-of-cadence status probe learned:
 * - `closed` — the answer PROVED the event left `live` (already reported through
 *   `onRoomClosed`);
 * - `not-closed` — a beat was sent and its outcome proves nothing about a close
 *   (accepted, refused otherwise, network/transport failure);
 * - `unknown` — nothing was sent: the tab is hidden (EARS-4 sends no beat while
 *   backgrounded), so the room's status is simply not known yet. The visible
 *   resume beat is the next probe.
 */
export type RoomStatusProbeAnswer = "closed" | "not-closed" | "unknown";

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
  onRoomClosed,
  probeRef,
}: {
  /** The room's ONE browser transport — `createBrowserRoomApi({ slug })`. */
  api: BrowserRoomApi;
  intervalSeconds: number;
  /**
   * 006 EARS-7 — called AT MOST ONCE, when a beat is refused with proof the event
   * left `live` ({@link provesRoomClosed}). The loop stops for good at that point:
   * a closed room has no presence to capture. The shell lifts this into the room's
   * ended phase; the component itself still renders nothing.
   */
  onRoomClosed?: (() => void) | undefined;
  /**
   * 006 EARS-7 (#1974) — the loop publishes a status probe here so the room can
   * re-probe its status out of cadence (on a player failure) through the SAME
   * gated call: no second endpoint, no second refusal reading. It resolves a
   * {@link RoomStatusProbeAnswer} and obeys the loop's own gates — nothing is sent
   * while hidden (`unknown`), a latched close resolves `closed` — and it JOINS a
   * beat already in flight instead of sending a second one.
   */
  probeRef?: { current: (() => Promise<RoomStatusProbeAnswer>) | null } | undefined;
}) {
  const setPresenceCount = usePresenceCountSetter();
  // Held in a ref so a host passing an inline callback cannot re-run the effect —
  // a restart would clear the `closed` latch and resume beating a closed room.
  const onRoomClosedRef = useRef(onRoomClosed);
  useEffect(() => {
    onRoomClosedRef.current = onRoomClosed;
  }, [onRoomClosed]);
  useEffect(() => {
    // A non-positive cadence is inert — never a busy-loop (defence in depth; the
    // schema pins N positive, but the client does not trust that blindly).
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    // EARS-7 — a one-way latch. Once the server has proven the event left `live`,
    // the loop is done: no grid beat, and no beat on a later visible resume.
    let closed = false;
    // The beat currently awaiting its answer — a status probe joins it (#1974).
    let inflight: Promise<boolean> | null = null;

    // One gated beat; resolves `true` iff the answer proved the event left `live`.
    // It never rejects: every failure is handled (and diagnosed) in here.
    const send = (): Promise<boolean> => {
      const attempt = api
        .sendHeartbeat()
        .then((body) => {
          // Apply the ack as a best-effort fallback to primary Centrifugo count
          // fan-out. A parse failure leaves the last known count untouched, but no
          // longer disappears with zero signal — #1122. A REFUSED beat rejects
          // inside `sendHeartbeat` (RoomApiError) and lands in `catch` below.
          const ack = PresenceHeartbeatAckSchema.safeParse(body);
          // A `null` count is the withheld one (006 EARS-19): it drops the shown count.
          if (ack.success) setPresenceCount(ack.data.presenceCount);
          else reportBeatFailure("ack payload failed the schema contract");
          return false;
        })
        .catch((error: unknown) => {
          // EARS-7 — the ONE refusal that is a product event, not a diagnostic:
          // the room's next gated request was refused because the event is no
          // longer live, so the room learns the broadcast ended and degrades to
          // the end card. Latch first, so a beat already in flight cannot report
          // the close twice.
          if (provesRoomClosed(error)) {
            if (closed) return true;
            closed = true;
            stop();
            onRoomClosedRef.current?.();
            return true;
          }
          // Presence capture is best-effort — a failed beat never reaches the
          // doctor, but it does leave a dev-visible breadcrumb (#1122).
          reportBeatFailure("beat request failed (refused/network/transport)", error);
          return false;
        });
      inflight = attempt;
      void attempt.then(() => {
        if (inflight === attempt) inflight = null;
      });
      return attempt;
    };

    const beat = (): void => {
      // Visibility gate: a backgrounded tab emits nothing (EARS-4).
      if (closed || document.hidden) return;
      void send();
    };

    // 006 EARS-7 (#1974) — the out-of-cadence status probe (see `probeRef`).
    const probe = (): Promise<RoomStatusProbeAnswer> => {
      if (closed) return Promise.resolve("closed");
      if (document.hidden) return Promise.resolve("unknown");
      return (inflight ?? send()).then((proven) => (proven ? "closed" : "not-closed"));
    };

    const start = (): void => {
      if (timer || closed) return;
      // Capture from minute one / on re-entry, then on the N-second grid. A probe
      // already in flight (sent by the same visible resume) IS the re-entry beat.
      if (!inflight) beat();
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
    if (probeRef) probeRef.current = probe;

    return () => {
      if (probeRef?.current === probe) probeRef.current = null;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [api, intervalSeconds, setPresenceCount, probeRef]);

  return null;
}
