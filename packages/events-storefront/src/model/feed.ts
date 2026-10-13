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
import type {
  DayAgendaRow,
  EventListItem,
  EventsFilterHost,
} from "@ds/design-system/blocks";

import type { FeedCopy } from "../copy/feed-copy";
import { type EventsStorefrontHostConfig, eventPageHref } from "../host-config";
import { type PluralNoun, formatEventCount } from "./event-count";
import { hasAppliedFacets, resetFacetsHref } from "./facets";
import { FACET_KEYS, pageHref, withoutFeedQuery } from "./feed-url";
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
 * M of «Показать ещё N (осталось M)»); `nextBatch` = the ones the next step
 * adds (N).
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
  { readonly ok: true; readonly value: T } | { readonly ok: false };

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
        ? formatEventTime({
            startsAt: card.startsAt,
            viewerZone: card.venueZone,
          })
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
 * The «Показать ещё» label of both tenses — «Показать ещё N (осталось M)»: N
 * the events the next step adds (the api's `nextBatch` — 10, the last step the
 * remainder; 019 LD-2), M the remainder beyond this screen (`remaining`). N is
 * read off the data, never a page size.
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
  return {
    strips: shown,
    moreLabel: overflow > 0 ? copy.live.more(overflow) : null,
  };
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

/** One action of the empty state — a link to another reading of the page. */
export interface EmptyFeedAction {
  readonly label: string;
  readonly href: string;
}

/**
 * The empty state (canvas `emptyOf`): the widening, when one removal finds
 * events, as the primary action, and «Сбросить фильтры» beside it whenever a
 * facet is applied.
 */
export interface EmptyFeedState {
  readonly title: string;
  readonly description: string;
  readonly widen: EmptyFeedAction | null;
  readonly reset: EmptyFeedAction | null;
}

/** The empty state of a feed with nothing to widen — no facet applied. */
export function plainEmptyFeedState(
  noun: PluralNoun,
  copy: FeedCopy,
): EmptyFeedState {
  return {
    title: copy.feed.empty(noun.many),
    description: "",
    widen: null,
    reset: null,
  };
}

/**
 * The most feed reads one empty state may make to count its widening (#2786):
 * the facet keys come from the URL, so the fan-out per page is fixed here.
 */
export const MAX_WIDEN_READS = 4;

/** One applied condition the empty state can offer to drop. */
interface EmptyFeedChip {
  readonly label: string;
  /** The page query without it — the widen read's query and the action's href. */
  readonly without: RawQueryRecord;
  /** The action's label when it is not «Убрать фильтр «…»». */
  readonly widen?: string;
  readonly specialty?: true;
}

/**
 * Counts the events of the query's tense, over its whole reach, under `without`
 * — `null` when the read failed (that condition is then passed over).
 */
export type WidenMatching = (without: RawQueryRecord) => Promise<number | null>;

/**
 * The empty feed (019 EARS-9, LD-9; canvas `events-feed-kit.js` `K.empty`): the
 * applied conditions in the canvas `facetChips` order — the Academy topic, a
 * picked specialty list, format, kind, city, НМО, project, expert, the search —
 * each asked in turn how many events of the tense its removal finds; the first
 * that finds any is named with that count and its removal offered (a picked
 * specialty widens to the adjacent ones). When none does, the state says so
 * and offers no widening. Either way it offers «Сбросить фильтры» — the page
 * without the host's facets (canvas `emptyOf`). Facet values are named by the
 * read's titles, a picked specialty by the specialty book. Only the host's own
 * facet keys (`FACET_KEYS[filterSet]`) are conditions: a foreign key in a
 * crafted URL reaches no read, so it makes no chip and spends no widen read.
 *
 * At most one widen read per facet key, and at most `MAX_WIDEN_READS` per
 * empty page: the keys come from the URL, so the read count is bounded by
 * code, not by the request. A facet with several values selected is passed
 * over unread — the values OR within the facet, so dropping one of them
 * leaves a subset of an already-empty result (the canvas would count zero
 * for each of them). Past the cap the state offers no widening.
 */
