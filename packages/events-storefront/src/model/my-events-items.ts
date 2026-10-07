import {
  formatEventTime,
  type MyEventItem,
  type MyEventsTab,
} from "@ds/schemas";
import type { EventListItem } from "@ds/design-system/blocks";

import { eventPageHref, type EventsStorefrontHostConfig } from "../host-config";
import { isRecordingPlayable } from "./recording-cta";

/** Copy the pure row→card projection needs; every string comes from the copy module. */
export interface MyEventListCopy {
  readonly dateLabel: (parts: { date: string; weekday: string }) => string;
  readonly live: string;
  readonly recordingLabel: (
    state: NonNullable<MyEventItem["recording"]>["state"],
  ) => string;
  readonly recordingCta: string;
  readonly roomCta: string;
}

/** What the projection reads besides the rows: copy, the host's routes, the zone. */
export interface MyEventListContext {
  readonly copy: MyEventListCopy;
  readonly routes: Pick<EventsStorefrontHostConfig["routes"], "eventPage">;
  /** The viewer's IANA zone — Europe/Moscow on the server and the first client render. */
  readonly viewerZone: string;
}

/**
 * Project the `MyEvents` rows of ONE tab onto the shared `EventList` block's item
 * shape (014 EARS-9, wave-2 entry gate §2.1 row 15). Pure — a mapping of the
 * read, unit-tested independent of any browser, the same on both storefronts.
 *
 * Grouping mirrors the public listing: the **Предстоящие** tab is grouped by
 * calendar DAY (the server's nearest-first order preserved, EARS-6/EARS-11), the
 * **Записи** tab by MONTH over the newest-first history. Every instant — time,
 * zone label, date and group — comes from the one `formatEventTime` rule (004
 * EARS-12 as amended 2026-10-02, gate row 26): an online or hybrid row in the
 * viewer zone, an offline row in МСК.
 *
 * The room CTA of a registered live row is the `roomHref` the api resolved for
 * the calling host (gate §4.3 D8) — the projection never builds a room path. An
 * `ended` row's CTA leads back to its event page on the host, where the recording
 * lives; its recording-state line (under the date) carries the state (including `preparing`).
 */
export function buildMyEventListItems(
  events: readonly MyEventItem[],
  tab: MyEventsTab,
  { copy, routes, viewerZone }: MyEventListContext,
): EventListItem[] {
  const past = tab === "recordings";
  return events.map((event) => {
    const time = formatEventTime({
      startsAt: event.startsAt,
      participationFormat: event.participationFormat,
      viewerZone,
    });
    const roomHref = past ? null : event.roomHref;
    const href = eventPageHref({ routes }, event.slug);
    const ctaHref = past ? href : roomHref;
    const ctaLabel = past
      ? isRecordingPlayable(event.recording)
        ? copy.recordingCta
        : null
      : roomHref
        ? copy.roomCta
        : null;
    return {
      id: event.eventId,
      groupKey: past ? time.groupMonth : time.groupDay,
      groupLabel: past ? time.monthLabel : `${time.date}, ${time.weekday}`,
      href,
      time: time.time,
      tzLabel: time.zoneLabel,
      dateLabel: copy.dateLabel({
        date: time.date,
        weekday: time.weekdayShort,
      }),
      school: event.school,
      title: event.title,
      live: !past && event.state === "live",
      liveLabel: copy.live,
      ...(event.recording
        ? { recordingLabel: copy.recordingLabel(event.recording.state) }
        : {}),
      variant: past ? ("past" as const) : ("upcoming" as const),
      // The card renders its CTA only on `ctaHref && ctaLabel`.
      ...(ctaHref ? { ctaHref } : {}),
      ...(ctaLabel ? { ctaLabel } : {}),
    };
  });
}
