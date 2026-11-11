import { Inject, Injectable } from "@nestjs/common";
import {
  type AdjacentArea,
  type AdjacentAreas,
  FEED_EVENTS_LIMIT,
  type FeedEvents,
  parseDoctorEventsFeedQuery,
  type SpecialtyFeed,
  SPECIALTY_FEED_ORDER,
  type SpecialtyRef,
  specialtyEventsHref,
  specialtyFeedBlocks,
  specialtyFeedPath,
} from "@ds/schemas";
import { DoctorEventsService } from "./doctor-events.service.js";
import { SpecialtyError } from "./specialties.errors.js";
import { SpecialtiesService } from "./specialties.service.js";
import { SPECIALTY_FEED_VALUE_COPY } from "./specialty-feed.value-copy.js";
import { TargetingRepository } from "./targeting.repository.js";
import { TargetingService } from "./targeting.service.js";

/**
 * 018 EARS-1 / EARS-4 (#1496, #1499) — the specialty feed (018-design §1, §7).
 *
 * ## The envelope is a constant over the connected types (LD-1)
 *
 * {@link envelope} reads exactly one thing — the specialty the PATH names —
 * and composes the F-018-1 block list from `specialtyFeedBlocks`. No viewer
 * input reaches the block list or its order: the session sets only
 * `viewer.loggedIn`. Two doctors of one specialty therefore get the same
 * blocks in the same order by construction.
 *
 * ## The events block builds no events feed of its own (EARS-4)
 *
 * {@link events} is 019's targeted read — {@link DoctorEventsService.feed},
 * the one selection, lifecycle, card mapping and «Скрыть число записавшихся»
 * rule of the doctor storefront — asked for the PATH specialty alone (an
 * explicit `specialty` pick, which takes no adjacency widening: adjacent areas
 * are their own block, 018 F-018-3), then cut to the nearest
 * {@link FEED_EVENTS_LIMIT}. There is no second query.
 *
 * ## A path naming no member of the book is not-found
 *
 * The book membership check is 017's `resolveMember`; its 422 «not in book»
 * refusal is right for a SUBMITTED value, while here the reference is the
 * resource address, so the feed answers 404 `SPECIALTY_FEED_NOT_FOUND`.
 */
@Injectable()
export class SpecialtyFeedService {
  constructor(
    @Inject(SpecialtiesService)
    private readonly specialties: SpecialtiesService,
    @Inject(DoctorEventsService)
    private readonly doctorEvents: DoctorEventsService,
    @Inject(TargetingService)
    private readonly targeting: TargetingService,
    @Inject(TargetingRepository)
    private readonly targetingRows: TargetingRepository,
  ) {}

  async envelope(input: {
    specialty: string;
    loggedIn: boolean;
  }): Promise<SpecialtyFeed> {
    const specialty = await this.resolve(input.specialty);
    return {
      specialty,
      blocks: specialtyFeedBlocks(specialty.code, {
        value: SPECIALTY_FEED_VALUE_COPY,
      }),
      order: SPECIALTY_FEED_ORDER,
      viewer: { loggedIn: input.loggedIn },
    };
  }

  async events(input: { specialty: string }): Promise<FeedEvents> {
    const specialty = await this.resolve(input.specialty);
    const query = parseDoctorEventsFeedQuery({ specialty: specialty.code });
    if (!query.success) {
      // The code is a resolved member of the book; a failure here is a broken
      // codec, not a visitor input.
      throw new Error(
        "doctor events feed codec rejected a book specialty code",
      );
    }
    const feed = await this.doctorEvents.feed({
      query: query.data,
      specialtyReference: null,
    });
    return {
      items: feed.days.flatMap((day) => day.items).slice(0, FEED_EVENTS_LIMIT),
      allEventsHref: specialtyEventsHref(specialty.code),
    };
  }

  /**
   * 018 EARS-8 — the adjacent areas. A feed exists per closed-book specialty
   * only, so an entry is an adjacent SPECIALTY, reached over managed rows
   * alone: the chosen specialty's targeting set (017's
   * {@link TargetingService.resolve} — own directions, then their active
   * adjacency edges) and one more `direction_specialties` hop to the
   * specialties linked to each adjacent direction. There is no likeness path.
   *
   * The chosen specialty itself and «Другое» are never entries; a specialty
   * reached through several adjacent directions appears once, through the
   * heaviest edge (the targeting order breaks a weight tie). Entries are
   * ordered by that weight, then by the specialty name in the book's order.
   */
  async adjacent(input: { specialty: string }): Promise<AdjacentAreas> {
    const chosen = await this.resolve(input.specialty);
    if (chosen.isOther) return { items: [] };

    const { adjacentDirections } = await this.targeting.resolve(chosen.id);
    const rank = new Map(
      adjacentDirections.map((direction, index) => [
        direction.id,
        { direction, index },
      ]),
    );
    const rows = await this.targetingRows.findLinkedSpecialties([
      ...rank.keys(),
    ]);

    const best = new Map<
      string,
      { area: AdjacentArea; weight: number; index: number }
    >();
    for (const row of rows) {
      if (row.id === chosen.id || row.isOther) continue;
      const via = rank.get(row.directionId);
      if (!via) continue;
      const current = best.get(row.id);
      if (current && current.index <= via.index) continue;
      best.set(row.id, {
        weight: via.direction.weight,
        index: via.index,
        area: {
          specialty: {
            id: row.id,
            code: row.code,
            name: row.name,
            isOther: row.isOther,
          },
          direction: {
            id: via.direction.id,
            slug: via.direction.slug,
            title: via.direction.title,
          },
          feedHref: specialtyFeedPath(row.code),
        },
      });
    }

    // `best` keeps the rows' name order; the sort is stable.
    const items = [...best.values()]
      .sort((a, b) => b.weight - a.weight)
      .map((entry) => entry.area);
    return { items };
  }

  private async resolve(reference: string): Promise<SpecialtyRef> {
    try {
      return await this.specialties.resolveMember(reference);
    } catch (error) {
      if (
        error instanceof SpecialtyError &&
        error.errorCode === "SPECIALTY_NOT_IN_BOOK"
      ) {
        throw new SpecialtyError("SPECIALTY_FEED_NOT_FOUND");
      }
      throw error;
    }
  }
}
