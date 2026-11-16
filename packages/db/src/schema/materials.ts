import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  experts,
  organisations,
  SLUG_PATTERN,
  TAXONOMY_SLUG_MAX,
  UUID_TEXT_PATTERN,
} from "./taxonomy.js";

// 048 (#3512) — the materials feed, slice 1 (048-design §Data model).
//
// Two tables with two owners:
//
//  - `materials` — the retained own-material row the «Материалы» admin section
//    authors (EARS-1, EARS-4…EARS-8, EARS-19). Never hard-deleted; an
//    unpublished material is a draft again (Lead decision 5).
//  - `feed_entries` — THE feed (Lead decision 8): one row per card the rail
//    shows, written only by the own-materials feed source inside the change's
//    transaction (EARS-4…EARS-6) and read by the public feed read joined only to
//    the directory rows it references (EARS-10). A network slice adds its own
//    `source_platform` value and card columns; nothing here changes.

export const MATERIAL_TITLE_MAX = 160;
export const MATERIAL_AUTHOR_LINE_MAX = 120;
export const FEED_ENTRY_TITLE_MAX = 160;
export const FEED_ENTRY_HREF_MAX = 2048;

/** EARS-1 — «Новость» / «Колонка эксперта». */
export const materialKind = pgEnum("material_kind", ["news", "column"]);

/** Lead decision 5 — two states only; unpublish returns to `draft`. */
export const materialStatus = pgEnum("material_status", ["draft", "published"]);

/**
 * The card kinds of the feed: the own-material kinds and the «network post»
 * of a connected network (048 slice 2, EARS-26).
 */
export const feedEntryKind = pgEnum("feed_entry_kind", [
  "news",
  "column",
  "post",
]);

/**
 * 048 EARS-26 — a network post's text is cut at a word boundary within this
 * many characters, plus «…»; the stored `title` of a `post` is at most one
 * longer. A post may carry no text (a captionless photo, an album whose
 * captioned part has not arrived), so its title may be empty.
 */
export const FEED_POST_TEXT_MAX = 500;

/** Where a feed entry comes from; each network slice adds one value. */
export const feedSourcePlatform = pgEnum("feed_source_platform", [
  "academy",
  "telegram",
]);

/** 048 EARS-31 — «Не проверен» / «Работает» / «Ошибка». */
export const feedSourceStatus = pgEnum("feed_source_status", [
  "unchecked",
  "ok",
  "failing",
]);

/** 048 EARS-29 — the copy of a network post's preview into our storage. */
export const feedEntryPreviewState = pgEnum("feed_entry_preview_state", [
  "pending",
  "done",
  "failed",
]);

/** 048 EARS-21 — the stored address: a lowercase public username. */
export const FEED_SOURCE_ADDRESS_PATTERN = "^[a-z][a-z0-9_]{4,31}$";

/**
 * 048 slice 2 (#3993) — one official account of a connected network the feed
 * takes posts from (048-design §Data model (slice 2); EARS-20…EARS-23). Never
 * deleted: a source is switched off, keeping what it brought in (US-3,
 * §Retention (slice 2)). Its `enabled = false` is mirrored onto every entry as
 * `feed_entries.source_off` in the same transaction, so the public read never
 * reads this table (Lead decision 11).
 */
export const feedSources = pgTable(
  "feed_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** A connected network — never `academy`, the own-materials source. */
    platform: feedSourcePlatform("platform").notNull(),
    /** The lowercase public username (EARS-21). */
    address: text("address").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Bound by the source check or the first matching update (EARS-31). */
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }),
    status: feedSourceStatus("status").notNull().default("unchecked"),
    /** One of the fixed EARS-31 reasons while `failing`. */
    statusReason: text("status_reason"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the admin ETag. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("feed_sources_platform_address_key").on(t.platform, t.address),
    uniqueIndex("feed_sources_telegram_chat_id_key").on(t.telegramChatId),
    check("feed_sources_network_platform", sql`${t.platform} <> 'academy'`),
    check(
      "feed_sources_address_pattern",
      sql`${t.address} ~ ${sql.raw(`'${FEED_SOURCE_ADDRESS_PATTERN}'`)}`,
    ),
    check(
      "feed_sources_reason_iff_failing",
      sql`(${t.status} = 'failing') = (${t.statusReason} IS NOT NULL)`,
    ),
    check(
      "feed_sources_checked_has_time",
      sql`${t.status} = 'unchecked' OR ${t.checkedAt} IS NOT NULL`,
    ),
    check("feed_sources_version_positive", sql`${t.version} >= 1`),
  ],
);

