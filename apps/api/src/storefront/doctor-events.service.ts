import { Inject, Injectable } from "@nestjs/common";
import {
  type DoctorEventCard,
  type DoctorEventDayGroup,
  type DoctorEventsFeed,
  type DoctorEventsFeedQuery,
  type DoctorEventsFeedTargeting,
  type DoctorEventsMonthGrid,
  type DoctorEventsMonthQuery,
  type EventsLiveRead,
  doctorEventsFeedDayOf,
  doctorEventsMonthDayList,
  doctorEventsMonthFacets,
  doctorEventsMonthFirstDay,
  doctorEventsMonthNextFirstDay,
  doctorEventsMonthOf,
  formatDoctorEventsFeedDayLabel,
  MONTH_BROADCAST_STATES,
  PAST_BROADCAST_STATES,
  UPCOMING_BROADCAST_STATES,
} from "@ds/schemas";
import { eventEconomyFacts } from "../events/event-economy-facts.js";
import {
  eventHorizonInstants,
  resolveEventHorizon,
  resolveEventHorizonBeyond,
} from "../events/event-horizon.js";
import { EventsLiveService } from "../events/events-live.service.js";
import type { ParticipationRoutes } from "../events/participation-cta.resolver.js";
import { RecordingsProjectionService } from "../recordings/recordings.projection.js";
import {
  type DoctorFeedRow,
  DoctorEventsRepository,
} from "./doctor-events.repository.js";
import { SpecialtyError } from "./specialties.errors.js";
import { TargetingService } from "./targeting.service.js";

/**
 * 019 EARS-3 (#1518) — the day-grouped, specialty-targeted read — and
 * EARS-4 (#1519), the `MonthGrid` projection of the SAME read (see
 * {@link DoctorEventsService.month}).
 *
 * ## What this service is allowed to decide
 *
 * The horizon, the day grouping and the envelope. That is all. Targeting is
 * ASKED of 017's {@link TargetingService} (#1484), which resolves the managed
 * specialty → own direction → adjacent direction chain over 018's authored
 * adjacency rows (#1483). This service never compares two names, never computes
 * a likeness and holds no fallback that would widen a specialty with no
 * adjacency rows: such a specialty simply contributes an EMPTY adjacency list
 * and the feed then carries only that specialty's own events (@EARS-3 @failure).
 *
 * ## Why there is no ranking
 *
 * The order IS the calendar. Day groups ascend by day, items ascend by start
 * instant, and the response schema is `.strict()` — there is no field a score
 * could be written into and no code path that would compute one (EARS-3).
 *
 * ## Card fields
 *
 * `format` is the event's own attendance mode (`online | offline | hybrid`) and
 * `kind` its 012 event-kind dictionary entry `{ id, slug, title }` (019
 * amendment, 012 EARS-28) — both authored on the event, never derived from its
 * directions. `source` is the published project the event is linked to, falling
 * back to the authored `school`. НМО and the Pul cost come from
 * `eventEconomyFacts` (`../events/event-economy-facts.ts`), the one module the
 * 020 event page reads them from too (#1766), so a card and the page it opens
 * can never disagree. The feed reads only `audience = doctors` events (012
 * LD-12): an Academy (`experts`) event never reaches it.
 */
@Injectable()
export class DoctorEventsService {
  constructor(
    @Inject(DoctorEventsRepository)
    private readonly repository: DoctorEventsRepository,
    @Inject(TargetingService)
    private readonly targeting: TargetingService,
    // 019 EARS-6 (#1521) + wave-2 gate D5: the live strips come from the ONE
    // live resolution both storefronts share; this service hands it only the
    // doctor audience, the targeting and the doctor route table.
    @Inject(EventsLiveService)
    private readonly liveEvents: EventsLiveService,
    // Wave-2 gate rows 10, 31: a recorded card carries the ONE 014 recording
    // projection the Academy past card carries, so both hosts apply one
    // playability rule.
    @Inject(RecordingsProjectionService)
    private readonly recordings: RecordingsProjectionService,
  ) {}

