import type { EventListItem } from "@ds/design-system/blocks";
import {
  mintDoctorEventsFeedReturnTarget,
  type DoctorEventCard,
  type DoctorEventsFeed,
  type RawQueryRecord,
} from "@ds/schemas";

import { RETURN_CONTEXT_PARAM } from "./return-context";

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
  /**
   * The card CTA of an open event — the guest hand-off and the doctor's own path
   * share it. The trailing «↗» is the canvas's own glyph
   * (`design-source/doctor-events.dc.html` L557), not decoration: it marks the
   * card action as the one control that LEAVES the feed.
   */
  participate: "Участвовать ↗",
  /**
   * 019 EARS-12 — the guest gate band under the day feed
   * (`design-source/doctor-events.dc.html` L260-263, `guestGateOn`). It states
   * the ONE thing an account is needed for and promises the exact return; it is
   * never a gate over the READ, which stays whole for a guest.
   */
  guestGateTitle: "Участвовать — нужна регистрация.",
  guestGateBody:
    "После регистрации вы вернётесь ровно сюда, к выбранному событию.",
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

/**
 * 019 EARS-12 (#1527) — the READER the projection is rendering for, and the feed
 * query they are reading it under.
 *
 * Both are needed for one decision only: what a card's «Участвовать» points at.
 * The feed READ itself stays viewer-independent (LD-8) — the payload a guest and
 * a doctor receive is byte-identical — so the viewer never reaches the api; it
 * reaches exactly this projection.
 */
export interface DoctorEventsFeedViewerContext {
  viewer: "guest" | "doctor";
  /** The route's raw search params — the query the minted return target restores. */
  feedQuery: RawQueryRecord;
}

/**
 * The CTA of one card (019 EARS-12).
 *
 * - A GUEST is handed off to registration with the canonical return target the
 *   ONE guard mints (`/register?returnTo=…`): they come back to this feed, with
 *   this query, on this card. The target is never hand-assembled here — a
 *   host-local string build would be a second, unguarded return vocabulary
 *   (021 LD-3); when the mint refuses, the card simply carries no CTA.
 * - A DOCTOR goes to the event page, where the participation policy is resolved
 *   server-side (020). 019 introduces no participation COMMAND of its own.
 * - `registered` carries no CTA: the card's own «вы записаны» marker owns that
 *   state. `soldOut` and `recorded` carry none either — there is nothing open to
 *   join.
 */
function ctaOf(
  card: DoctorEventCard,
  context: DoctorEventsFeedViewerContext,
): { ctaHref: string; ctaLabel: string } | Record<string, never> {
  if (card.state !== "normal" && card.state !== "live") return {};

  if (context.viewer === "doctor") {
    return {
      ctaHref: card.href,
      ctaLabel: DOCTOR_EVENTS_FEED_COPY.participate,
    };
  }

  const returnTo = mintDoctorEventsFeedReturnTarget(
    context.feedQuery,
    card.slug,
  );
  if (returnTo === null) return {};
  return {
    ctaHref: `/register?${RETURN_CONTEXT_PARAM}=${encodeURIComponent(returnTo)}`,
    ctaLabel: DOCTOR_EVENTS_FEED_COPY.participate,
  };
}

export function toEventListItems(
  feed: DoctorEventsFeed,
  context: DoctorEventsFeedViewerContext,
): EventListItem[] {
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
      ...(card.kindTitle.length > 0 ? { specialties: [card.kindTitle] } : {}),
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
      ...ctaOf(card, context),
    })),
  );
}