export type FeedSource = typeof feedSources.$inferSelect;
export type NewFeedSource = typeof feedSources.$inferInsert;

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** System-generated from the title; frozen once `first_published_at` is set. */
    slug: text("slug").notNull(),
    kind: materialKind("kind").notNull(),
    title: text("title").notNull(),
    /** News only, plain text 0–120; always empty for a column. */
    authorLine: text("author_line").notNull().default(""),
    /** Column only — the 012 expert who writes it. */
    expertId: uuid("expert_id").references(() => experts.id, {
      onDelete: "restrict",
    }),
    /** EARS-19 — the optional 032 partner organisation. */
    partnerOrganisationId: uuid("partner_organisation_id").references(
      () => organisations.id,
      { onDelete: "restrict" },
    ),
    /** Server-generated object-storage key of the normalized cover (012 media contract). */
    coverRef: text("cover_ref"),
    /** The allowlisted ProseMirror document of `material-body.ts` (EARS-2). */
    body: jsonb("body").notNull(),
    status: materialStatus("status").notNull().default("draft"),
    /** Set once by the first publish; trigger-pinned thereafter (EARS-6). */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the admin ETag. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("materials_slug_key").on(t.slug),
    index("materials_updated_at_idx").on(t.updatedAt.desc(), t.id.desc()),
    index("materials_expert_id_idx").on(t.expertId),
    index("materials_partner_organisation_id_idx").on(t.partnerOrganisationId),
    check(
      "materials_slug_pattern",
      sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
    check(
      "materials_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "materials_slug_bounds",
      sql`char_length(${t.slug}) BETWEEN 1 AND ${sql.raw(String(TAXONOMY_SLUG_MAX))}`,
    ),
    check(
      "materials_title_bounds",
      sql`char_length(${t.title}) BETWEEN 1 AND ${sql.raw(String(MATERIAL_TITLE_MAX))}`,
    ),
    check(
      "materials_author_line_bounds",
      sql`char_length(${t.authorLine}) <= ${sql.raw(String(MATERIAL_AUTHOR_LINE_MAX))}`,
    ),
    // EARS-1 — a column has an expert, a news item has none.
    check(
      "materials_column_iff_expert",
      sql`(${t.kind} = 'column') = (${t.expertId} IS NOT NULL)`,
    ),
    // EARS-1 — a column's author is its expert; its author line stays empty.
    check(
      "materials_author_line_news_only",
      sql`${t.kind} = 'news' OR ${t.authorLine} = ''`,
    ),
    check(
      "materials_published_has_first_published_at",
      sql`${t.status} <> 'published' OR ${t.firstPublishedAt} IS NOT NULL`,
    ),
    check("materials_version_positive", sql`${t.version} >= 1`),
  ],
);

export type Material = typeof materials.$inferSelect;
export type NewMaterial = typeof materials.$inferInsert;