  async feed(input: {
    query: DoctorEventsFeedQuery;
    /** The remembered specialty of the 017 anonymous session / profile; `null` for a visitor who has not chosen. */
    specialtyReference: string | null;
    now?: Date;
  }): Promise<DoctorEventsFeed> {
    const now = input.now ?? new Date();
    const today = doctorEventsFeedDayOf(now);
    const { query } = input;

    const horizon = resolveEventHorizon(query, today);
    const targeting = await this.resolveTargeting(
      query,
      input.specialtyReference,
    );

    const directionIds =
      targeting.mode === "all"
        ? null
        : [...targeting.directionIds, ...targeting.adjacentDirectionIds];

    // Row 30 — the tense is the lifecycle split the Academy listing applies,
    // read in its own order: «Будущие» soonest first, «Прошедшие» newest first.
    const tenseRead = {
      states:
        query.tense === "past"
          ? PAST_BROADCAST_STATES
          : UPCOMING_BROADCAST_STATES,
      order: query.tense === "past" ? "desc" : "asc",
    } as const;
    const rows = await this.repository.findFeedRows({
      ...tenseRead,
      directionIds,
      ...eventHorizonInstants(horizon),
      kindSlugs: query.kind,
      q: query.q,
    });

    const cards = await this.toCards(rows);
    const filtered = applyCardFacets(cards, query);

    const days = groupByDay(rows, filtered);
    // #1803 + gate rows 30, 32: the next bound («Будущие» `to`, «Прошедшие» an
    // older `from`) and the remainder are asked of the SAME feed predicate AND
    // the same card facets the window obeys — the one resolution both
    // storefronts share.
    const beyond = await resolveEventHorizonBeyond(
      horizon,
      query.tense,
      async (range) => {
        const beyondRows = await this.repository.findFeedRows({
          ...tenseRead,
          directionIds,
          ...range,
          kindSlugs: query.kind,
          q: query.q,
        });
        return applyCardFacets(
          beyondRows.map((row) => ({
            ...cardFacetsOf(row),
            startsAt: row.startsAt,
          })),
          query,
        ).map((row) => row.startsAt);
      },
    );

    return {
      tense: query.tense,
      from: horizon.from,
      to: horizon.to,
      days,
      totalCount: filtered.length,
      // «показать ещё» is a URL edit, not a client paging state (LD-2/EARS-8):
      // the server names the next bound, the client writes it into the address.
      nextTo: beyond.nextTo,
      nextFrom: beyond.nextFrom,
      remaining: beyond.remaining,
      nextBatch: beyond.nextBatch,
      targeting,
    };
  }

  /**
   * 019 EARS-4 (#1519) — the `MonthGrid` of
   * `GET /v1/storefront/doctor/events/month`: one cell per calendar day of the
   * month, over the SAME targeted read the day feed serves (019-design §3).
   *
   * ## Why the counts cannot drift from the feed
   *
   * Because there is no second selection path. The month read resolves
   * targeting with {@link resolveTargeting}, selects rows with the SAME
   * `findFeedRows`, maps them with the SAME `toCards`, and filters them with the
   * SAME `applyCardFacets` the feed uses — only the horizon differs, and the
   * grouping key is the same МСК day. A grid count and the size of the feed's
   * day group for that day are therefore the same number by construction rather
   * than by a test that would have to be re-proved on every mapper change.
   *
   * ## One aggregate read, never a query per day
   *
   * The whole month is ONE `findFeedRows` call plus the three per-event lookups
   * `toCards` already batches. Thirty round trips for thirty cells would be the
   * shape this explicitly is not.
   *
   * ## The horizon is «Будущие» only, per LD-10
   *
   * Release 1 reads the upcoming tense on both 019 routes (#1525 restores the
   * tense row in wave 2), so the lower bound is `max(first of month, today)`:
   * a day already past carries `count: 0` rather than a historical figure the
   * feed beside the grid would not show. `hasLive` is the same `state: "live"`
   * the card carries — 006's lifecycle, never a start time compared in code.
   */
  async month(input: {
    query: DoctorEventsMonthQuery;
    specialtyReference: string | null;
    now?: Date;
  }): Promise<DoctorEventsMonthGrid> {
    const now = input.now ?? new Date();
    const today = doctorEventsFeedDayOf(now);
    const month = input.query.month ?? doctorEventsMonthOf(today);

    const facets = doctorEventsMonthFacets(input.query);
    const targeting = await this.resolveTargeting(
      facets,
      input.specialtyReference,
    );

    const firstDay = doctorEventsMonthFirstDay(month);
    const endDay = doctorEventsMonthNextFirstDay(month);
    // The upcoming-only lower bound. A month wholly in the past yields an empty
    // window and therefore a grid of zeroes — an honest render of the matrix
    // row, not a special case.
    const fromDay = firstDay > today ? firstDay : today;

    const rows =
      fromDay >= endDay
        ? []
        : await this.repository.findFeedRows({
            states: MONTH_BROADCAST_STATES,
            order: "asc",
            directionIds:
              targeting.mode === "all"
                ? null
                : [
                    ...targeting.directionIds,
                    ...targeting.adjacentDirectionIds,
                  ],
            fromInstant: new Date(`${fromDay}T00:00:00+03:00`),
            toInstant: new Date(`${endDay}T00:00:00+03:00`),
            kindSlugs: facets.kind,
            q: facets.q,
          });

    const cards = applyCardFacets(await this.toCards(rows), facets);
    const startsAt = new Map(rows.map((row) => [row.id, row.startsAt]));

    const counts = new Map<string, { count: number; hasLive: boolean }>();
    for (const card of cards) {
      const instant = startsAt.get(card.id);
      if (instant === undefined) continue;
      const day = doctorEventsFeedDayOf(instant);
      const cell = counts.get(day) ?? { count: 0, hasLive: false };
      cell.count += 1;
      if (card.state === "live") cell.hasLive = true;
      counts.set(day, cell);
    }

    return {
      month,
      today,
      // Every day of the month is emitted, `count: 0` included, so a host
      // renders the grid straight from the response (019-design §3).
      days: doctorEventsMonthDayList(month).map((date) => ({
        date,
        count: counts.get(date)?.count ?? 0,
        hasLive: counts.get(date)?.hasLive ?? false,
      })),
      targeting,
    };
  }

