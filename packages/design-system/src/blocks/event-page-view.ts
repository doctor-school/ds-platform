import type {
  EventPageView,
  EventParticipationFormat,
  ParticipationCta,
  PublicEventPageSpeaker,
} from "@ds/schemas";

import type { EventSignupCardProps, EventSignupCondition } from "./event-signup-card";
import type { EventFormatBlockProps } from "./event-format-block";
import type { EventSpeakerCardProps } from "./event-speaker-card";

/**
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — the ONE `EventPageView` → block-props
 * projection both storefront hosts render through.
 *
 * The identity obligation of EARS-18 («the two storefronts render the same event
 * from one core») is structural, not a review promise: if the МСК date line, the
 * hero kicker, the sign-up conditions or the speaker mapping lived in each host,
 * the two renders would be free to drift the moment either side touched its copy.
 * They live here instead, so a host `page.tsx` is only fetch → map → compose, and
 * the ONLY things a host may vary are the ones EARS-18 permits: the header shell,
 * the route envelope (breadcrumb targets), and copy DEFAULTS handed in as
 * {@link EventPageCopy}.
 *
 * This module is deliberately JSX-free — it produces prop objects, never markup.
 * The anatomy, geometry and states stay in the slice-2 blocks
 * (`EventPageShell` · `EventPageHero` · `EventSignupCard` · `EventSpeakerCard` ·
 * `EventFormatBlock`), exactly as 019's `events-feed-cards.ts` does for the feed.
 *
 * It resolves NOTHING about participation. The {@link ParticipationCta} is
 * server-resolved (`GET …/events/:idOrSlug/participation`) and travels through
 * this mapper verbatim: a host that recomputed eligibility from `state`,
 * `seatsLeft` or a registration read would be the exact defect 020-design §1.1
 * («no second CTA resolver») forbids.
 */

const MSK_TIME_ZONE = "Europe/Moscow";

const MSK_TIME = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const MSK_DATE = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  day: "numeric",
  month: "long",
});

const MSK_WEEKDAY = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TIME_ZONE,
  weekday: "long",
});

/**
 * The RU copy DEFAULTS of the shared event page. A host may hand its own object
 * (the envelope EARS-18 allows); it may never hand its own MAPPING — every
 * function below takes the copy as data and keeps one shape.
 */
export interface EventPageCopy {
  /** The Moscow-time label rendered next to every time (004 EARS-12). */
  tz: string;
  /** Duration unit for the hero date line — «90 минут». */
  minutes: string;
  /** Sign-up card condition labels. */
  conditionFormat: string;
  conditionDuration: string;
  conditionPrice: string;
  /** The standing participation price on both storefronts today. */
  priceFree: string;
  /** Participation-format words, shared by the kicker and the condition row. */
  format: Record<EventParticipationFormat, string>;
  /** Sign-up card footnote, rendered under the CTA in the register state only. */
  signupNote: string;
  /** `EventFormatBlock` (online) lines; its heading is the canvas default «Эфир». */
  roomOpensLine: string;
  duringLine: string;
}

export const EVENT_PAGE_COPY: EventPageCopy = {
  tz: "МСК",
  minutes: "минут",
  conditionFormat: "Формат",
  conditionDuration: "Длительность",
  conditionPrice: "Участие",
  priceFree: "бесплатно для врача",
  format: {
    online: "Онлайн",
    offline: "Очно",
    hybrid: "Очно и онлайн",
  },
  signupNote: "Нужна регистрация — вернём вас на эту страницу.",
  roomOpensLine: "Комната эфира откроется за 10 минут до начала",
  duringLine:
    "Во время эфира: вопрос лектору · опросы с живым графиком · отметки присутствия",
};

/** The МСК parts every surface of the page renders from the one UTC instant. */
export interface EventPageTimeParts {
  /** «19:00» */
  time: string;
  /** «28 августа» */
  date: string;
  /** «пятница» */
  weekday: string;
}

export function eventPageTimeParts(view: EventPageView): EventPageTimeParts {
  const instant = new Date(view.startsAt);
  return {
    time: MSK_TIME.format(instant),
    date: MSK_DATE.format(instant),
    weekday: MSK_WEEKDAY.format(instant),
  };
}

/**
 * The hero date line — «28 августа, 19:00 (МСК) · 90 минут». One string, so the
 * two hosts cannot disagree about the order of date, time, timezone and
 * duration for the same event (EARS-1: date + time «МСК» + duration).
 */
export function eventPageDateLine(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): string {
  const { date, time } = eventPageTimeParts(view);
  return `${date}, ${time} (${copy.tz}) · ${view.durationMin} ${copy.minutes}`;
}

