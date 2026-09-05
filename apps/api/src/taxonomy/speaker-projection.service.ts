import { Inject, Injectable } from "@nestjs/common";
import type { PublicEventPageSpeaker } from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  type ExpertSpeakerProjectionRow,
  type PublicEventKey,
  SpeakerProjectionRepository,
} from "./speaker-projection.repository.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-8 (#1290) — THE canonical speaker resolver.
//
// EARS-8 asks for exactly ONE. Three shipped public surfaces read speakers —
// `GET /v1/public/events/:key/speakers`, `PublicEventPage.speakers` and
// `UpcomingBroadcastCard.speakers` — and any second implementation is what makes
// two surfaces disagree, so this service is the only place in the codebase that
// selects or orders a speaker row; the card surface MAPS this result to its
// thinner `{ name }` shape rather than querying again (see
// `EventsService.toUpcomingCard`).
//
// 012 EARS-24 (#1607) — after the cutover there is nothing to merge: the ONLY
// speaker source is an ACTIVE `event_experts` link to an ELIGIBLE (published,
// non-retired, non-removed) expert. Nothing here writes.
//
// The total order is `position ASC`, stable link id ASC. The second term is not
// decoration — two links can legitimately share a position only in
// imported/corrupted data, and a public list that reshuffles between two
// identical requests is a defect.

/** One projected item plus the order keys that are not part of its DTO. */
interface OrderedSpeaker {
  position: number;
  id: string;
  item: PublicEventPageSpeaker;
}

@Injectable()
export class SpeakerProjectionService {
  constructor(
    @Inject(SpeakerProjectionRepository)
    private readonly repo: SpeakerProjectionRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * The public standalone read: resolve the §5.2 key under the 004 visibility
   * policy, then project. An unknown key and a non-public (`draft`) event are
   * the SAME 404 `RESOURCE_NOT_FOUND`, so a hidden draft leaks no "exists but
   * private" oracle (EARS-16). An eligible event with no speakers is an
   * ordinary empty array, never a 404.
   */
  async publicSpeakersFor(
    key: PublicEventKey,
  ): Promise<PublicEventPageSpeaker[]> {
    const eventId = await this.repo.publicEventIdFor(key);
    if (!eventId) throw new TaxonomyError("RESOURCE_NOT_FOUND");
    return this.resolve(eventId);
  }

  /** The ordered projection of ONE event, by stable id. */
  async resolve(eventId: string): Promise<PublicEventPageSpeaker[]> {
    const byEvent = await this.resolveMany([eventId]);
    return byEvent.get(eventId) ?? [];
  }

  /**
   * The ordered projection of MANY events in ONE bounded query — the
   * shape every listing must use. Composing this per card would be exactly the
   * N+1 §5.2 forbids, so `EventsService.listUpcoming` calls THIS and maps.
   * Every requested id is present in the result, an event with no visible
   * speaker carrying an empty array.
   */
  async resolveMany(
    eventIds: string[],
  ): Promise<Map<string, PublicEventPageSpeaker[]>> {
    const ids = [...new Set(eventIds)];
    const byEvent = new Map<string, PublicEventPageSpeaker[]>(
      ids.map((id) => [id, []]),
    );
    if (ids.length === 0) return byEvent;

    const links = await this.repo.eligibleExpertLinks(ids);

    const ordered = new Map<string, OrderedSpeaker[]>(ids.map((id) => [id, []]));
    for (const link of links) {
      const item = await this.expertItem(link);
      // Fail closed: a published expert missing its display fields is corrupted
      // data, not a public item.
      if (!item) continue;
      ordered.get(link.eventId)?.push({
        position: link.position,
        id: link.linkId,
        item,
      });
    }

    for (const [eventId, rows] of ordered) {
      rows.sort(
        (a, b) =>
          a.position - b.position ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      byEvent.set(
        eventId,
        rows.map((r) => r.item),
      );
    }
    return byEvent;
  }

  /**
   * The expert item. `photoUrl` is signed at read time (the bucket is private, an
   * unsigned URL is dead — #842) and stays PRESENT and nullable so the client
   * renders the initials fallback rather than a broken image. Returns `null`
   * when the row cannot form a complete public item.
   */
  private async expertItem(
    link: ExpertSpeakerProjectionRow,
  ): Promise<PublicEventPageSpeaker | null> {
    if (!link.expertName || !link.role) return null;
    return {
      source: "expert",
      expertId: link.expertId,
      expertSlug: link.expertSlug,
      name: link.expertName,
      // Optional on the expert record; the public item is a string DTO, so an
      // absent credential is an empty string, never a null or a missing key.
      credentials: link.expertCredentials ?? "",
      photoUrl: link.photoRef ? await this.storage.urlFor(link.photoRef) : null,
      role: link.role,
    };
  }
}