  /**
   * 019 EARS-6 (#1521) — «Идёт сейчас» on the doctor storefront: every targeted
   * эфир running right now, earliest start first, `[]` when none (wave-2 gate
   * §4.2, D5). The selection, the entry policy and the counts are the shared
   * {@link EventsLiveService}'s; this method contributes the doctor's own
   * inputs — the `doctors` audience and the SAME targeting the feed resolves
   * («моя и смежные» over the remembered specialty; none chosen ⇒ untargeted).
   */
  async live(input: {
    /** The remembered specialty of the 017 anonymous session; `null` degrades to the untargeted read. */
    specialtyReference: string | null;
    /** The calling host's route table — the only host-specific thing in this read. */
    routes: ParticipationRoutes;
    /** The authenticated subject, absent for a guest. */
    sub?: string | undefined;
  }): Promise<EventsLiveRead> {
    const targeting = await this.resolveTargeting(
      { specialty: "mine-and-adjacent" },
      input.specialtyReference,
    );
    return this.liveEvents.live({
      audience: "doctors",
      directionIds:
        targeting.mode === "all"
          ? null
          : [...targeting.directionIds, ...targeting.adjacentDirectionIds],
      routes: input.routes,
      sub: input.sub,
    });
  }

  private async resolveTargeting(
    query: Pick<DoctorEventsFeedQuery, "specialty">,
    remembered: string | null,
  ): Promise<DoctorEventsFeedTargeting> {
    if (query.specialty === "all") {
      return {
        mode: "all",
        specialtyReference: null,
        directionIds: [],
        adjacentDirectionIds: [],
      };
    }

    const references = Array.isArray(query.specialty)
      ? query.specialty
      : remembered === null
        ? []
        : [remembered];

    // A visitor who has chosen no specialty is not silently targeted on a guess
    // — the read degrades to the untargeted one, which is the readable-for-a-
    // guest posture of EARS-12.
    if (references.length === 0) {
      return {
        mode: "all",
        specialtyReference: null,
        directionIds: [],
        adjacentDirectionIds: [],
      };
    }

    const directionIds = new Set<string>();
    const adjacentDirectionIds = new Set<string>();
    let mode: DoctorEventsFeedTargeting["mode"] = "general";
    let resolvedAny = false;

    for (const reference of references) {
      // A reference that has left the managed book DEGRADES the read, it never
      // refuses it. `__Host-ds_specialty` carries a one-year max-age against a
      // managed table, so a stale remembered reference is routine rather than
      // adversarial — and EARS-12 makes the feed fully readable with no account
      // at all. This is the same clamp-don't-reject posture `resolveHorizon`
      // applies to a hand-edited `to=`.
      const set = await this.resolveOrDegrade(reference);
      if (set === null) continue;
      resolvedAny = true;
      if (set.mode === "targeted") mode = "targeted";
      for (const direction of set.directions) directionIds.add(direction.id);
      // An explicit `specialty=<ids>` pick is the doctor asking for THOSE
      // specialties; the adjacency widening belongs to «моя и смежные».
      if (!Array.isArray(query.specialty)) {
        for (const direction of set.adjacentDirections) {
          adjacentDirectionIds.add(direction.id);
        }
      }
    }

    // Every reference left the book: report the untargeted read honestly rather
    // than a `targeted`/`general` envelope over an empty direction set, which
    // would render as «ничего не найдено» instead of the general feed.
    if (!resolvedAny) {
      return {
        mode: "all",
        specialtyReference: null,
        directionIds: [],
        adjacentDirectionIds: [],
      };
    }

    for (const id of directionIds) adjacentDirectionIds.delete(id);

    return {
      mode,
      specialtyReference: Array.isArray(query.specialty)
        ? query.specialty.join(",")
        : remembered,
      directionIds: [...directionIds],
      adjacentDirectionIds: [...adjacentDirectionIds],
    };
  }

