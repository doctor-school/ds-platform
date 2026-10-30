import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import { feedEntries } from "@ds/db";
import { DRIZZLE_DB } from "../database/database.tokens.js";
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
  imageUrl: string | null;
  sourceName: string | null;
  authorExpertId: string | null;
  partnerOrganisationId: string | null;
  href: string;
  publishedAt: Date;
}

@Injectable()
export class FeedEntriesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly handle: Db) {}

  /** The pool handle, for the public feed read (#3513). */
  db(): Db {
    return this.handle;
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
