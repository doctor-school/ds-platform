import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// 012 — Content taxonomy: the retained entity write model (012-design §2, §2.1;
// ADR-0003 §4 retained-row lifecycle). EARS-1 (#1283) lands the FIRST entity of
// the four — `projects`. `experts` / `topics` / `partners` are their own W1
// verticals (#1284–#1286) and land in this same file as siblings; the two enums
// and the shared constraint vocabulary below are authored once here.
//
// Every taxonomy value column is ORDINARY editorial text (012-design §1): no
// digest column, no external key reference, no shadow copy. Media binaries live
// in object storage — the row carries only the server-generated key
// (`cover_ref`), never bytes and never a client-supplied URL.

/**
 * The shared three-state entity lifecycle of every taxonomy top-level row
 * (012-design §2.1, §3). `retired ⇔ deleted_at IS NOT NULL` is a DB CHECK, not
 * a convention: nothing in 012 is ever physically deleted, so "gone" is always
 * a retained row filtered out of default reads.
 */
export const taxonomyStatus = pgEnum("taxonomy_status", [
  "draft",
  "published",
  "retired",
]);

/** The closed project-kind set (012-design §2.1). */
export const projectKind = pgEnum("project_kind", [
  "school",
  "media",
  "program",
]);

/**
 * The authored slug grammar (012-design §2.1): lowercase ASCII words joined by
 * single hyphens. Shared by every taxonomy table's slug CHECK and mirrored by
 * `SlugSchema` in `@ds/schemas` — the DB owns the column constraint, the Zod
 * schema owns the wire contract, and the API's canonical slugifier produces
 * values inside both.
 */
export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

/**
 * Canonical UUID text, forbidden as a slug so `/:idOrSlug` stays unambiguous
 * (012-design §2.1): a request token that parses as a canonical UUID resolves
 * only by `id`, every other token only by `slug`. Without this CHECK an
 * operator could author the slug of another row's id.
 */
export const UUID_TEXT_PATTERN =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export const PROJECT_TITLE_MAX = 160;
export const PROJECT_DESCRIPTION_MAX = 2000;

