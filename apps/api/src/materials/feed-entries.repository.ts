import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { experts, feedEntries, organisations } from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import {
  beforeKeysetCursor,
  exactCursorInstant,
  organisationPubliclyDisplayed,
} from "../taxonomy/index.js";
import type { MaterialsTx } from "./materials.repository.js";

// 048 EARS-10 (#3512) — the ONLY reader and writer of `feed_entries` (Lead
// decision 8). A source writes its rows through here inside the transaction
// of the change that caused them; no admin endpoint touches the table
// directly. Slice 1 has one source, `academy` (own-materials.feed-source.ts).

type Db = DrizzleHandle["db"];

/** One card as a source writes it; the card date is kept on a rewrite. */
export interface FeedEntryWrite {
  sourcePlatform: "academy";
  sourceRef: string;
  materialId: string | null;
  kind: "news" | "column";
  title: string;
  /** The durable media key of the card image (an own material's cover). */
  imageRef: string | null;
  /** Never set by the `academy` source (CHECK `feed_entries_academy_image_is_ref`). */
  imageUrl: null;
  sourceName: string | null;
  authorExpertId: string | null;
  partnerOrganisationId: string | null;
  href: string;
  publishedAt: Date;
}

/** The `(published_at, id)` position a feed cursor carries. */
export interface FeedCursorPosition {
  instant: string;
  id: string;
}

/** 012 public expert: published, not retired, not editorially removed. */
export const expertPubliclyVisible: SQL = and(
  eq(experts.status, "published"),
  isNull(experts.deletedAt),
  isNull(experts.contentRemovedAt),
)!;

/**
 * 048 EARS-9, EARS-10, EARS-19 (#3513) — one page of the public feed, newest
 * first with ties by id, read from `feed_entries` joined ONLY to the directory
 * rows an entry references: its column's 012 expert (public state and current
 * name parts, judged now — a column is absent while its expert is not public)
 * and its 032 partner through the shared display predicate (the partner never
 * hides an entry, so it is a LEFT JOIN on the predicate). `materials` is never
 * read (V-6). A pure builder so the unit suite can inspect its SQL.
 */
export function publicFeedPageQuery(
  db: Db,
  limit: number,
  before: FeedCursorPosition | null,
) {
  const visible = or(isNull(feedEntries.authorExpertId), expertPubliclyVisible);
  return db
    .select({
      id: feedEntries.id,
      kind: feedEntries.kind,
      title: feedEntries.title,
      imageUrl: feedEntries.imageUrl,
      sourcePlatform: feedEntries.sourcePlatform,
      sourceName: feedEntries.sourceName,
      href: feedEntries.href,
      publishedAt: feedEntries.publishedAt,
      publishedAtCursor: exactCursorInstant(feedEntries.publishedAt),
      expertFamilyName: experts.familyName,
      expertGivenName: experts.givenName,
      expertPatronymic: experts.patronymic,
      partnerTitle: organisations.title,
    })
    .from(feedEntries)
    .leftJoin(experts, eq(experts.id, feedEntries.authorExpertId))
    .leftJoin(
      organisations,
      and(
        eq(organisations.id, feedEntries.partnerOrganisationId),
        organisationPubliclyDisplayed,
      ),
    )
    .where(
      before
        ? and(
            visible,
            beforeKeysetCursor(feedEntries.publishedAt, feedEntries.id, before),
          )
        : visible,
    )
    .orderBy(desc(feedEntries.publishedAt), desc(feedEntries.id))
    .limit(limit);
}

export type PublicFeedRow = Awaited<
  ReturnType<typeof publicFeedPageQuery>
>[number];

@Injectable()
export class FeedEntriesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  /** The public feed page of {@link publicFeedPageQuery} (#3513). */
  publicPage(
    limit: number,
    before: FeedCursorPosition | null,
  ): Promise<PublicFeedRow[]> {
    return publicFeedPageQuery(this.handle, limit, before);
  }

  /**
   * Insert the source record's card, or rewrite it in place. `published_at`
   * is never rewritten: the card date is the first publication instant
   * (EARS-5), whatever an edit changes.
   */
  async upsert(tx: MaterialsTx, entry: FeedEntryWrite): Promise<void> {
    const { sourcePlatform, sourceRef, publishedAt, ...card } = entry;
    await tx
      .insert(feedEntries)
      .values({ sourcePlatform, sourceRef, publishedAt, ...card })
      .onConflictDoUpdate({
        target: [feedEntries.sourcePlatform, feedEntries.sourceRef],
        set: { ...card, updatedAt: sql`now()` },
      });
  }

  /** Remove the source record's card (EARS-6: an unpublished material leaves the feed). */
  async remove(
    tx: MaterialsTx,
    sourcePlatform: "academy",
    sourceRef: string,
  ): Promise<void> {
    await tx
      .delete(feedEntries) // retained-data-ok: a feed entry exists only while its source record is published (048-design §Public predicate); the retained row is `materials`, and each removal is a feature-010 ledger row
      .where(
        and(
          eq(feedEntries.sourcePlatform, sourcePlatform),
          eq(feedEntries.sourceRef, sourceRef),
        ),
      );
  }
}
