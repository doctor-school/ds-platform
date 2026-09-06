"use client";

import { useEffect, useState } from "react";
import { LiveEventStrip } from "@ds/design-system/blocks";
import {
  DOCTOR_EVENTS_LIVE_REFRESH_SECONDS,
  type DoctorEventsLiveStrip,
  DoctorEventsLiveReadSchema,
} from "@ds/schemas";

import { DOCTOR_EVENTS_LIVE_PATH } from "@/lib/events-live";
import { doctorLiveStripProps } from "@/lib/events-feed-cards";

/**
 * 019 EARS-6 (#1521) — the «Идёт сейчас» block above the doctor events feed.
 *
 * The block is a LIVE fact with a definite end, so it must clear itself when the
 * эфир ends — a doctor who leaves the tab open must not be looking at a red
 * frame inviting them into a room that closed twenty minutes ago. It therefore
 * re-reads the SERVER's answer every {@link DOCTOR_EVENTS_LIVE_REFRESH_SECONDS}
 * seconds (LD-6), and again the moment the tab becomes visible, because a
 * backgrounded tab's timers are throttled and the first thing a returning doctor
 * sees must be current.
 *
 * Three things it deliberately does NOT do:
 *
 *  - **It never derives liveness.** There is no `startsAt` in the contract and no
 *    clock arithmetic here; «идёт ли эфир» is 006's lifecycle state, resolved
 *    server-side (019-design §4). A client-side timer would be the second
 *    liveness authority the design exists to prevent.
 *  - **It never invents an empty state.** `null` means nothing targeted is
 *    running, and then this component renders NOTHING — no wrapper, no
 *    placeholder container. The block is absent from the tree, per the design's
 *    dataState matrix, so an assistive-tech user is not walked through a hollow
 *    landmark.
 *  - **It never clears on a network blip.** A failed poll keeps the last strip:
 *    the эфир did not end because a request timed out, and removing a working
 *    room entry mid-эфир is a worse failure than showing it a cadence longer
 *    than needed. Only an actual `null` from the server removes the block.
 *
 * The first paint comes from the SERVER read (`initial`), so the strip is in the
 * HTML rather than appearing a beat after hydration.
 */
export function EventsLiveBlock({
  initial,
}: {
  initial: DoctorEventsLiveStrip | null;
}) {
  const [strip, setStrip] = useState(initial);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch(DOCTOR_EVENTS_LIVE_PATH, {
          credentials: "include",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const next = DoctorEventsLiveReadSchema.parse(await res.json());
        if (!cancelled) setStrip(next);
      } catch {
        // Keep the last known strip — see the «never clears on a blip» note.
      }
    }

    const timer = window.setInterval(
      refresh,
      DOCTOR_EVENTS_LIVE_REFRESH_SECONDS * 1000,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (strip === null) return null;

  return (
    <div
      className="mt-8"
      data-testid="events-live-block"
      data-refresh-seconds={DOCTOR_EVENTS_LIVE_REFRESH_SECONDS}
    >
      <LiveEventStrip {...doctorLiveStripProps(strip)} />
    </div>
  );
}
