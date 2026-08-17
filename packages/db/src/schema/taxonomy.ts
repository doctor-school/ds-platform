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
