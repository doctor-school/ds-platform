import { Inject, Injectable } from "@nestjs/common";
import type { PublicEventPageSpeaker } from "@ds/schemas";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/index.js";
import {
  type ExpertSpeakerProjectionRow,
  type LegacySpeakerProjectionRow,
  type PublicEventKey,
  SpeakerProjectionRepository,
} from "./speaker-projection.repository.js";
import { TaxonomyError } from "./taxonomy.errors.js";

// 012 EARS-8 (#1290) — THE canonical merged speaker resolver.
//
// EARS-8 does not ask for «a merge»; it asks for exactly ONE. Three shipped
// public surfaces read speakers — `GET /v1/public/events/:key/speakers`,
// `PublicEventPage.speakers` and `UpcomingBroadcastCard.speakers` — and before
// this file each assembled its own list from `event_speakers` alone. Any second
// implementation is what makes two surfaces disagree, so this service is the
// only place in the codebase that merges, orders or suppresses a speaker row;
// the card surface MAPS this result to its thinner `{ name }` shape rather than
// querying again (see `EventsService.toUpcomingCard`).
//
// The merge policy (012-design §4):
//
//   • an ACTIVE link to an ELIGIBLE (published, non-retired, non-removed)
//     expert supersedes EXACTLY the legacy row its `legacy_speaker_id` names;
//   • every other active legacy row remains, including one that merely shares a
//     name — names are never compared anywhere in this file;
//   • a draft/retired expert, or a retired link, suppresses nothing: the
//     matched legacy row stays as the fallback, and restoring the link
//     suppresses that same stable row again;
//   • nothing here writes. Clearing a mapped row's name/regalia is the explicit
//     editorial removal command of §2.4, never a side effect of a read.
//
// The total order is LD-2's: `position ASC`, source rank (`expert` before
// `legacy`), stable row id ASC. The third term is not decoration — two rows can
// legitimately share a position only in imported/corrupted data, and a public
// list that reshuffles between two identical requests is a defect.

/** Source rank of the LD-2 total order: an expert precedes a legacy row. */
const SOURCE_RANK = { expert: 0, legacy: 1 } as const;

/** One merged item plus the two order keys that are not part of its DTO. */
interface OrderedSpeaker {
  position: number;
  rank: number;
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

  /** The merged, ordered projection of ONE event, by stable id. */
  async resolve(eventId: string): Promise<PublicEventPageSpeaker[]> {
    const byEvent = await this.resolveMany([eventId]);
    return byEvent.get(eventId) ?? [];
  }

  /**
   * The merged, ordered projection of MANY events in two bounded queries — the
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

    const sourceClosed = await this.repo.isSourceClosed();
    const [legacy, links] = await Promise.all([
      sourceClosed ? Promise.resolve([]) : this.repo.legacySpeakers(ids),
      this.repo.eligibleExpertLinks(ids),
    ]);

    // Only an ELIGIBLE link reaches this list (the repository predicate), so the
    // suppression set is by construction free of draft/retired experts.
    const suppressed = new Set(
      links
        .map((l) => l.legacySpeakerId)
        .filter((id): id is string => id !== null),
    );

    const ordered = new Map<string, OrderedSpeaker[]>(ids.map((id) => [id, []]));
    for (const link of links) {
      const item = await this.expertItem(link);
      // Fail closed: a published expert missing its display fields is corrupted
      // data, not a public item. Its matched legacy row is deliberately left
      // suppressed — the operator declared that person superseded, and silently
      // resurrecting the old row would publish a name the editor replaced.
      if (!item) continue;
      ordered.get(link.eventId)?.push({
        position: link.position,
        rank: SOURCE_RANK.expert,
        id: link.linkId,
        item,
      });
    }
    for (const row of legacy) {
      if (suppressed.has(row.id)) continue;
      ordered.get(row.eventId)?.push({
        position: row.position,
        rank: SOURCE_RANK.legacy,
        id: row.id,
        item: this.legacyItem(row),
      });
    }

    for (const [eventId, rows] of ordered) {
      rows.sort(
        (a, b) =>
          a.position - b.position ||
          a.rank - b.rank ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      byEvent.set(
        eventId,
        rows.map((r) => r.item),
      );
    }
    return byEvent;
  }

  /** The legacy arm — exactly the pre-012 publish-safe pair plus its tag. */
  private legacyItem(row: LegacySpeakerProjectionRow): PublicEventPageSpeaker {
    return {
      source: "legacy",
      name: row.name,
      // The write model's free-text `regalia` is the public `credentials`; the
      // column is NOT NULL with a `''` default, so an empty string is a real
      // "no credentials", never a missing key.
      credentials: row.regalia,
    };
  }

  /**
   * The expert arm. `photoUrl` is signed at read time (the bucket is private, an
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
