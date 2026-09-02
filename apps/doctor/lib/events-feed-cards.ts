import type { EventListItem } from "@ds/design-system";
import type { DoctorEventCard, DoctorEventsFeed } from "@ds/schemas";

/**
 * 019 EARS-3 (#1518) — the host projection of the feed payload onto the SHARED
 * `EventList` item shape.
 *
 * The doctor storefront owns exactly two things here: the Russian copy and the
 * МСК time rendering. Anatomy, states and geometry stay in
 * `@ds/design-system`'s `WebinarCard` / `EventList` (EARS-2, EARS-15) — there is
 * no screen-local card and no screen-local grouping, which is why this file
 * contains no JSX at all.
 */

/** The catalog copy this route hands the shared units. */
export const DOCTOR_EVENTS_FEED_COPY = {
  title: "События",
  breadcrumbEvents: "События",
  tz: "МСК",
  live: "В эфире",
  recorded: "Есть запись",
  free: "бесплатно для врача",
  signUp: "коллег записались",
  showMore: "Показать ещё",
  emptyTitle: "На выбранном отрезке событий нет",
  emptyDescription:
    "Расширьте период кнопкой «Показать ещё» — она сдвигает границу в адресе страницы.",
  errorTitle: "Не удалось загрузить ленту событий",
  errorDescription: "Повторите попытку — остальная часть страницы работает.",
  retry: "Повторить",
} as const;

const TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_LABEL_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  weekday: "short",
});

/** «16 июля · ср» — the card's date sub-label. */
function dateLabelOf(startsAt: string): string {
  const parts = DATE_LABEL_FORMAT.formatToParts(new Date(startsAt));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")} ${value("month")} · ${value("weekday")}`;
}

/** The format kicker on the time plate — catalog copy, never a card-owned vocabulary. */
const FORMAT_LABEL: Record<DoctorEventCard["format"], string> = {
  webinar: "Вебинар",
  "online-meeting": "Онлайн-встреча",
  "offline-meetup": "Очная встреча",
  congress: "Конгресс",
  podcast: "Подкаст",
};

export function toEventListItems(feed: DoctorEventsFeed): EventListItem[] {
  return feed.days.flatMap((day) =>
    day.items.map((card) => ({
      id: card.id,
      groupKey: day.day,
      groupLabel: day.label,
      href: card.href,
      time: TIME_FORMAT.format(new Date(card.startsAt)),
      tzLabel: DOCTOR_EVENTS_FEED_COPY.tz,
      dateLabel: dateLabelOf(card.startsAt),
      school: card.source,
      title: card.title,
      formatLabel: FORMAT_LABEL[card.format],
      // An unauthored value renders NOTHING rather than a placeholder: the
      // chip row simply has no speaker line when 007 authored no speaker.
      ...(card.speaker.length > 0
        ? { speakers: [{ name: card.speaker }] }
        : {}),
      ...(card.kind.length > 0 ? { specialties: [card.kind] } : {}),
      ...(card.nmo ? { nmoLabel: "НМО" } : {}),
      pulCost: card.pulCost,
      freeLabel: DOCTOR_EVENTS_FEED_COPY.free,
      signUpCount: card.signUpCount,
      signUpLabel: DOCTOR_EVENTS_FEED_COPY.signUp,
      ...(card.city !== undefined ? { city: card.city } : {}),
      ...(card.seatsLeft !== undefined ? { seatsLeft: card.seatsLeft } : {}),
      ...(card.state === "live"
        ? { live: true, liveLabel: DOCTOR_EVENTS_FEED_COPY.live }
        : {}),
      ...(card.state === "recorded"
        ? {
            variant: "past" as const,
            recordingLabel: DOCTOR_EVENTS_FEED_COPY.recorded,
          }
        : {}),
    })),
  );
}
