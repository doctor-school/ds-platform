import {
  type EventLiveStrip,
  type EventParticipationFormat,
  type MyEventItem,
  type RawQueryRecord,
  type RecordingProjection,
  doctorEventsFeedDayOf,
  formatEventTime,
  rawQueryBoolean,
  rawQueryList,
  rawQueryScalar,
} from "@ds/schemas";
import type { DayAgendaRow, EventListItem } from "@ds/design-system/blocks";

import type { FeedCopy } from "../copy/feed-copy";
import { type EventsStorefrontHostConfig, eventPageHref } from "../host-config";
import type { PluralNoun } from "./event-count";
import { withoutFeedParam } from "./feed-url";
import { isRecordingPlayable } from "./recording-cta";

/** The feed's reading: «Будущие» or «Прошедшие» (019 LD-1, LD-13). */
export type FeedTense = "upcoming" | "past";

/**
 * One event of the feed, whichever host read it — the card model every host's
 * adapter maps its read DTO onto (gate §4.5, the one adapter). An absent field
 * renders no chip (gate row 39): no host branch decides what a card shows.
 */
export interface EventsFeedCard {
  readonly id: string;
  readonly slug: string;
  readonly startsAt: string;
  readonly format: EventParticipationFormat;
  /** The 012 dictionary kind's title (019 «Amendment — 2026-10-01»). */
  readonly kindTitle: string;
  readonly title: string;
  readonly school: string;
  readonly speakers: readonly string[];
  readonly specialties?: readonly string[];
  readonly state: "upcoming" | "live" | "past";
  readonly signUpCount: number;
  readonly pulCost?: number;
  readonly nmo?: boolean;
  readonly city?: string;
  readonly seatsLeft?: number;
  /** The recording projection of a past event; `null` when the read carries none. */
  readonly recording: RecordingProjection | null;
  /** The venue's IANA zone of a hybrid event (#2547); absent ⇒ no venue line. */
  readonly venueZone?: string;
}

/**
 * The read's extent (019 LD-2). «Показать ещё» widens it: on «Будущие» to
 * `nextTo`, on «Прошедшие» back to `nextFrom`; `null` = nothing lies beyond.
 */
export interface EventsFeedHorizon {
  readonly from: string;
  readonly to: string;
  readonly nextTo: string | null;
  readonly nextFrom: string | null;
}

/**
 * What the head subline counts when the host states it in counts (gate row 19):
 * the upcoming events and their distinct schools. Absent when the read carries
 * no such counts.
 */
export interface EventsFeedSummary {
  readonly events: number;
  readonly schools: number;
}

/**
 * One feed read, mapped. `remaining` = matching events beyond the extent (the
 * M of «Показать ещё N из M»); `nextBatch` = the ones the next step adds (N).
 */
export interface EventsFeedPage {
  /**
   * Wave-2 gate §4.3 D10 — the api's «сегодня» (`YYYY-MM-DD`, МСК), the day
   * the read resolved its horizon against: the page's one today
   * ({@link pageTodayOf}).
   */
  readonly today: string;
  readonly cards: readonly EventsFeedCard[];
  readonly horizon: EventsFeedHorizon;
  readonly remaining: number;
  readonly nextBatch: number;
  readonly summary?: EventsFeedSummary;
  /**
   * The facet panel's options the read names, keyed by facet (`project` …
   * on the Academy, `kind` / `city` on the doctor host — D9); empty when the
   * read names none.
   */
  readonly facetOptions: FeedFacetOptions;
  /** The events this reading matches — the page plus the rest of its reach («Показать N», row 60). */
  readonly matching: number;
  /**
   * What the read was targeted on (017 design §5), when the host's read
   * reports it — the doctor read does; the Academy read carries none. The
   * home nearest-events block states its kicker and picks its `пусто`
   * variant from it (017 EARS-9): by `mode`, never by the size of a set.
   */
  readonly targeting?: EventsFeedTargeting;
}

/**
 * The read's targeting (017 design §5): `targeted` — a managed specialty →
 * direction chain; `general` — the «Другое» fallback; `all` — no specialty
 * chosen (or targeting off by request). `adjacentDirectionIds` is empty
 * exactly when the chosen specialty reaches no adjacent area.
 */