/**
 * `projects` — a first-class retained editorial record (012 EARS-1). A project
 * is never an event string or a second copy: one row feeds the admin list, the
 * admin detail and (from #1294) the public projection.
 *
 * `description` is nullable because a `draft` may be incomplete; publication
 * (#1287) requires it, and a later PATCH that would null it on a `published`
 * row is refused with 409 `PUBLISH_REQUIREMENTS_NOT_MET`. `first_published_at`
 * is set once by the first publish transaction and pinned by the
 * `projects_first_published_at_set_once` trigger (migration) — clearing or
 * changing it is refused at the DB level, so the public URL identity a doctor
 * bookmarked can never silently move.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The permanent public identity. Editable only while `first_published_at IS NULL`. */
    slug: text("slug").notNull(),
    kind: projectKind("kind").notNull(),
    title: text("title").notNull(),
    /** Publish-required; null only on an incomplete draft. */
    description: text("description"),
    /** Server-generated object-storage key of the normalized WebP cover; never a client value. */
    coverRef: text("cover_ref"),
    /** Set once by the first publish transaction; trigger-pinned thereafter. */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    status: taxonomyStatus("status").notNull().default("draft"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the admin ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Per-table slug uniqueness spans EVERY retained row (012-design §2.1): a
    // retired project keeps holding its slug, so the URL cannot later resolve
    // to a different project. Deliberately NOT a partial index.
    uniqueIndex("projects_slug_key").on(t.slug),
    check(
      "projects_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("projects_slug_pattern", sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check(
      "projects_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "projects_title_bounds",
      sql`char_length(${t.title}) BETWEEN 1 AND ${sql.raw(String(PROJECT_TITLE_MAX))}`,
    ),
    check(
      "projects_description_bounds",
      sql`${t.description} IS NULL OR char_length(${t.description}) BETWEEN 1 AND ${sql.raw(String(PROJECT_DESCRIPTION_MAX))}`,
    ),
    check("projects_version_positive", sql`${t.version} >= 1`),
    // A published row always carries its publication instant; a draft never
    // does until its first publish (012-design §2.1).
    check(
      "projects_published_has_first_published_at",
      sql`${t.status} <> 'published' OR ${t.firstPublishedAt} IS NOT NULL`,
    ),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const EXPERT_NAME_MAX = 160;
export const EXPERT_PROFESSIONAL_ROLE_MAX = 160;
export const EXPERT_CREDENTIALS_MAX = 500;
export const EXPERT_AFFILIATION_MAX = 240;
export const EXPERT_BIO_MAX = 4000;

/**
 * `experts` — the standalone editorial expert record (012 EARS-2, #1284).
 *
 * An expert is NOT a platform user and NOT a second copy of an event speaker
 * string: one retained row feeds the admin list, the admin detail, the later
 * public projection (#1294) and the merged event-speaker projection (#1290).
 * There is no required `users` link and no parallel expert type.
 *
 * Every descriptive column is ordinary editorial text (012-design §1): the
 * name, professional role, credentials, affiliation and bio are the same public
 * regalia the person already publishes on conference sites. 012 adds no
 * encryption, no key management and no compliance workflow of its own.
 *
 * The descriptive columns are NULLABLE — not because a draft may be sloppy, but
 * because §2.4's editorial removal (`RemoveExpertContent`, #1306) NULLs them
 * while keeping the row, its id and its slug forever. `content_removed_at`
 * exists here from day one so that lifecycle is expressible in schema terms;
 * this slice ships NO removal route. `experts_content_removed_shape` pins the
 * exact removed shape, and `experts_name_present_unless_removed` keeps the
 * display label mandatory for every row that has not been removed.
 */
export const experts = pgTable(
  "experts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The permanent public identity. Editable only while `first_published_at IS NULL`. */
    slug: text("slug").notNull(),
    /** The display label. Null ONLY on an editorially removed row (§2.4). */
    name: text("name"),
    /** Server-generated object-storage key of the normalized WebP photo. */
    photoRef: text("photo_ref"),
    /** Publish-required; null on an incomplete draft or a removed row. */
    professionalRole: text("professional_role"),
    credentials: text("credentials"),
    affiliation: text("affiliation"),
    bio: text("bio"),
    /** Set once by the first publish transaction; trigger-pinned thereafter. */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    status: taxonomyStatus("status").notNull().default("draft"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** §2.4 editorial removal instant. Written only by #1306; NULL everywhere here. */
    contentRemovedAt: timestamp("content_removed_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the admin ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Spans EVERY retained row, removed ones included (012-design §2.1, §2.4):
    // a removed expert keeps holding its slug, so the URL a doctor bookmarked
    // can never later resolve to a different person.
    uniqueIndex("experts_slug_key").on(t.slug),
    check(
      "experts_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("experts_slug_pattern", sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`),
    check(
      "experts_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "experts_name_bounds",
      sql`${t.name} IS NULL OR char_length(${t.name}) BETWEEN 1 AND ${sql.raw(String(EXPERT_NAME_MAX))}`,
    ),
    check(
      "experts_professional_role_bounds",
      sql`${t.professionalRole} IS NULL OR char_length(${t.professionalRole}) BETWEEN 1 AND ${sql.raw(String(EXPERT_PROFESSIONAL_ROLE_MAX))}`,
    ),
    check(
      "experts_credentials_bounds",
      sql`${t.credentials} IS NULL OR char_length(${t.credentials}) BETWEEN 1 AND ${sql.raw(String(EXPERT_CREDENTIALS_MAX))}`,
    ),
    check(
      "experts_affiliation_bounds",
      sql`${t.affiliation} IS NULL OR char_length(${t.affiliation}) BETWEEN 1 AND ${sql.raw(String(EXPERT_AFFILIATION_MAX))}`,
    ),
    check(
      "experts_bio_bounds",
      sql`${t.bio} IS NULL OR char_length(${t.bio}) BETWEEN 1 AND ${sql.raw(String(EXPERT_BIO_MAX))}`,
    ),
    check("experts_version_positive", sql`${t.version} >= 1`),
    check(
      "experts_published_has_first_published_at",
      sql`${t.status} <> 'published' OR ${t.firstPublishedAt} IS NOT NULL`,
    ),
    // The display label is mandatory for every row that still describes a
    // person; only §2.4's removal is allowed to take it away.
    check(
      "experts_name_present_unless_removed",
      sql`${t.contentRemovedAt} IS NOT NULL OR ${t.name} IS NOT NULL`,
    ),
    // §2.4 exact removed shape: retired, deleted, and every descriptive value
    // NULL — never sentinel person text. Pinned in the DB so no future writer
    // can invent a half-removal.
    check(
      "experts_content_removed_shape",
      sql`${t.contentRemovedAt} IS NULL OR (
        ${t.status} = 'retired'
        AND ${t.deletedAt} IS NOT NULL
        AND ${t.name} IS NULL
        AND ${t.photoRef} IS NULL
        AND ${t.professionalRole} IS NULL
        AND ${t.credentials} IS NULL
        AND ${t.affiliation} IS NULL
        AND ${t.bio} IS NULL
      )`,
    ),
  ],
);

export type Expert = typeof experts.$inferSelect;
export type NewExpert = typeof experts.$inferInsert;