export const feedEntries = pgTable(
  "feed_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourcePlatform: feedSourcePlatform("source_platform").notNull(),
    /** The source record key — the material id for an `academy` entry. */
    sourceRef: text("source_ref").notNull(),
    /** Set for `academy` entries; a network entry has no material. */
    materialId: uuid("material_id").references(() => materials.id, {
      onDelete: "restrict",
    }),
    kind: feedEntryKind("kind").notNull(),
    title: text("title").notNull(),
    /**
     * The card image as a durable 012 media key (an own material's
     * `cover_ref`), signed into a URL at the read — never a stored signed URL,
     * which expires (048-design §Data model).
     */
    imageRef: text("image_ref"),
    /** A network card's absolute image URL; always null on an `academy` card. */
    imageUrl: text("image_url"),
    /** «Академия» for a news item; null when the name comes from the author expert. */
    sourceName: text("source_name"),
    /** A column's expert — name and public state are judged at the read. */
    authorExpertId: uuid("author_expert_id").references(() => experts.id, {
      onDelete: "restrict",
    }),
    /** EARS-19 — copied from the material; name and rule judged at the read. */
    partnerOrganisationId: uuid("partner_organisation_id").references(
      () => organisations.id,
      { onDelete: "restrict" },
    ),
    href: text("href").notNull(),
    /** The card date — the source's first publication instant. */
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    /** Slice 2 — the source of a network entry; null for an `academy` entry. */
    feedSourceId: uuid("feed_source_id").references(() => feedSources.id, {
      onDelete: "restrict",
    }),
    /** Slice 2 — a Telegram album's group id; one entry per album (EARS-27). */
    mediaGroupId: text("media_group_id"),
    /** Slice 2 — a video post's length (EARS-26). */
    durationSeconds: integer("duration_seconds"),
    /** Slice 2 — the Telegram `file_id` of a preview awaiting its copy (EARS-29). */
    previewFileId: text("preview_file_id"),
    /** Slice 2 — detects a changed medium on edit (EARS-28). */
    previewFileUniqueId: text("preview_file_unique_id"),
    previewState: feedEntryPreviewState("preview_state"),
    previewAttempts: integer("preview_attempts").notNull().default(0),
    /** Slice 2 — mirror of the source's `enabled = false` (EARS-22). */
    sourceOff: boolean("source_off").notNull().default(false),
    /** Slice 2 — set while an administrator hides the entry (EARS-32). */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("feed_entries_source_key").on(t.sourcePlatform, t.sourceRef),
    index("feed_entries_published_at_id_idx").on(
      t.publishedAt.desc(),
      t.id.desc(),
    ),
    index("feed_entries_author_expert_id_idx").on(t.authorExpertId),
    index("feed_entries_partner_organisation_id_idx").on(
      t.partnerOrganisationId,
    ),
    index("feed_entries_material_id_idx").on(t.materialId),
    index("feed_entries_feed_source_id_published_at_idx").on(
      t.feedSourceId,
      t.publishedAt.desc(),
    ),
    uniqueIndex("feed_entries_source_media_group_key").on(
      t.feedSourceId,
      t.mediaGroupId,
    ),
    // An own card's title is 1–160; a network post's text 0–500 plus «…».
    check(
      "feed_entries_title_bounds",
      sql`CASE WHEN ${t.kind}::text = 'post' THEN char_length(${t.title}) <= ${sql.raw(String(FEED_POST_TEXT_MAX + 1))} ELSE char_length(${t.title}) BETWEEN 1 AND ${sql.raw(String(FEED_ENTRY_TITLE_MAX))} END`,
    ),
    check(
      "feed_entries_href_bounds",
      sql`char_length(${t.href}) BETWEEN 1 AND ${sql.raw(String(FEED_ENTRY_HREF_MAX))}`,
    ),
    check(
      "feed_entries_academy_has_material",
      sql`${t.sourcePlatform} <> 'academy' OR ${t.materialId} IS NOT NULL`,
    ),
    check(
      "feed_entries_one_image",
      sql`${t.imageRef} IS NULL OR ${t.imageUrl} IS NULL`,
    ),
    check(
      "feed_entries_academy_image_is_ref",
      sql`${t.sourcePlatform} <> 'academy' OR ${t.imageUrl} IS NULL`,
    ),
    // Slice 2 — a network entry belongs to its source; an own one to none.
    check(
      "feed_entries_network_has_source",
      sql`(${t.sourcePlatform} = 'academy') = (${t.feedSourceId} IS NULL)`,
    ),
    // Slice 2 — a «network post» card comes only from a network platform.
    check(
      "feed_entries_post_is_network",
      sql`${t.kind}::text <> 'post' OR ${t.sourcePlatform} <> 'academy'`,
    ),
    check(
      "feed_entries_duration_non_negative",
      sql`${t.durationSeconds} IS NULL OR ${t.durationSeconds} >= 0`,
    ),
    check(
      "feed_entries_preview_attempts_non_negative",
      sql`${t.previewAttempts} >= 0`,
    ),
  ],
);

export type FeedEntry = typeof feedEntries.$inferSelect;
export type NewFeedEntry = typeof feedEntries.$inferInsert;

/**
 * 048 slice 2 (#3994) — the dedup key of network posts (048-design §Data
 * model (slice 2)): every Telegram message id that went into an entry — one
 * for a single post, each part of an album — keyed `(feed_source_id,
 * message_id)`. The webhook upserts through it, an edit finds its entry
 * through it, and the import skips any id it already holds, so no delivery,
 * edit or re-run makes a second entry (EARS-25, EARS-27, EARS-28, EARS-30).
 */
export const feedEntryMessages = pgTable(
  "feed_entry_messages",
  {
    feedSourceId: uuid("feed_source_id")
      .notNull()
      .references(() => feedSources.id, { onDelete: "restrict" }),
    messageId: bigint("message_id", { mode: "number" }).notNull(),
    feedEntryId: uuid("feed_entry_id")
      .notNull()
      .references(() => feedEntries.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.feedSourceId, t.messageId] }),
    index("feed_entry_messages_feed_entry_id_idx").on(t.feedEntryId),
    check("feed_entry_messages_message_id_positive", sql`${t.messageId} > 0`),
  ],
);

export type FeedEntryMessage = typeof feedEntryMessages.$inferSelect;