export interface EventsFeedTargeting {
  readonly mode: "targeted" | "general" | "all";
  readonly adjacentDirectionIds: readonly string[];
}

/** One facet option: the URL value, its title and its count under the other facets. */
export interface FeedFacetOption {
  readonly slug: string;
  readonly title: string;
  readonly count: number;
}
export type FeedFacetOptions = Readonly<
  Record<string, readonly FeedFacetOption[]>
>;

/**
 * The one adapter of gate §4.5: a pure mapping of the host's feed read DTO onto
 * the feed page model. Data in, data out — it decides no lifecycle, resolves no
 * route and gates nothing.
 */
export type EventsStorefrontAdapter = (
  dto: unknown,
  context: { readonly tense: FeedTense },
) => EventsFeedPage;

/** A read the page renders or replaces with its per-block error (019 EARS-9). */
export type BlockRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

/**
 * Wave-2 gate §4.3 D10 — the page's ONE today: the api's, from the feed read
 * the page rendered with (both views make that read). The month grid (today,
 * past days), «Сегодня», the default month, the picker's «архив» and the
 * day-href tense boundary all take it, so they never disagree with the read.
 * Only a failed feed read — no read carries a today — falls back to the МСК
 * day of the page clock.
 */
export function pageTodayOf(
  read: BlockRead<EventsFeedPage>,
  now: Date = new Date(),
): string {
  return read.ok ? read.value.today : doctorEventsFeedDayOf(now);
}

/** The live block's strip cap (019 «Amendment — 2026-10-05», «Live block»). */
export const LIVE_STRIP_CAP = 2;

/** The «Мои события» cut's row cap (019 «Amendment — 2026-10-05»). */
export const MY_EVENTS_CUT = 3;

type Routes = Pick<EventsStorefrontHostConfig["routes"], "eventPage">;

export interface FeedItemsContext {
  readonly tense: FeedTense;
  readonly viewerZone: string;
  readonly registeredSlugs: ReadonlySet<string>;
  readonly routes: Routes;
  readonly copy: FeedCopy;
}

/**
 * The cards → `EventList` items, per the canvas card mapping
 * (`design-source/events-feed-kit.js` `card()`). Times follow the viewer zone
 * for online and hybrid events and МСК for offline ones (004 «Amendment —
 * 2026-10-02»), and so does the day a card groups under.
 */
export function buildFeedItems(
  cards: readonly EventsFeedCard[],
  { tense, viewerZone, registeredSlugs, routes, copy }: FeedItemsContext,
): EventListItem[] {
  const past = tense === "past";
  return cards.map((card) => {
    const time = formatEventTime({
      startsAt: card.startsAt,
      participationFormat: card.format,
      viewerZone,
    });
    const href = eventPageHref({ routes }, card.slug);
    const isPast = past || card.state === "past";
    const live = !isPast && card.state === "live";
    const venue =
      card.format === "hybrid" && card.venueZone
        ? formatEventTime({ startsAt: card.startsAt, viewerZone: card.venueZone })
        : null;
    return {
      id: card.id,
      groupKey: isPast ? time.groupMonth : time.groupDay,
      groupLabel: isPast ? time.monthLabel : `${time.date}, ${time.weekday}`,
      variant: isPast ? ("past" as const) : ("upcoming" as const),
      href,
      time: time.time,
      tzLabel: time.zoneLabel,
      dateLabel: copy.card.date(time.date, time.weekdayShort),
      school: card.school,
      title: card.title,
      speakers: card.speakers.map((name) => ({ name })),
      ...(card.specialties ? { specialties: card.specialties } : {}),
      kindLabel: card.kindTitle,
      formatLabel: copy.card.format[card.format],
      ...(card.nmo ? { nmoLabel: copy.card.nmo } : {}),
      ...(card.pulCost
        ? { pulCost: card.pulCost, pulCostLabel: copy.card.pul(card.pulCost) }
        : {}),
      ...(card.city ? { city: card.city } : {}),
      ...(!isPast && card.seatsLeft !== undefined
        ? {
            seatsLeft: card.seatsLeft,
            seatsLeftLabel: copy.card.seatsLeft,
            soldOutLabel: copy.card.soldOut,
          }
        : {}),
      ...(venue
        ? { venueTimeLabel: copy.card.venueTime(venue.time, venue.zoneLabel) }
        : {}),
      // The canvas recording line (`events-feed-kit.js` `card()`): a published
      // cut reads «Запись · <duration>» and offers «Смотреть запись»; anything
      // else — no recording, an offline event, a cut still being prepared —
      // reads «Без записи» with no action. One rule decides «published»:
      // `isRecordingPlayable`, so the line and the button never disagree.
      ...(isPast
        ? {
            recordingLabel: isRecordingPlayable(card.recording)
              ? copy.card.recording(card.recording?.durationSec ?? null)
              : copy.card.noRecording,
          }
        : {}),
      ...(isPast && isRecordingPlayable(card.recording)
        ? { ctaHref: href, ctaLabel: copy.card.recordingCta }
        : {}),
      live,
      liveLabel: copy.card.live,
      // 019 EARS-2 as narrowed 2026-10-08: never on a past card.
      ...(!isPast
        ? { signUpCount: card.signUpCount, signUpLabel: copy.card.signUp }
        : {}),
      registered: !isPast && registeredSlugs.has(card.slug),
      registeredLabel: copy.card.registered,
    };
  });
}