export async function emptyFeedState(
  query: RawQueryRecord,
  {
    listing,
    noun,
    copy,
    filterSet,
    titles = {},
    specialtyName = () => undefined,
    matching,
  }: {
    listing: string;
    noun: PluralNoun;
    copy: FeedCopy;
    /** The host's facet set — only its keys are conditions of this page. */
    filterSet: EventsFilterHost;
    /** The read's facet options — a facet value is named by its title. */
    titles?: FeedFacetOptions;
    /** A picked specialty's name from the specialty book, by its code. */
    specialtyName?: (code: string) => string | undefined;
    matching: WidenMatching;
  },
): Promise<EmptyFeedState> {
  if (!hasAppliedFacets(query, filterSet))
    return plainEmptyFeedState(noun, copy);

  const own = new Set(FACET_KEYS[filterSet]);
  const titleOf = (key: string, value: string) =>
    titles[key]?.find((option) => option.slug === value)?.title ?? value;
  const chips: EmptyFeedChip[] = [];
  const chipsOf = (
    key: string,
    label: (value: string) => string,
    widen?: string,
  ) => {
    if (!own.has(key)) return;
    const values = rawQueryList(query[key]) ?? [];
    if (values.length !== 1) return;
    chips.push({
      label: label(values[0]!),
      without: withoutFeedQuery(query, key),
      ...(widen ? { widen } : {}),
    });
  };

  chipsOf(
    "topic",
    (v) => `${copy.facet.topic}: ${titleOf("topic", v)}`,
    copy.feed.widenTopic,
  );
  const specialty = own.has("specialty")
    ? rawQueryList(query.specialty)
    : undefined;
  if (
    specialty !== undefined &&
    specialty.length > 0 &&
    !(
      specialty.length === 1 &&
      ["mine-and-adjacent", "all"].includes(specialty[0]!)
    )
  ) {
    const first = specialty[0]!;
    chips.push({
      label: `${copy.facet.specialty}: ${specialtyName(first) ?? first}`,
      without: withoutFeedQuery(query, "specialty"),
      widen: copy.feed.widenSpecialty,
      specialty: true,
    });
  }
  chipsOf(
    "format",
    (v) =>
      `${copy.facet.format}: ${copy.card.format[v as EventParticipationFormat] ?? v}`,
  );
  chipsOf("kind", (v) => `${copy.facet.kind}: ${titleOf("kind", v)}`);
  chipsOf("city", (v) => `${copy.facet.city}: ${v}`);
  if (own.has("nmo") && rawQueryBoolean(query.nmo) === true) {
    chips.push({
      label: copy.facet.nmo,
      without: withoutFeedQuery(query, "nmo"),
    });
  }
  chipsOf("project", (v) => `${copy.facet.project}: ${titleOf("project", v)}`);
  chipsOf("expert", (v) => `${copy.facet.expert}: ${titleOf("expert", v)}`);
  const q = own.has("q") ? rawQueryScalar(query.q) : undefined;
  if (q !== undefined) {
    chips.push({
      label: copy.facet.query(q),
      without: withoutFeedQuery(query, "q"),
    });
  }

  const reset: EmptyFeedAction = {
    label: copy.feed.resetFilters,
    href: resetFacetsHref(listing, query, filterSet),
  };
  // One widen read at a time, stopping at the first that finds events.
  for (const chip of chips.slice(0, MAX_WIDEN_READS)) {
    const found = await matching(chip.without);
    if (found === null || found <= 0) continue;
    const count = formatEventCount(found, noun);
    return {
      title: copy.feed.emptyByFacet(noun.many, chip.label),
      description: chip.specialty
        ? copy.feed.widenSpecialtyCount(count)
        : copy.feed.widenCount(count),
      widen: {
        label: chip.widen ?? copy.feed.removeFacet(chip.label),
        href: pageHref(listing, chip.without),
      },
      reset,
    };
  }
  return {
    title: copy.feed.emptyFiltered(noun.many),
    description: copy.feed.emptyFilteredBody,
    widen: null,
    reset,
  };
}
