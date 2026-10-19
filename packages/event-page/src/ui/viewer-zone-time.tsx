"use client";

import {
  type EventPageMoment,
  eventPageDateLine,
  eventPageTimeParts,
} from "@ds/design-system/blocks";
import { useViewerZone } from "@ds/events-storefront/ui";

/**
 * 020 «Amendment — 2026-10-02» (004 EARS-12 as amended, wave-3 gate D9) — the
 * event page's one client island for time. The server render and the hydration
 * pass both read `Europe/Moscow` (`useViewerZone` starts there), so they agree;
 * after mount an online or hybrid event re-formats into the viewer's zone with
 * its explicit label, the way the feed does since wave 2. An offline event
 * stays МСК — `formatEventTime` pins it whatever the zone.
 */
export function ViewerZoneTime({
  moment,
  part,
}: {
  moment: EventPageMoment & { durationMin: number };
  /** Which rendering of the instant: the hero line, a sign-up card label or the ended meta row's date. */
  part: "dateLine" | "time" | "date" | "dateWithYear" | "weekdayLabel";
}) {
  const zone = useViewerZone();
  if (part === "dateLine")
    return <>{eventPageDateLine(moment, undefined, zone)}</>;
  const { time, date, dateWithYear, weekday, zoneLabel } = eventPageTimeParts(
    moment,
    zone,
  );
  if (part === "time") return <>{time}</>;
  if (part === "date") return <>{date}</>;
  if (part === "dateWithYear") return <>{dateWithYear}</>;
  return <>{`${weekday} · ${zoneLabel}`}</>;
}
