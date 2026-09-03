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
  /**
   * The sign-up card's format VALUE — canvas:213 «Онлайн · комната эфира».
   * Deliberately a second map rather than a reuse of {@link format}: the hero
   * kicker names the format in one word, while the card's conditions row also
   * says WHERE the doctor goes. One map for both would force the kicker to read
   * «Школа · Онлайн · комната эфира».
   */
  formatDetail: Record<EventParticipationFormat, string>;
  /** Sign-up card footnote, rendered under the CTA in the register state only. */
  signupNote: string;
  /**
   * 020 EARS-2 (#1765) — what the «Программа» section says when the operator
   * attached NO programme PDF. The section is never omitted and never left as
   * an empty labelled box (EARS-19): it states the honest reason, and the
   * reason differs by lifecycle, because «опубликуем ближе к дате» is a
   * promise only an event that has not happened yet can keep.
   */
  programmePending: string;
  programmeNeverPublished: string;
  /**
   * The hero plate's countdown — canvas:171 «Скоро · через 5 дней». The
   * lifecycle WORD stays host copy; the countdown is a fact of `startsAt`, so
   * it is mapped once here rather than derived per host from a clock the two
   * would be free to read differently.
   *
   * `days` is the RU plural triple the `ru-RU` cardinal rule selects from —
   * one · few · many («день» · «дня» · «дней»).
   */
  inPrefix: string;
  days: readonly [one: string, few: string, many: string];
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
  priceFree: "Бесплатно для врача",
  format: {
    online: "Онлайн",
    offline: "Очно",
    hybrid: "Очно и онлайн",
  },
  formatDetail: {
    online: "Онлайн · комната эфира",
    offline: "Очно",
    hybrid: "Очно и онлайн",
  },
  signupNote: "Нужна регистрация — вернём вас на эту страницу.",
  programmePending: "Программу опубликуем ближе к дате события.",
  programmeNeverPublished: "Программа этого события не публиковалась.",
  inPrefix: "через",
  days: ["день", "дня", "дней"],
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
 * The hero kicker's PARTS — «Школа · Онлайн» split into the two facts that
 * compose it, plus the school's destination when the host has one.
 *
 * 020 EARS-2 (#1765): the school is a LINK exactly when `links.school` is
 * present, and the read model only puts it there when the serving host mounts a
 * school page. There is no `href: null` to branch on and no disabled variant —
 * a host with no school page renders the same words as plain text, which is
 * what «absent rather than dead» means on this element.
 */
export interface EventPageKickerParts {
  school: string;
  /** Present only when this host has a school page to send the reader to. */
  schoolHref?: string;
  formatLabel: string;
}

export function eventPageKickerParts(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): EventPageKickerParts {
  const label = view.links.school?.label ?? view.school;
  return {
    school: label,
    ...(view.links.school ? { schoolHref: view.links.school.href } : {}),
    formatLabel: copy.format[view.format],
  };
}

/**
 * The hero kicker as ONE string — «Школа · Онлайн». The school is the event's
 * own field, the format word is copy; neither is host knowledge. This is the
 * plain-text rendering; {@link eventPageKickerParts} is what a surface uses
 * when the school may be a link.
 */
export function eventPageKicker(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): string {
  const parts = eventPageKickerParts(view, copy);
  return `${parts.school} · ${parts.formatLabel}`;
}

/**
 * 020 EARS-2 (#1765) — the «Программа» section's content decision.
 *
 * Exactly one of the two keys is ever set. With a PDF the section is the
 * download; without one it is a SENTENCE, chosen by lifecycle from the view —
 * so neither host branches on `state` and the two storefronts cannot tell a
 * doctor different stories about the same missing programme. An empty labelled
 * box is never a possible outcome (EARS-19).
 */
export interface EventProgrammeContent {
  downloadHref?: string;
  statement?: string;
}

export function eventProgrammeContent(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): EventProgrammeContent {
  if (view.programPdfUrl) return { downloadHref: view.programPdfUrl };
  // `published` / `live` are ahead of or at the air date, so the programme can
  // still arrive. `ended` / `hidden` / `in_archive` cannot — for those the
  // honest answer is that it was never published, not a promise about a date
  // that has passed.
  const upcoming = view.state === "published" || view.state === "live";
  return { statement: upcoming ? copy.programmePending : copy.programmeNeverPublished };
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

const RU_PLURAL = new Intl.PluralRules("ru-RU");

/**
 * The plate's countdown — «через 5 дней» (canvas:171), or `null` when there is
 * nothing to count down to.
 *
 * It answers only for a `published` event: «В эфире», «Эфир завершён» and
 * «Скрыто» are terminal or present-tense words that a countdown would
 * contradict, and an event whose start is already past has no days left to
 * name. The count is CALENDAR days in Moscow, not a 24-hour division of the
 * remaining milliseconds — «через 1 день» must mean «завтра» to a reader, and
 * an event 20 hours away tomorrow morning would otherwise round to «через 0».
 *
 * `now` is a parameter so the callers that must be deterministic (the tests,
 * and any future static render) are not reading a wall clock through a back
 * door.
 */
export function eventLifecycleCountdown(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
  now: Date = new Date(),
): string | null {
  if (view.state !== "published") return null;
  const days = mskCalendarDaysBetween(now, new Date(view.startsAt));
  if (days <= 0) return null;
  const form = RU_PLURAL.select(days);
  const word =
    form === "one" ? copy.days[0] : form === "few" ? copy.days[1] : copy.days[2];
  return `${copy.inPrefix} ${days} ${word}`;
}

const MSK_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: MSK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Whole Moscow calendar days from `from` to `to` (negative when `to` is past). */
function mskCalendarDaysBetween(from: Date, to: Date): number {
  const utcMidnight = (d: Date) => Date.parse(`${MSK_DAY_KEY.format(d)}T00:00:00Z`);
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
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
  // Canvas:206-228 order — Участие · Формат · Длительность. «Участие» leads:
  // the price is the fact that decides whether a doctor reads any of the rest,
  // and the canvas sets it in the success tone for exactly that reason. (The
  // canvas's fourth row, «НМО 2 балла», needs an accreditation field the public
  // read does not carry — that is EARS-2 / #1765, and inventing it here would be
  // the untracked seam F-22 forbids.)
  const conditions: EventSignupCondition[] = [
    { label: copy.conditionPrice, value: copy.priceFree, tone: "success" },
    { label: copy.conditionFormat, value: copy.formatDetail[view.format] },
    {
      label: copy.conditionDuration,
      value: `${view.durationMin} ${copy.minutes}`,
    },
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
 * 020 EARS-2 (#1765) — `href` comes from `links.speakerPages`, the read model's
 * per-HOST answer to «does this speaker have a page here». A speaker with no
 * entry gets no `href` and the card renders the name as plain text; there is no
 * `null` href and no disabled state, because a link into a route that is not
 * mounted is precisely the dead affordance EARS-2 forbids. Matching is by the
 * stable `expertSlug` key alone — a legacy speaker has no identity and names are
 * never compared (012-design §5.2).
 *
 * No `footerHref` is produced: the «12 эфиров · страница эксперта →» footer
 * needs a broadcast count the public read does not carry.
 *
 * The canvas (canvas:118) carries ONE «Ведёт» label above the section, so every
 * card after the first suppresses it with an explicit `null` — `undefined`
 * would RESTORE the card's canvas default.
 */
export function eventSpeakerCards(view: EventPageView): EventSpeakerCardProps[] {
  const pages = new Map(
    view.links.speakerPages.map((page) => [page.speakerKey, page.href]),
  );
  return view.speakers.map((speaker, index) => {
    const href =
      speaker.source === "expert" ? pages.get(speaker.expertSlug) : undefined;
    return {
      ...speakerCardProps(speaker),
      ...(href ? { href } : {}),
      heading: index === 0 ? undefined : null,
    };
  });
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
