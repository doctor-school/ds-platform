"use client";

import { useEffect } from "react";

/**
 * Selecting a day moves the feed to that day (wave-2 gate row 56; 019
 * EARS-4). The movement is a scroll, never a narrowing: `day` is URL state no
 * read takes. A soft navigation (`router.push(…, { scroll: false })`, so the
 * shell never remounts) does not re-run the browser's fragment scrolling, so
 * this effect brings the day's group (`id="day-<ISO>"`, or the month group
 * `day-<YYYY-MM>` of «Прошедшие») to the top on every `day` change and on
 * first paint — a shared `?day=` link lands where a click does. A day with no
 * group lands on the nearest following one.
 */
export function DayAnchorScroll({ day }: { day: string | null }) {
  useEffect(() => {
    if (day === null) return;
    let frame = 0;
    let attempts = 0;
    const target = () => {
      const exact =
        document.getElementById(`day-${day}`) ??
        document.getElementById(`day-${day.slice(0, 7)}`);
      if (exact !== null) return exact;
      const groups = Array.from(
        document.querySelectorAll<HTMLElement>('section[id^="day-"]'),
      );
      return groups.find((group) => group.id.slice(4) >= day) ?? groups.at(-1) ?? null;
    };
    const run = () => {
      const node = target();
      if (node === null) {
        // The widened read may still be streaming in; retry for ~1 s.
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
