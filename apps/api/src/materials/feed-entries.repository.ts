import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, min, not, or, sql } from "drizzle-orm";
import type { DrizzleHandle } from "@ds/db";
import {
  experts,
  expertPubliclyVisible,
  feedEntries,
  feedEntryMessages,
  organisations,
} from "@ds/db";
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
// directly. Two sources write here: `academy` (own-materials.feed-source.ts)
// and `telegram` (telegram/telegram.feed-source.ts, with its dedup table
// `feed_entry_messages`).

type Db = DrizzleHandle["db"];

/**
 * The platforms whose entries the public feed read serves: those the card
 * contract has a member for (048-design §Delivery slices (slice 2)). A network
 * platform joins this list in the same change that ships its card member
 * (#3997), so a stored network entry is never served before it can render.
 */
export const FEED_CARD_PLATFORMS = [
  "academy",
] as const satisfies readonly (typeof feedEntries.sourcePlatform.enumValues)[number][];

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

/** The columns the Telegram writer reads back from an entry (#3994). */
const telegramEntryColumns = {
  id: feedEntries.id,
  title: feedEntries.title,
  publishedAt: feedEntries.publishedAt,
  previewFileUniqueId: feedEntries.previewFileUniqueId,
};
export type TelegramEntryRow = {
  id: string;
  title: string;
  publishedAt: Date;
  previewFileUniqueId: string | null;
};

/** The preview columns of a Telegram entry (EARS-29). */
const telegramPreviewColumns = {
  id: feedEntries.id,
  imageRef: feedEntries.imageRef,
  previewFileId: feedEntries.previewFileId,
  previewFileUniqueId: feedEntries.previewFileUniqueId,
  previewState: feedEntries.previewState,
  previewAttempts: feedEntries.previewAttempts,
};
export type TelegramPreviewRow = {
  id: string;
  imageRef: string | null;
  previewFileId: string | null;
  previewFileUniqueId: string | null;
  previewState: "pending" | "done" | "failed" | null;
  previewAttempts: number;
};

/**
 * EARS-29 — the preview retry backoff: the wait before attempt `n + 1` after
 * `n` failed attempts is `min(10 · 2^(n-1), 240)` minutes, so the scheduled
 * retries (every 10 minutes) span {@link PREVIEW_RETRY_WINDOW_MINUTES}.
 */
export const PREVIEW_RETRY_BASE_MINUTES = 10;
export const PREVIEW_RETRY_CAP_MINUTES = 240;
export const PREVIEW_RETRY_WINDOW_MINUTES = 24 * 60;

export function previewRetryDelayMinutes(failedAttempts: number): number {
  if (failedAttempts <= 0) return 0;
  return Math.min(
    PREVIEW_RETRY_BASE_MINUTES * 2 ** (failedAttempts - 1),
    PREVIEW_RETRY_CAP_MINUTES,
  );
}

/**
 * The attempt count after which a preview is `failed`: the smallest `N` whose
 * waits before attempts 2…N cover the 24-hour window (EARS-29 «at least 24
 * hours»).
 */
export const PREVIEW_MAX_ATTEMPTS = ((): number => {
  let waited = 0;
  let attempts = 1;
  while (waited < PREVIEW_RETRY_WINDOW_MINUTES) {
    waited += previewRetryDelayMinutes(attempts);
    attempts += 1;
  }
  return attempts;
})();

/** A Telegram `post` entry as the connector writes it (048-design §Data model (slice 2)). */
export interface TelegramEntryInsert {
  feedSourceId: string;
  /** `<feed_source_id>:<smallest message id>`. */
  sourceRef: string;
  title: string;
  sourceName: string;
  href: string;
  publishedAt: Date;
  mediaGroupId: string | null;
  durationSeconds: number | null;
  previewFileId: string | null;
  previewFileUniqueId: string | null;
  /** `pending` while a preview awaits its copy (EARS-29); null with none. */
  previewState: "pending" | null;
}

export type TelegramEntryPatch = Partial<
  Pick<
    TelegramEntryInsert,
    | "sourceRef"
    | "title"
    | "href"
    | "publishedAt"
    | "durationSeconds"
    | "previewFileId"
    | "previewFileUniqueId"
    | "previewState"
  >
