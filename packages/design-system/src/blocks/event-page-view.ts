import { MOSCOW_TIME_ZONE, formatEventTime, isRegistrable } from "@ds/schemas";
import type {
  EventPageView,
  EventParticipationFormat,
  ParticipationCta,
  PublicEventPageSpeaker,
} from "@ds/schemas";

import type {
  EventSignupCardProps,
  EventSignupCondition,
} from "./event-signup-card";
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

/**
 * The event page's date/time parts and its calendar-day countdown are
 * projections of the one event-time formatter (`formatEventTime`,
 * `@ds/schemas`, 004 EARS-12) pinned to `Europe/Moscow`.
 */
function inMoscow(instant: string | Date) {
  return formatEventTime({ startsAt: instant, viewerZone: MOSCOW_TIME_ZONE });
}

/**
 * The RU copy DEFAULTS of the shared event page. A host may hand its own object
 * (the envelope EARS-18 allows); it may never hand its own MAPPING — every
 * function below takes the copy as data and keeps one shape.
 */
export interface EventPageCopy {
  /** Duration unit for the hero date line — «90 минут». */
  minutes: string;
  /** Sign-up card condition labels. */
  conditionFormat: string;
  conditionDuration: string;
  conditionPrice: string;
  /** The zero-cost participation reading — 020 EARS-12, never roubles. */
  priceFree: string;
  /**
   * The unit a NON-zero participation cost is counted in — «250 Pul». Pul are
   * attention points, so the unit is deliberately not a currency symbol: 020
   * invariants forbid a price and any financing statement on this page.
   */
  pulUnit: string;
  /**
   * 020 EARS-14 — the НМО condition row's label and value, and the hero chip.
   * НМО appears ONLY as a badge and as a conditions-line value, never as the
   * headline; when the event credits nothing, none of the three renders.
   */
  conditionNmo: string;
  nmoCredited: string;
  nmoChip: string;
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
  /** 020 EARS-8 — the format block's section label per kind. */
  formatHeading: Record<EventParticipationFormat, string>;
  /** The hybrid tabs' labels — «очно / онлайн» (F-020-2 Б). */
  formatTab: Record<EventFormatMode, string>;
  /**
   * 020 EARS-8 — the remaining offline seats, an RU plural triple
   * (one · few · many) around `{n}`, and the exhausted reading.
   */
  seatsLeft: readonly [one: string, few: string, many: string];
  seatsNone: string;
  /** 020 EARS-9 — the plain statement a full hybrid event makes on its block. */
  hybridSoldOut: { title: string; body: string };
  /**
   * 020 EARS-3 — the social proof: the total of colleagues registered, and
   * separately those from adjacent specialties. RU plural triples.
   */
  signUpsTotal: readonly [one: string, few: string, many: string];
  signUpsAdjacent: readonly [one: string, few: string, many: string];
  /** Wave-3 gate H2 (row 43) — the ended meta row's «Смотрели N коллег». */
  viewersLabel: string;
  colleagues: readonly [one: string, few: string, many: string];
}

export const EVENT_PAGE_COPY: EventPageCopy = {
  minutes: "минут",
  conditionFormat: "Формат",
  conditionDuration: "Длительность",
  conditionPrice: "Участие",
  priceFree: "Бесплатно для врача",
  pulUnit: "Pul",
  conditionNmo: "НМО",
  nmoCredited: "Баллы начисляются",
  nmoChip: "НМО",
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
  formatHeading: {
    online: "Эфир",
    offline: "Места",
    hybrid: "Как участвовать",
  },
  formatTab: { offline: "Очно", online: "Онлайн" },
  seatsLeft: ["Осталось {n} место", "Осталось {n} места", "Осталось {n} мест"],
  seatsNone: "Мест не осталось",
  hybridSoldOut: {
    title: "Очных мест не осталось",
    body: "Участвуйте онлайн — эфир тот же.",
  },
  signUpsTotal: [
    "Уже записался {n} коллега",
    "Уже записались {n} коллеги",
    "Уже записались {n} коллег",
  ],
  signUpsAdjacent: [
    "в том числе {n} врач смежной специальности",
    "в том числе {n} врача смежных специальностей",
    "в том числе {n} врачей смежных специальностей",
  ],
  viewersLabel: "Смотрели",
  colleagues: ["{n} коллега", "{n} коллеги", "{n} коллег"],
};

/** Pick the RU plural form of a `{n}` triple and fill in the number. */
function plural(
  forms: readonly [one: string, few: string, many: string],
  n: number,
): string {
  const form = RU_PLURAL.select(n);
  const pick = form === "one" ? forms[0] : form === "few" ? forms[1] : forms[2];
  return pick.replace("{n}", String(n));
}

/**
 * The facts of an event the page's times are formatted from — the instant and
 * the participation format, which decides whether the viewer's zone applies.
 */
export type EventPageMoment = Pick<EventPageView, "startsAt" | "format">;

