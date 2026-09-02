"use client";

import { useEffect } from "react";

/**
 * 019 EARS-4 (#1519) — «selecting a day MOVES THE FEED BODY to that day».
 *
 * The movement is a SCROLL, never a narrowing. `day` is URL state that the read
 * contract deliberately ignores (`doctor-events-feed.schema.ts`: "The day the
 * feed body is scrolled to (EARS-4). Never narrows the read.", LD-1) — the feed
 * keeps serving its whole horizon and this effect brings the matching day group
 * to the top of the viewport. Day groups already carry a stable anchor,
 * `id="day-<ISO>"`, rendered by the shared `EventList`, so nothing new is
 * invented for the navigation to aim at.
 *
 * Why an effect and not a plain `#day-…` fragment: the day cells navigate with
 * `router.push(..., { scroll: false })` so 017's shell is never remounted, and
 * a soft navigation does not re-run the browser's own fragment scrolling. This
 * component re-runs on every `day` change AND on first paint, so a shared
 * `?day=` deep link lands on the same place a click does.
 *
 * A day the horizon serves no events for is NOT a dead end and gets no
 * fixture-only empty state: the feed stays whole and the body lands on the
 * nearest FOLLOWING day group — the honest answer to «show me from here».
 */
export function DoctorEventsDayAnchorScroll({ day }: { day: string | null }) {
  useEffect(() => {
    if (day === null) return;

    let frame = 0;
    let attempts = 0;

    const target = () => {
      const exact = document.getElementById(`day-${day}`);
      if (exact !== null) return exact;
      // Nearest FOLLOWING group: the anchors are ISO-dated, so lexical order is
      // chronological order.
      const groups = Array.from(
        document.querySelectorAll<HTMLElement>('section[id^="day-"]'),
      );
      return (
        groups.find((group) => group.id.slice(4) >= day) ??
        groups[groups.length - 1] ??
        null
      );
    };

    const run = () => {
      const node = target();
      if (node === null) {
        // The widened read may still be streaming in; retry for ~1s, then stop.
        if (attempts++ < 60) frame = requestAnimationFrame(run);
        return;
      }
      node.scrollIntoView({ behavior: "auto", block: "start" });
    };

    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [day]);

  return null;
}
