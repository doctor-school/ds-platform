import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

/** The card kinds of the feed; slice 1 knows only the own-material kinds. */
export const feedEntryKind = pgEnum("feed_entry_kind", ["news", "column"]);

/** Where a feed entry comes from; each network slice adds one value. */
export const feedSourcePlatform = pgEnum("feed_source_platform", ["academy"]);

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
    check(
      "feed_entries_title_bounds",
      sql`char_length(${t.title}) BETWEEN 1 AND ${sql.raw(String(FEED_ENTRY_TITLE_MAX))}`,
    ),
    check(
      "feed_entries_href_bounds",
      sql`char_length(${t.href}) BETWEEN 1 AND ${sql.raw(String(FEED_ENTRY_HREF_MAX))}`,
    ),
    check(
      "feed_entries_academy_has_material",
      sql`${t.sourcePlatform} <> 'academy' OR ${t.materialId} IS NOT NULL`,
    ),
  ],
);

export type FeedEntry = typeof feedEntries.$inferSelect;
export type NewFeedEntry = typeof feedEntries.$inferInsert;
