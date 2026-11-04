import { Inject, Injectable } from "@nestjs/common";
import {
  FEED_EVENTS_LIMIT,
  type FeedEvents,
  parseDoctorEventsFeedQuery,
  type SpecialtyFeed,
  SPECIALTY_FEED_ORDER,
  type SpecialtyRef,
  specialtyEventsHref,
  specialtyFeedBlocks,
} from "@ds/schemas";
import { DoctorEventsService } from "./doctor-events.service.js";
import { SpecialtyError } from "./specialties.errors.js";
import { SpecialtiesService } from "./specialties.service.js";

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
  ) {}

  async envelope(input: {
    specialty: string;
    loggedIn: boolean;
  }): Promise<SpecialtyFeed> {
    const specialty = await this.resolve(input.specialty);
    return {
      specialty,
      blocks: specialtyFeedBlocks(specialty.code),
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
      throw new Error("doctor events feed codec rejected a book specialty code");
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