/**
 * The hero kicker — «Школа · Онлайн». The school is the event's own field, the
 * format word is copy; neither is host knowledge.
 */
export function eventPageKicker(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): string {
  return `${view.school} · ${copy.format[view.format]}`;
}

/**
 * The hero chips — the event's target specialties, in projection order. NO НМО
 * chip is synthesised here: `EventPageView` carries no accreditation field yet
 * (that read is EARS-11 / #1774), and inventing one would be the untracked seam
 * F-22 forbids. When the field lands, it joins this one function.
 */
export function eventPageChips(view: EventPageView): readonly string[] {
  return view.specialties;
}

/**
 * The lifecycle plate the hero carries — a COMPOSITION decision, so it lives
 * here rather than in either host (EARS-18, #1764). The mapper answers WHETHER
 * a plate renders and with WHICH badge variant; only the word is host copy
 * (`ru.json` on the academy, the page `COPY` on doctor.school), which is the
 * one declared copy-defaults divergence.
 *
 * `in_archive` is a legacy эфир whose only public signal IS its recording and
 * which has no lifecycle word of its own (014-design §3.1), so it gets no
 * plate. A host may render its own 014 recording badge BESIDE this one; it may
 * not decide the lifecycle plate itself.
 */
export interface EventLifecyclePlate {
  state: Exclude<EventPageView["state"], "in_archive">;
  variant: "live" | "label";
}

export function eventLifecyclePlate(
  view: EventPageView,
): EventLifecyclePlate | null {
  if (view.state === "in_archive") return null;
  return {
    state: view.state,
    variant: view.state === "live" ? "live" : "label",
  };
}

/**
 * The sign-up card props for one viewer on one event. `cta` is passed straight
 * through from the server policy read — this function never inspects it.
 */
export function eventSignupCardProps(
  view: EventPageView,
  cta: ParticipationCta,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): EventSignupCardProps {
  const { time, date, weekday } = eventPageTimeParts(view);
  const conditions: EventSignupCondition[] = [
    { label: copy.conditionFormat, value: copy.format[view.format] },
    {
      label: copy.conditionDuration,
      value: `${view.durationMin} ${copy.minutes}`,
    },
    { label: copy.conditionPrice, value: copy.priceFree },
  ];
  return {
    timeLabel: time,
    dateLabel: date,
    weekdayLabel: `${weekday} · ${copy.tz}`,
    conditions,
    cta,
    // Canvas:201 carries the footnote under the register control alone. In
    // every other state it would contradict the words above it — «Мест нет»,
    // «Участие недоступно», «Вы записаны» — so it is absent, not restyled.
    note: cta.action === "register" ? copy.signupNote : undefined,
  };
}

/**
 * The speaker cards, mapped from the 012 EARS-8 legacy+expert union. Both
 * variants carry `name` + `credentials`; only the expert variant adds a photo
 * and a role kicker, so the legacy card degrades to initials rather than to a
 * broken image.
 *
 * No `href` / `footerHref` is produced: the expert PAGE route is per-host and
 * neither storefront owns one in this slice, so a link here would be a dead
 * affordance. The canvas (canvas:118) carries ONE «Ведёт» label above the
 * section, so every card after the first suppresses it with an explicit
 * `null` — `undefined` would RESTORE the card's canvas default.
 */
export function eventSpeakerCards(view: EventPageView): EventSpeakerCardProps[] {
  return view.speakers.map((speaker, index) => ({
    ...speakerCardProps(speaker),
    heading: index === 0 ? undefined : null,
  }));
}

function speakerCardProps(
  speaker: PublicEventPageSpeaker,
): EventSpeakerCardProps {
  const base = {
    name: speaker.name,
    affiliation: speaker.credentials,
    initials: initialsOf(speaker.name),
  } satisfies EventSpeakerCardProps;
  if (speaker.source === "legacy") return base;
  return {
    ...base,
    roleKicker: speaker.role,
    ...(speaker.photoUrl === null
      ? {}
      : { photoUrl: speaker.photoUrl, photoAlt: speaker.name }),
  };
}

/** «Михаил Страхов» → «МС»; a single-word name yields one letter. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/**
 * The «как это проходит» block — ONLINE only. `offline` and `hybrid` carry an
 * address, a map and the «очно / онлайн» tabs, which are EARS-8 (#1771): until
 * that lands, an offline/hybrid event renders NO format block rather than an
 * online block that lies about where the doctor should go.
 */
export function eventFormatBlockProps(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): EventFormatBlockProps | null {
  if (view.format !== "online") return null;
  return {
    kind: "online",
    roomOpensLine: copy.roomOpensLine,
    duringLine: copy.duringLine,
  };
}