> & { previewAttempts?: number };

/** The `(published_at, id)` position a feed cursor carries. */
export interface FeedCursorPosition {
  instant: string;
  id: string;
}

/** 012 public expert — the one predicate, owned by `@ds/db`. */
export { expertPubliclyVisible };

/**
 * 048 EARS-9, EARS-10, EARS-19 (#3513) — one page of the public feed, newest
 * first with ties by id, read from `feed_entries` joined ONLY to the directory
 * rows an entry references: its column's 012 expert (public state and current
 * name parts, judged now — a column is absent while its expert is not public)
 * and its 032 partner through the shared display predicate (the partner never
 * hides an entry, so it is a LEFT JOIN on the predicate). `materials` is never
 * read (V-6). Slice 2 (#3993, EARS-22, EARS-32): a hidden entry and an entry
 * of a switched-off source are excluded by their row-local marks, so the read
 * never reads `feed_sources`. A pure builder so the unit suite can inspect its
 * SQL.
 */
export function publicFeedPageQuery(
  db: Db,
  limit: number,
  before: FeedCursorPosition | null,
) {
  const visible = and(
    inArray(feedEntries.sourcePlatform, [...FEED_CARD_PLATFORMS]),
    isNull(feedEntries.hiddenAt),
    not(feedEntries.sourceOff),
    or(isNull(feedEntries.authorExpertId), expertPubliclyVisible),
  );
  return db
    .select({
      id: feedEntries.id,
      kind: feedEntries.kind,
      title: feedEntries.title,
      imageRef: feedEntries.imageRef,
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

  // ── 048 slice 2 — Telegram entries (#3994, EARS-25…EARS-28) ─────────────
  // Written only by `telegram/telegram.feed-source.ts`, inside the webhook
  // update's transaction. `feed_entry_messages` is the dedup key: every
  // message id that went into an entry is a row of it (048-design §Data model
  // (slice 2)).

  /** The entry a source's message id already went into (EARS-25, EARS-28). */
  async telegramEntryByMessage(
    tx: MaterialsTx,
    feedSourceId: string,
    messageId: number,
  ): Promise<TelegramEntryRow | undefined> {
    const [row] = await tx
      .select(telegramEntryColumns)
      .from(feedEntryMessages)
      .innerJoin(feedEntries, eq(feedEntries.id, feedEntryMessages.feedEntryId))
      .where(
        and(
          eq(feedEntryMessages.feedSourceId, feedSourceId),
          eq(feedEntryMessages.messageId, messageId),
        ),
      )
      .for("update", { of: feedEntries });
    return row;
  }

  /** The album entry of `(feed_source_id, media_group_id)` (EARS-27). */
  async telegramEntryByMediaGroup(
    tx: MaterialsTx,
    feedSourceId: string,
    mediaGroupId: string,
  ): Promise<TelegramEntryRow | undefined> {
    const [row] = await tx
      .select(telegramEntryColumns)
      .from(feedEntries)
      .where(
        and(
          eq(feedEntries.feedSourceId, feedSourceId),
          eq(feedEntries.mediaGroupId, mediaGroupId),
        ),
      )
      .for("update");
    return row;
  }

  /** The smallest message id of an entry — its permalink and preview part. */
  async smallestTelegramMessageId(
    tx: MaterialsTx,
    feedEntryId: string,
  ): Promise<number | null> {
    const [row] = await tx
      .select({ id: min(feedEntryMessages.messageId) })
      .from(feedEntryMessages)
      .where(eq(feedEntryMessages.feedEntryId, feedEntryId));
    return row?.id === undefined || row.id === null ? null : Number(row.id);
  }

  /** A new Telegram `post` entry; returns its id. */
  async insertTelegramEntry(
    tx: MaterialsTx,
    entry: TelegramEntryInsert,
  ): Promise<string> {
    const [row] = await tx
      .insert(feedEntries)
      .values({
        sourcePlatform: "telegram",
        kind: "post",
        materialId: null,
        imageRef: null,
        imageUrl: null,
        authorExpertId: null,
        partnerOrganisationId: null,
        ...entry,
      })
      .returning({ id: feedEntries.id });
    return row!.id;
  }

  /**
   * Rewrite card fields of a Telegram entry in place. `hidden_at` and
   * `source_off` are never in the patch (EARS-28); `published_at` moves only
   * to an earlier album part's date, never by an edit (EARS-27).
   */
  async updateTelegramEntry(
    tx: MaterialsTx,
    id: string,
    patch: TelegramEntryPatch,
  ): Promise<void> {
    await tx
      .update(feedEntries)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(
        and(eq(feedEntries.id, id), eq(feedEntries.sourcePlatform, "telegram")),
      );
  }

  /** Attach a message id to its entry (EARS-25, EARS-27). */
  async attachTelegramMessage(
    tx: MaterialsTx,
    feedSourceId: string,
    messageId: number,
    feedEntryId: string,
  ): Promise<void> {
    await tx
      .insert(feedEntryMessages)
      .values({ feedSourceId, messageId, feedEntryId });
  }

  // ── 048 slice 2 — Telegram preview copy (#3994, EARS-29) ───────────────
  // Written only by `telegram/telegram-preview.service.ts`, after the webhook
  // transaction has committed. Each settle is conditional on the medium the
  // copy started from, so an edit that changed the medium meanwhile is never
  // overwritten by a stale copy.

  /** The preview state of a Telegram entry, or undefined when there is none. */
  async telegramPreview(
    id: string,
    tx?: MaterialsTx,
  ): Promise<TelegramPreviewRow | undefined> {
    const [row] = await (tx ?? this.handle)
      .select(telegramPreviewColumns)
      .from(feedEntries)
      .where(
        and(eq(feedEntries.id, id), eq(feedEntries.sourcePlatform, "telegram")),
      );
    return row;
  }

  /**
   * The pending previews whose next attempt is due: attempt `n` (1-based,
   * counted in `preview_attempts`) waits {@link previewRetryDelayMinutes}
   * after the last write of the row, which is the last attempt's write.
   */
  async duePreviewIds(limit: number): Promise<string[]> {
    const rows = await this.handle
      .select({ id: feedEntries.id })
      .from(feedEntries)
      .where(
        and(
          eq(feedEntries.sourcePlatform, "telegram"),
          eq(feedEntries.previewState, "pending"),
          sql`${feedEntries.updatedAt} <= now() - make_interval(mins => CASE WHEN ${feedEntries.previewAttempts} = 0 THEN 0 ELSE least(${sql.raw(String(PREVIEW_RETRY_BASE_MINUTES))} * power(2, ${feedEntries.previewAttempts} - 1), ${sql.raw(String(PREVIEW_RETRY_CAP_MINUTES))})::int END)`,
        ),
      )
      .orderBy(feedEntries.updatedAt)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /**
   * Lock a pending preview still on the medium `fileUniqueId` — the guard of
   * every settle; undefined when an edit moved it on or it is settled.
   */
  async lockPendingPreview(
    tx: MaterialsTx,
    id: string,
    fileUniqueId: string,
  ): Promise<TelegramPreviewRow | undefined> {
    const [row] = await tx
      .select(telegramPreviewColumns)
      .from(feedEntries)
      .where(
        and(
          eq(feedEntries.id, id),
          eq(feedEntries.sourcePlatform, "telegram"),
          eq(feedEntries.previewState, "pending"),
          eq(feedEntries.previewFileUniqueId, fileUniqueId),
        ),
      )
      .for("update");
    return row;
  }

  /** Settle a locked preview: the copy is set, or the attempt is counted. */
  async settlePreview(
    tx: MaterialsTx,
    id: string,
    patch:
      | { imageRef: string; previewState: "done" }
      | { previewAttempts: number; previewState: "pending" | "failed" },
  ): Promise<void> {
    await tx
      .update(feedEntries)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(
        and(eq(feedEntries.id, id), eq(feedEntries.sourcePlatform, "telegram")),
      );
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
