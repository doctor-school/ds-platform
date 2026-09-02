import { Inject, Injectable } from "@nestjs/common";
import {
  addDoctorEventsFeedDays,
  DOCTOR_EVENTS_FEED_HORIZON_DAYS,
  DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS,
  DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS,
  type DoctorEventCard,
  type DoctorEventDayGroup,
  type DoctorEventsFeed,
  type DoctorEventsFeedQuery,
  type DoctorEventsFeedTargeting,
  doctorEventsFeedDayOf,
  doctorEventsFeedHorizonWidth,
  formatDoctorEventsFeedDayLabel,
} from "@ds/schemas";
import {
  type DoctorFeedRow,
  DoctorEventsRepository,
} from "./doctor-events.repository.js";
import { SpecialtyError } from "./specialties.errors.js";
import { TargetingService } from "./targeting.service.js";

/**
 * 019 EARS-3 (#1518) — the day-grouped, specialty-targeted read.
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
 * ## Wave-1 card fields
 *
 * `format`, `kind`, `nmo`, `pulCost`, `city`/`seatsLeft` are read from what the
 * 007 aggregate actually authors today: 007 authors WEBINAR broadcasts, files
 * them under managed directions, and has no НМО, Pul-cost, city or seat column
 * at all. So the mapping states the truth of the current authoring model rather
 * than inventing values — `format: "webinar"`, `kind` = the event's managed
 * direction, `nmo: false`, `pulCost: 0` («бесплатно для врача»), and no
 * `city`/`seatsLeft` key. Widening 007's authoring to the remaining four
 * formats and the НМО/Pul/offline fields is tracked as decision-debt in
 * `DEBT.md`; the contract already carries them, so that widening is a mapper
 * change and not a reshape.
 */
@Injectable()
export class DoctorEventsService {
  constructor(
    @Inject(DoctorEventsRepository)
    private readonly repository: DoctorEventsRepository,
    @Inject(TargetingService)
    private readonly targeting: TargetingService,
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

    const horizon = resolveHorizon(query, today);
    const targeting = await this.resolveTargeting(
      query,
      input.specialtyReference,
    );

    const rows = await this.repository.findFeedRows({
      directionIds:
        targeting.mode === "all"
          ? null
          : [...targeting.directionIds, ...targeting.adjacentDirectionIds],
      fromInstant: new Date(`${horizon.from}T00:00:00+03:00`),
      toInstant: new Date(`${horizon.to}T00:00:00+03:00`),
      kindIds: query.kind,
      q: query.q,
    });

    const cards = await this.toCards(rows);
    const filtered = cards.filter((card) => {
      if (query.format.length > 0 && !query.format.includes(card.format)) {
        return false;
      }
      if (query.nmo === true && !card.nmo) return false;
      if (query.free === true && card.pulCost !== 0) return false;
      if (query.city.length > 0) {
        return card.city !== undefined && query.city.includes(card.city);
      }
      return true;
    });

    const days = groupByDay(rows, filtered);
    const width = doctorEventsFeedHorizonWidth(horizon.from, horizon.to);

    return {
      tense: query.tense,
      from: horizon.from,
      to: horizon.to,
      days,
      totalCount: filtered.length,
      // «показать ещё» is a URL edit, not a client paging state (LD-2/EARS-8):
      // the server names the next `to`, the client writes it into the address.
      nextTo:
        width >= DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS
          ? null
          : addDoctorEventsFeedDays(
              horizon.to,
              Math.min(
                DOCTOR_EVENTS_FEED_HORIZON_STEP_DAYS,
                DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS - width,
              ),
            ),
      targeting,
    };
  }

  private async resolveTargeting(
    query: DoctorEventsFeedQuery,
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
    const [speakers, kinds, signUps] = await Promise.all([
      this.repository.findLeadSpeakers(ids),
      this.repository.findPrimaryDirections(ids),
      this.repository.countSignUps(ids),
    ]);

    return rows.map((row) => ({
      id: row.id,
      href: `/events/${row.slug}`,
      startsAt: row.startsAt.toISOString(),
      endsAt: new Date(
        row.startsAt.getTime() + row.durationMin * 60_000,
      ).toISOString(),
      format: "webinar" as const,
      // `kind` is the direction ID — the vocabulary the `?kind=` facet takes, so
      // a card value round-trips; `kindTitle` is its display projection.
      kind: kinds.get(row.id)?.id ?? "",
      kindTitle: kinds.get(row.id)?.title ?? "",
      title: row.title,
      speaker: speakers.get(row.id) ?? "",
      source: row.school,
      nmo: false,
      pulCost: 0,
      signUpCount: signUps.get(row.id) ?? 0,
      state: row.state === "live" ? "live" : row.state === "ended" ? "recorded" : "normal",
    }));
  }
}

/**
 * The LD-2 bounded horizon. `from` defaults to today for «Будущие» and to the
 * window ending today for «Прошедшие»; `to` defaults to one horizon width on.
 * A caller-supplied `to` is CLAMPED to the maximum rather than rejected — a
 * hand-edited URL degrades to the widest honest read, never to a 400.
 */
function resolveHorizon(
  query: DoctorEventsFeedQuery,
  today: string,
): { from: string; to: string } {
  const past = query.tense === "past";
  const from =
    query.from ??
    (past
      ? addDoctorEventsFeedDays(today, -DOCTOR_EVENTS_FEED_HORIZON_DAYS)
      : today);
  const fallbackTo = past
    ? addDoctorEventsFeedDays(today, 1)
    : addDoctorEventsFeedDays(from, DOCTOR_EVENTS_FEED_HORIZON_DAYS);
  const requested = query.to ?? fallbackTo;

  const width = doctorEventsFeedHorizonWidth(from, requested);
  if (width <= 0) return { from, to: addDoctorEventsFeedDays(from, 1) };
  if (width > DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS) {
    return {
      from,
      to: addDoctorEventsFeedDays(from, DOCTOR_EVENTS_FEED_MAX_HORIZON_DAYS),
    };
  }
  return { from, to: requested };
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