/**
 * «Показать ещё N из M» — N the events the next widening adds (the api's
 * `nextBatch`), M the remainder (`remaining`). The widening is a day step, not
 * a fixed page, so N is read off the data, never a page size.
 */
export function showMoreLabel(
  nextBatch: number,
  remaining: number,
  copy: FeedCopy,
): string {
  if (remaining <= 0 || nextBatch <= 0) return copy.feed.showMore;
  return copy.feed.showMoreOf(nextBatch, remaining);
}

export interface LiveStripProps {
  readonly key: string;
  readonly liveLabel: string;
  readonly title: string;
  readonly titleHref: string;
  readonly meta: string;
  readonly actionLabel: string;
  readonly actionHref: string;
}

/**
 * The live read → at most {@link LIVE_STRIP_CAP} strips, earliest first as the
 * read orders them, plus the «Ещё N в эфире →» overflow line. The action href is
 * the server's (019 EARS-6): the viewer's registration only picks the label.
 */
export function liveStripView(
  strips: readonly EventLiveStrip[],
  {
    viewerZone,
    routes,
    copy,
  }: { viewerZone: string; routes: Routes; copy: FeedCopy },
): { strips: LiveStripProps[]; moreLabel: string | null } {
  const shown = strips.slice(0, LIVE_STRIP_CAP).map((strip) => {
    const end = formatEventTime({ startsAt: strip.endsAt, viewerZone });
    return {
      key: strip.eventId,
      liveLabel: copy.live.heading,
      title: strip.title,
      titleHref: eventPageHref({ routes }, strip.slug),
      meta: [
        `${strip.presenceCount} ${copy.live.inRoom}`,
        strip.school,
        `${copy.live.until} ${end.time} ${end.zoneLabel}`,
      ]
        .filter((segment) => segment.length > 0)
        .join(" · "),
      actionLabel: strip.viewerIsRegistered
        ? copy.live.enterRoom
        : copy.live.openEvent,
      actionHref: strip.href,
    };
  });
  const overflow = strips.length - shown.length;
  return { strips: shown, moreLabel: overflow > 0 ? copy.live.more(overflow) : null };
}

/**
 * The «Мои события» cut (019 EARS-11 as amended 2026-10-05): the nearest
 * {@link MY_EVENTS_CUT} registered upcoming events, a live one excluded — it is
 * in the live block already.
 */