/** The parts every surface of the page renders from the one UTC instant. */
export interface EventPageTimeParts {
  /** «19:00» */
  time: string;
  /** «28 августа» */
  date: string;
  /** «пятница» */
  weekday: string;
  /** «МСК», «GMT+5» — the zone the time is stated in (004 EARS-12). */
  zoneLabel: string;
}

/**
 * 020 «Amendment — 2026-10-02» (004 EARS-12 as amended, gate D9): an online or
 * hybrid event's time reads in the viewer's zone with its explicit label; an
 * offline event stays pinned to Moscow (`formatEventTime` owns that rule). The
 * server never knows the viewer's zone, so it calls this with the default
 * `Europe/Moscow` and the client island re-formats after mount
 * (`useViewerZone`).
 */
export function eventPageTimeParts(
  view: EventPageMoment,
  viewerZone: string = MOSCOW_TIME_ZONE,
): EventPageTimeParts {
  const { time, date, weekday, zoneLabel } = formatEventTime({
    startsAt: view.startsAt,
    participationFormat: view.format,
    viewerZone,
  });
  return { time, date, weekday, zoneLabel };
}

/**
 * The hero date line — «28 августа, 19:00 (МСК) · 90 минут». One string, so the
 * two hosts cannot disagree about the order of date, time, timezone and
 * duration for the same event (EARS-1: date + time + zone label + duration).
 */
export function eventPageDateLine(
  view: EventPageMoment & Pick<EventPageView, "durationMin">,
  copy: EventPageCopy = EVENT_PAGE_COPY,
  viewerZone: string = MOSCOW_TIME_ZONE,
): string {
  const { date, time, zoneLabel } = eventPageTimeParts(view, viewerZone);
  return `${date}, ${time} (${zoneLabel}) · ${view.durationMin} ${copy.minutes}`;
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
  return {
    statement: upcoming ? copy.programmePending : copy.programmeNeverPublished,
  };
}

/**
 * The hero chips — the event's target specialties in projection order, followed
 * by the НМО badge of canvas:52 when the event credits attention points.
 *
 * The badge is the ONLY headline-adjacent place НМО is allowed to appear (020
 * EARS-14): it is a chip beside the specialties and a conditions-line value,
 * never the title and never the primary filter. An event that credits nothing
 * gets NO chip — no «без НМО», no greyed placeholder — because the honest
 * reading of `nmo: false` is silence (LD-8).
 */
export function eventPageChips(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): readonly string[] {
  return view.nmo ? [...view.specialties, copy.nmoChip] : view.specialties;
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
    form === "one"
      ? copy.days[0]
      : form === "few"
        ? copy.days[1]
        : copy.days[2];
  return `${copy.inPrefix} ${days} ${word}`;
}

