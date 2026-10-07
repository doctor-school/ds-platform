import type { MyEventItem, MyEventsTab } from "@ds/schemas";
import type { EventListItem } from "@ds/design-system/blocks";
import {
  formatMskDayLabel,
  formatMskMonth,
  formatMskParts,
  formatMskWeekdayShort,
  isRecordingPlayable,
  mskDayKey,
  mskMonthKey,
  toCanvasStatus,
} from "@ds/events-storefront";

import { resolveRoomEntryHref } from "./registration-state";

/*
 * The «Мои события» READ (`fetchMyEvents`) lives in `@ds/events-storefront/server`;
 * this row→card projection stays on the Academy host until wave-2 PR 2.3, where the
 * api resolves the per-host room href onto `MyEventItem` (entry gate §2.1 row 15,
 * §4.3 D8) and the projection moves without importing `@ds/room`.
 */

/** Copy the pure row→card projection needs; every string comes from the catalog. */
export interface MyEventListCopy {
  readonly cardTz: string;
  readonly dateLabel: (parts: { date: string; weekday: string }) => string;
  readonly live: string;
  readonly recordingLabel: (
    state: NonNullable<MyEventItem["recording"]>["state"],
  ) => string;
  readonly recordingCta: string;
  readonly roomCta: string;
}

/**
 * Project the `MyEvents` rows of ONE tab onto the shared `EventList` block's item
 * shape (014 EARS-9). Pure — the single unit the «Мои события» surface renders,
 * unit-tested independent of any browser.
 *
 * Grouping mirrors the public listing so the two feeds share one rhythm: the
 * **Предстоящие** tab is grouped by Europe/Moscow calendar DAY (the server's
 * nearest-first order preserved, EARS-6/EARS-11), the **Записи** tab by МСК MONTH
 * over the newest-first history. Both keys come from the package МСК helpers, never recomputed
 * here, so the grouping can never drift to the viewer's timezone.
 *
 * A `live` row is one of the caller's OWN registrations (the read returns only
 * registered events), so it admits the doctor into the room through the hardened
 * {@link resolveRoomEntryHref} — the same open-redirect defence as the event-page
 * CTA (006 EARS-6). An `ended` row's CTA leads back to its event page, where the
 * recording lives; its badge carries the recording state (including `preparing`
 * for an ended event whose recording is not published yet).
 */
export function buildMyEventListItems(
  events: readonly MyEventItem[],
  tab: MyEventsTab,
  copy: MyEventListCopy,
): EventListItem[] {
  const past = tab === "recordings";
  return events.map((event) => {
    const parts = formatMskParts(event.startsAt);
    const roomEntryHref = past
      ? null
      : resolveRoomEntryHref(
          { registered: true },
          toCanvasStatus(event.state),
          event.slug,
        );
    const href = `/webinars/${event.slug}`;
    return {
      id: event.eventId,
      groupKey: past ? mskMonthKey(event.startsAt) : mskDayKey(event.startsAt),
      groupLabel: past
        ? formatMskMonth(event.startsAt)
        : formatMskDayLabel(event.startsAt),
      href,
      time: parts.time,
      tzLabel: copy.cardTz,
      dateLabel: copy.dateLabel({
        date: parts.date,
        weekday: formatMskWeekdayShort(event.startsAt),
      }),
      school: event.school,
      title: event.title,
      live: !past && event.state === "live",
      liveLabel: copy.live,
      recordingLabel: event.recording
        ? copy.recordingLabel(event.recording.state)
        : undefined,
      variant: past ? ("past" as const) : ("upcoming" as const),
      ctaHref: past ? href : (roomEntryHref ?? undefined),
      ctaLabel: past
        ? isRecordingPlayable(event.recording)
          ? copy.recordingCta
          : undefined
        : roomEntryHref
          ? copy.roomCta
          : undefined,
    };
  });
}