export function myEventsCut(
  events: readonly MyEventItem[],
  {
    viewerZone,
    routes,
    copy,
  }: { viewerZone: string; routes: Routes; copy: FeedCopy },
): DayAgendaRow[] {
  return [...events]
    .filter((event) => event.state !== "live")
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, MY_EVENTS_CUT)
    .map((event) => {
      const time = formatEventTime({
        startsAt: event.startsAt,
        participationFormat: event.participationFormat,
        viewerZone,
      });
      return {
        href: eventPageHref({ routes }, event.slug),
        time: `${time.time} ${time.zoneLabel}`,
        school: `${time.date}, ${time.weekdayShort} · ${event.school}`,
        title: event.title,
        liveLabel: copy.card.live,
      };
    });
}

/**
 * #1973 — a reading is EMPTY only when its extent holds no card AND nothing
 * matching lies beyond it. With matches beyond, the extent is merely short of
 * them: the feed offers «Показать ещё» toward them, never «Нет … по фильтру»
 * under a non-zero count.
 */
export function feedReadsEmpty(page: {
  readonly cards: readonly unknown[];
  readonly remaining: number;
}): boolean {
  return page.cards.length === 0 && page.remaining <= 0;
}

export interface EmptyFeedState {
  readonly title: string;
  readonly description: string;
  readonly action: { readonly label: string; readonly href: string } | null;
}

/**
 * The empty feed (019 EARS-9, LD-9): with a facet applied it names the first one
 * in the canvas order (`events-feed-kit.js` `facetChips`) and links its removal;
 * an explicit specialty list offers the adjacent specialties instead.
 */
export function emptyFeedState(
  query: RawQueryRecord,
  {
    listing,
    noun,
    copy,
    titles = {},
  }: {
    listing: string;
    noun: PluralNoun;
    copy: FeedCopy;
    /** The read's facet options — a facet value is named by its title. */
    titles?: FeedFacetOptions;
  },
): EmptyFeedState {
  const titleOf = (key: string, value: string) =>
    titles[key]?.find((option) => option.slug === value)?.title ?? value;
  const remove = (key: string, value?: string) =>
    withoutFeedParam(listing, query, key, value);

  const specialty = rawQueryList(query.specialty);
  if (
    specialty !== undefined &&
    !(specialty.length === 1 && ["mine-and-adjacent", "all"].includes(specialty[0]!))
  ) {
    return {
      title: copy.feed.emptyByFacet(noun.many, copy.facet.specialty),
      description: copy.feed.emptyByFacetBody,
      action: { label: copy.feed.widenSpecialty, href: remove("specialty") },
    };
  }

  const chips: { label: string; href: string }[] = [];
  for (const value of rawQueryList(query.format) ?? []) {
    const name =
      copy.card.format[value as EventParticipationFormat] ?? value;
    chips.push({ label: `${copy.facet.format}: ${name}`, href: remove("format", value) });
  }
  for (const value of rawQueryList(query.kind) ?? []) {
    chips.push({
      label: `${copy.facet.kind}: ${titleOf("kind", value)}`,
      href: remove("kind", value),
    });
  }
  for (const value of rawQueryList(query.city) ?? []) {
    chips.push({ label: `${copy.facet.city}: ${value}`, href: remove("city", value) });
  }
  if (rawQueryBoolean(query.nmo) === true) {
    chips.push({ label: copy.facet.nmo, href: remove("nmo") });
  }
  for (const key of ["project", "expert", "topic"] as const) {
    for (const value of rawQueryList(query[key]) ?? []) {
      chips.push({
        label: `${copy.facet[key]}: ${titleOf(key, value)}`,
        href: remove(key, value),
      });
    }
  }
  const q = rawQueryScalar(query.q);
  if (q !== undefined) {
    chips.push({ label: copy.facet.query(q), href: remove("q") });
  }

  const [first] = chips;
  if (first) {
    return {
      title: copy.feed.emptyByFacet(noun.many, first.label),
      description: copy.feed.emptyByFacetBody,
      action: { label: copy.feed.removeFacet(first.label), href: first.href },
    };
  }
  if (rawQueryBoolean(query.free) !== undefined) {
    return {
      title: copy.feed.emptyFiltered(noun.many),
      description: copy.feed.emptyFilteredBody,
      action: { label: copy.feed.resetFilters, href: remove("free") },
    };
  }
  return { title: copy.feed.empty(noun.many), description: "", action: null };
}