/** Whole Moscow calendar days from `from` to `to` (negative when `to` is past). */
function mskCalendarDaysBetween(from: Date, to: Date): number {
  const utcMidnight = (d: Date) =>
    Date.parse(`${inMoscow(d).groupDay}T00:00:00Z`);
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
  const { time, date, weekday, zoneLabel } = eventPageTimeParts(view);
  // Canvas:181-198 order — Участие · Формат · Длительность · НМО. «Участие»
  // leads: the cost is the fact that decides whether a doctor reads any of the
  // rest, and the canvas sets the FREE reading in the success tone for exactly
  // that reason — a non-zero Pul cost is a neutral fact, not good news, so it
  // keeps the default tone. The fourth row now comes from the read model
  // (`view.nmo`, #1766) and is ABSENT when the event credits nothing: «нет» or
  // a greyed placeholder would be a claim the page has no business making.
  //
  // An ENDED event offers no participation, so it states no participation
  // cost: canvas `phase: прошло` carries no «Участие» row, and «Бесплатно для
  // врача» under «Событие завершилось» would price a thing nobody can take
  // (020 EARS-19, #2072 comment 6217460822).
  const conditions: EventSignupCondition[] = [
    ...(view.state === "ended"
      ? []
      : [
          view.pulCost === 0
            ? ({
                label: copy.conditionPrice,
                value: copy.priceFree,
                tone: "success",
              } satisfies EventSignupCondition)
            : {
                label: copy.conditionPrice,
                value: `${view.pulCost} ${copy.pulUnit}`,
              },
        ]),
    { label: copy.conditionFormat, value: copy.formatDetail[view.format] },
    {
      label: copy.conditionDuration,
      value: `${view.durationMin} ${copy.minutes}`,
    },
    ...(view.nmo
      ? [{ label: copy.conditionNmo, value: copy.nmoCredited }]
      : []),
  ];
  return {
    timeLabel: time,
    dateLabel: date,
    weekdayLabel: `${weekday} · ${zoneLabel}`,
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
 * stable `expertSlug` key alone — names are never compared (012-design §5.2).
 *
 * No `footerHref` is produced: the «12 эфиров · страница эксперта →» footer
 * needs a broadcast count the public read does not carry.
 *
 * The canvas (canvas:118) carries ONE «Ведёт» label above the section, so every
 * card after the first suppresses it with an explicit `null` — `undefined`
 * would RESTORE the card's canvas default.
 */
export function eventSpeakerCards(
  view: EventPageView,
): EventSpeakerCardProps[] {
  const pages = new Map(
    view.links.speakerPages.map((page) => [page.speakerKey, page.href]),
  );
  return view.speakers.map((speaker, index) => {
    const href = pages.get(speaker.expertSlug);
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

/** The two halves of a hybrid event — the tab a hybrid format block opens on. */
export type EventFormatMode = "offline" | "online";

/**
 * The online half: when the room opens (before the start only) and what
 * happens inside.
 */
export interface EventFormatRoom {
  roomOpensLine?: string;
  duringLine: string;
}

/**
 * 020 EARS-8 — the format block, the only part of the page that differs
 * between formats. JSX-free: the page composes the block (and, for a hybrid
 * event, its URL-bound tabs) from this model.
 */
export type EventFormatModel =
  | ({ kind: "online"; heading: string } & EventFormatRoom)
  | { kind: "offline"; heading: string; seatsLine: string }
  | {
      kind: "hybrid";
      heading: string;
      tabs: Record<EventFormatMode, string>;
      room: EventFormatRoom;
      seatsLine: string;
      /** The tab the policy resolves: «онлайн» once the seats are gone. */
      defaultMode: EventFormatMode;
      /** EARS-9 — the plain statement of a full hybrid event, else `null`. */
      statement: { title: string; body: string } | null;
    };

/**
 * The format block for one viewer on one event (020 EARS-8 / EARS-9, wave-3
 * gate rows 33, 34, 41).
 *
 * - **online** — the room block: «Комната эфира откроется…» only BEFORE the
 *   start (canvas `beforeStart`), the during-эфир line while the event is
 *   upcoming or live.
 * - **offline** — the remaining seats; no ticket, no QR, no door-scan
 *   affordance (EARS-15 is wave 2) and no venue lines (gate row 32, #1771).
 * - **hybrid** — both halves as «очно / онлайн» tabs; the default tab is the
 *   policy's: `switch-to-online` (or no seats left) opens on «онлайн» and the
 *   block says why.
 *
 * An event that offers no participation (`ended`, `hidden`) has no format
 * block — the canvas draws none under `phase: прошло` — and a half with
 * nothing true to say is absent rather than an empty labelled box (EARS-19):
 * an offline event without a seat limit renders no block, a hybrid one only
 * its online half.
 *
 * It decides nothing about participation: the default tab READS the server
 * CTA's action and the event's seat fact; it never re-derives eligibility.
 */
export function eventFormatBlockProps(
  view: EventPageView,
  cta: ParticipationCta | null = null,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): EventFormatModel | null {
  if (!isRegistrable(view.state)) return null;
  const room: EventFormatRoom =
    view.state === "published"
      ? { roomOpensLine: copy.roomOpensLine, duringLine: copy.duringLine }
      : { duringLine: copy.duringLine };
  const online = (): EventFormatModel => ({
    kind: "online",
    heading: copy.formatHeading.online,
    ...room,
  });
  if (view.format === "online") return online();
  const seatsLine =
    view.seatsLeft === null
      ? null
      : view.seatsLeft === 0
        ? copy.seatsNone
        : plural(copy.seatsLeft, view.seatsLeft);
  if (view.format === "offline") {
    return seatsLine === null
      ? null
      : { kind: "offline", heading: copy.formatHeading.offline, seatsLine };
  }
  if (seatsLine === null) return online();
  const soldOut = view.seatsLeft === 0;
  return {
    kind: "hybrid",
    heading: copy.formatHeading.hybrid,
    tabs: copy.formatTab,
    room,
    seatsLine,
    defaultMode:
      soldOut || cta?.action === "switch-to-online" ? "online" : "offline",
    statement: soldOut ? copy.hybridSoldOut : null,
  };
}

/**
 * 020 EARS-3 (gate row 36) — the social proof under the sign-up card: the
 * colleagues already registered and, separately, those from adjacent
 * specialties. The same for a guest and a signed-in doctor (it is a fact of
 * the public read). Absent — never «0» — when the read carries no
 * `SignUpProof` (no sign-ups yet, or the hide option on), and on an ended
 * page, which the canvas draws without it (`notPast`).
 */
export function eventSocialProof(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): { total: string; adjacent: string | null } | null {
  if (view.signUps === null || view.state === "ended") return null;
  const { total, adjacentSpecialties } = view.signUps;
  return {
    total: plural(copy.signUpsTotal, total),
    adjacent:
      adjacentSpecialties > 0
        ? plural(copy.signUpsAdjacent, adjacentSpecialties)
        : null,
  };
}

/**
 * Wave-3 gate H2 (row 43) — the ended meta row's «Смотрели N коллег», from the
 * read's distinct-viewer count. No count and no stand-in when the read carries
 * none (EARS-19).
 */
export function eventViewersMeta(
  view: EventPageView,
  copy: EventPageCopy = EVENT_PAGE_COPY,
): { label: string; value: string } | null {
  if (view.viewers === null) return null;
  return {
    label: copy.viewersLabel,
    value: plural(copy.colleagues, view.viewers),
  };
}
