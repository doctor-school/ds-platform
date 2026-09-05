import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { eventExperts, events, experts } from "@ds/db";
import { PUBLIC_EVENT_STATES } from "@ds/schemas";
import { DRIZZLE_DB } from "../database/database.tokens.js";

// 012 EARS-8 (#1290) — the data access behind the ONE canonical merged speaker
// projection (012-design §4). ONE bounded read per request, keyed by the event
// id list, so a listing that needs the speakers of N cards issues ONE query and
// not N: the §5.2 «no N+1 composition» rule applies to the upcoming-broadcast
// listing exactly as it does to the 015 catalog.
//
// 012 EARS-24 (#1607) — the cutover: the free-text speaker list no longer
// exists, so the projection has a SINGLE source, the `event_experts` link table.
//
// Every eligibility predicate is repeated HERE, in SQL, rather than trusted from
// the write path: the projection is a query policy, not a migration job, and an
// imported or manually corrupted row must fail closed (012-design §3.3).

type Db = DrizzleHandle["db"];

/** One ACTIVE link whose expert is eligible (published, non-retired). */
export interface ExpertSpeakerProjectionRow {
  /** The stable `event_experts` row id — the last term of the LD-2 total order. */
  linkId: string;
  eventId: string;
  position: number;
  role: string | null;
  expertId: string;
  expertSlug: string;
  expertName: string | null;
  expertCredentials: string | null;
  photoRef: string | null;
}

/** The §5.2 public key: a canonical UUID addresses by id, anything else by slug. */
export type PublicEventKey = { id: string } | { slug: string };

@Injectable()
export class SpeakerProjectionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Resolve a public event key to its id under the SAME visibility policy the
   * 004 event page applies: the row must be active and its state inside the
   * publicly-renderable allow-list. An unknown key and a `draft` key are both
   * `null` here, so the caller answers one indistinguishable 404 (EARS-16).
   */
  async publicEventIdFor(key: PublicEventKey): Promise<string | null> {
    const [row] = await this.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          "id" in key ? eq(events.id, key.id) : eq(events.slug, key.slug),
          eq(events.recordStatus, "active"),
          inArray(events.state, [...PUBLIC_EVENT_STATES]),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * Every ACTIVE expert link of the given events whose expert is ELIGIBLE:
   * `published`, not retired, not editorially removed. An ineligible expert is
   * dropped by this predicate, so it never reaches a public surface.
   */
  async eligibleExpertLinks(
    eventIds: string[],
  ): Promise<ExpertSpeakerProjectionRow[]> {
    if (eventIds.length === 0) return [];
    return this.db
      .select({
        linkId: eventExperts.id,
        eventId: eventExperts.eventId,
        position: eventExperts.position,
        role: eventExperts.role,
        expertId: experts.id,
        expertSlug: experts.slug,
        expertName: sql<string | null>`CASE WHEN ${experts.familyName} IS NULL OR ${experts.givenName} IS NULL THEN NULL ELSE concat_ws(' ', ${experts.familyName}, ${experts.givenName}, ${experts.patronymic}) END`,
        expertCredentials: experts.credentials,
        photoRef: experts.photoRef,
      })
      .from(eventExperts)
      .innerJoin(experts, eq(experts.id, eventExperts.expertId))
      .where(
        and(
          inArray(eventExperts.eventId, eventIds),
          eq(eventExperts.status, "active"),
          isNull(eventExperts.deletedAt),
          eq(experts.status, "published"),
          isNull(experts.deletedAt),
          isNull(experts.contentRemovedAt),
        ),
      );
  }

}
