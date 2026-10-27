"use client";

import { WebinarCard } from "@ds/design-system/webinar-card";
import { useViewerZone } from "@ds/events-storefront/ui";
import { formatEventTime } from "@ds/schemas";

import type { ReturnContextEvent } from "../server/return-context";

/**
 * 021 EARS-2 / 004 EARS-12 (amended) — the return-context event, through the
 * `WebinarCard` the feed and the event page render, with its time stated the
 * way the event page states it: the one event-time formatter
 * (`formatEventTime`) in the viewer's zone (`useViewerZone`) — the server
 * render and the hydration pass read `Europe/Moscow`, and after mount an
 * online or hybrid event re-formats into the viewer's zone with its label; an
 * offline event stays МСК. One journey, one clock.
 */
export function ReturnEventCard({ event }: { event: ReturnContextEvent }) {
  const viewerZone = useViewerZone();
  const { time, zoneLabel, date, weekdayShort } = formatEventTime({
    startsAt: event.startsAt,
    participationFormat: event.format,
    viewerZone,
  });
  return (
    <WebinarCard
      navigable={false}
      data-testid="return-context-card"
      tzLabel={zoneLabel}
      time={time}
      dateLabel={`${date} · ${weekdayShort}`}
      school={event.school}
      title={event.title}
      specialties={event.specialties}
      speakers={event.speakers}
    />
  );
}