  /**
   * Resolve one specialty reference, or `null` when it names no member of the
   * closed book. Only that ONE semantic refusal is absorbed — every other
   * failure (a database fault, a bug in the traversal) still propagates, so the
   * degradation cannot hide a broken read behind a plausible-looking feed.
   */
  private async resolveOrDegrade(reference: string) {
    try {
      return await this.targeting.resolve(reference);
    } catch (error) {
      if (
        error instanceof SpecialtyError &&
        error.errorCode === "SPECIALTY_NOT_IN_BOOK"
      ) {
        return null;
      }
      throw error;
    }
  }

  private async toCards(rows: DoctorFeedRow[]): Promise<DoctorEventCard[]> {
    const ids = rows.map((row) => row.id);
    const endedIds = rows
      .filter((row) => isEnded(row.state))
      .map((row) => row.id);
    const [speakers, projectTitles, signUps, recordings] = await Promise.all([
      this.repository.findLeadSpeakers(ids),
      this.repository.findProjectTitles(ids),
      this.repository.countSignUps(ids),
      // The batch form — ONE statement for the whole page, never per card.
      this.recordings.resolveRecordingProjections(endedIds),
    ]);

    return rows.map((row) => ({
      id: row.id,
      // The slug travels as its own field AND as the minted `href`: 019 EARS-12
      // builds the guest `?resume=<slug>` return target from it, and a host that
      // had to slice it back out of `href` would be re-deriving an identifier.
      slug: row.slug,
      href: `/events/${row.slug}`,
      startsAt: row.startsAt.toISOString(),
      endsAt: new Date(
        row.startsAt.getTime() + row.durationMin * 60_000,
      ).toISOString(),
      // 019 amendment — the event's own attendance mode (in the facet fields)
      // and its 012 kind (`{ id, slug, title }`; the slug is the `?kind=` facet
      // vocabulary).
      ...cardFacetsOf(row),
      kind: row.kind,
      title: row.title,
      speaker: speakers.get(row.id) ?? "",
      // The published project the event belongs to; `school` until linked.
      source: projectTitles.get(row.id) ?? row.school,
      signUpCount: signUps.get(row.id) ?? 0,
      // 014 EARS-26 (#1741): `in_archive` is the legacy machine's «this эфир
      // happened and its recording is published» — the same fact `ended` carries
      // on the platform machine — so it projects to the SAME `recorded` card.
      // A separate card state would be the second surface 014-design §3.1
      // forbids.
      state:
        row.state === "live"
          ? "live"
          : isEnded(row.state)
            ? "recorded"
            : "normal",
      // Whether that recording is PLAYABLE is not this service's call: the card
      // carries the 014 projection and the shared package applies the one rule
      // (`isRecordingPlayable`) on both hosts (gate rows 10, 31).
      ...(isEnded(row.state) ? { recording: recordings.get(row.id)! } : {}),
    }));
  }
}

function isEnded(state: DoctorFeedRow["state"]): boolean {
  return state === "ended" || state === "in_archive";
}

/** The card fields the facets read — ONE projection for a card and for a row beyond the window. */
type CardFacetFields = Pick<
  DoctorEventCard,
  "format" | "nmo" | "pulCost" | "city"
>;

function cardFacetsOf(row: DoctorFeedRow): CardFacetFields {
  return { format: row.participationFormat, ...eventEconomyFacts() };
}

/**
 * The card-level facets — the ones 007 does not yet author as columns and that
 * are therefore applied after the mapping. ONE predicate, shared by the day feed
 * and the month grid, so the grid's counts and the feed's day-group sizes cannot
 * disagree about what a facet means (019-design §3, EARS-4).
 */
function applyCardFacets<T extends CardFacetFields>(
  cards: T[],
  facets: Pick<DoctorEventsFeedQuery, "format" | "nmo" | "free" | "city">,
): T[] {
  return cards.filter((card) => {
    if (facets.format.length > 0 && !facets.format.includes(card.format)) {
      return false;
    }
    if (facets.nmo === true && !card.nmo) return false;
    if (facets.free === true && card.pulCost !== 0) return false;
    if (facets.city.length > 0) {
      return card.city !== undefined && facets.city.includes(card.city);
    }
    return true;
  });
}

/** Chronological rows → day groups. A day with no surviving card is not emitted. */
function groupByDay(
  rows: DoctorFeedRow[],
  cards: DoctorEventCard[],
): DoctorEventDayGroup[] {
  const startsAt = new Map(rows.map((row) => [row.id, row.startsAt]));
  const groups: DoctorEventDayGroup[] = [];

  for (const card of cards) {
    const instant = startsAt.get(card.id);
    if (instant === undefined) continue;
    const day = doctorEventsFeedDayOf(instant);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(card);
    else {
      groups.push({
        day,
        label: formatDoctorEventsFeedDayLabel(day),
        items: [card],
      });
    }
  }

  return groups;
}
