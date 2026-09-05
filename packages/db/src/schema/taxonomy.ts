import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { events } from "./events.js";
import { specialtiesMinzdrav } from "./specialties.js";
import { users } from "./users.js";

// 012 — Content taxonomy: the retained entity write model (012-design §2, §2.1;
// ADR-0003 §4 retained-row lifecycle). EARS-1 (#1283) lands the FIRST entity of
// the four — `projects`. `experts` / `directions` / `partners` are their own W1
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
 * The closed `project_experts.role` set (012-design §2.1). `curator` is the
 * single accountable owner a published project must have; `member` is every
 * other listed expert. The distinction is a DB enum rather than a boolean
 * because the partial unique index below is written against the VALUE — a
 * boolean would leave "which role is the accountable one" implicit in code.
 */
export const projectExpertRole = pgEnum("project_expert_role", [
  "curator",
  "member",
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
export const TAXONOMY_SLUG_MAX = 80;

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
    check(
      "projects_slug_pattern",
      sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
    check(
      "projects_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "projects_slug_bounds",
      sql`char_length(${t.slug}) BETWEEN 1 AND ${sql.raw(String(TAXONOMY_SLUG_MAX))}`,
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

export const EXPERT_PERSON_NAME_MAX = 80;
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
 * The person/descriptive columns are NULLABLE — not because a draft may be sloppy, but
 * because §2.4's editorial removal (`RemoveExpertContent`, #1306) NULLs them
 * while keeping the row, its id and its slug forever. `content_removed_at`
 * exists here from day one so that lifecycle is expressible in schema terms;
 * this slice ships NO removal route. `experts_content_removed_shape` pins the
 * exact removed shape, and `experts_structured_name_present_unless_removed`
 * keeps family/given names mandatory for every row that has not been removed.
 */
export const experts = pgTable(
  "experts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The permanent public identity. Editable only while `first_published_at IS NULL`. */
    slug: text("slug").notNull(),
    /** Structured person identity. Family/given are null only after editorial removal. */
    familyName: text("family_name"),
    givenName: text("given_name"),
    patronymic: text("patronymic"),
    /** Optional one-to-one convergence with the retained platform User. */
    userId: uuid("user_id"),
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
    uniqueIndex("experts_user_id_key").on(t.userId),
    foreignKey({
      columns: [t.userId],
      foreignColumns: [users.id],
      name: "experts_user_id_users_id_fk",
    }).onDelete("restrict"),
    check(
      "experts_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "experts_slug_pattern",
      sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
    check(
      "experts_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "experts_slug_bounds",
      sql`char_length(${t.slug}) BETWEEN 1 AND ${sql.raw(String(TAXONOMY_SLUG_MAX))}`,
    ),
    check(
      "experts_family_name_bounds",
      sql`${t.familyName} IS NULL OR char_length(${t.familyName}) BETWEEN 1 AND ${sql.raw(String(EXPERT_PERSON_NAME_MAX))}`,
    ),
    check(
      "experts_given_name_bounds",
      sql`${t.givenName} IS NULL OR char_length(${t.givenName}) BETWEEN 1 AND ${sql.raw(String(EXPERT_PERSON_NAME_MAX))}`,
    ),
    check(
      "experts_patronymic_bounds",
      sql`${t.patronymic} IS NULL OR char_length(${t.patronymic}) BETWEEN 1 AND ${sql.raw(String(EXPERT_PERSON_NAME_MAX))}`,
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
    // Family and given names are mandatory for every row that still describes a
    // person; only §2.4's removal is allowed to take them away.
    check(
      "experts_structured_name_present_unless_removed",
      sql`${t.contentRemovedAt} IS NOT NULL OR (${t.familyName} IS NOT NULL AND ${t.givenName} IS NOT NULL)`,
    ),
    // §2.4 exact removed shape: retired, deleted, and every descriptive value
    // NULL — never sentinel person text. Pinned in the DB so no future writer
    // can invent a half-removal.
    check(
      "experts_content_removed_shape",
      sql`${t.contentRemovedAt} IS NULL OR (
        ${t.status} = 'retired'
        AND ${t.deletedAt} IS NOT NULL
        AND ${t.familyName} IS NULL
        AND ${t.givenName} IS NULL
        AND ${t.patronymic} IS NULL
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

export const DIRECTION_TITLE_MAX = 120;

/**
 * `directions` — the curated editorial direction record (012 EARS-3, #1285).
 *
 * A direction is a first-class retained row, never a free-form event tag: an event
 * is classified by LINKING it to an existing direction (`event_directions`, #1293), so
 * there is no inline creation path and no per-event string that could drift into
 * a second spelling of the same subject. One row feeds the admin list, the admin
 * detail and (from #1294) the public `PublicDirection { id, slug, title }`
 * projection.
 *
 * The direction is the THINNEST taxonomy entity of the four (§2 ER): a stable id, a
 * permanent slug, a title and the shared lifecycle. It carries no description
 * and no media — the §5.2 public DTO exposes exactly `id`, `slug`, `title`, so a
 * descriptive column here would be an unreadable field, and its authoring
 * requests are therefore always `application/json` (§5.1). It also carries no
 * `content_removed_at`: §2.4's editorial removal is about a PERSON's regalia
 * (`experts`), and a subject heading has nothing to remove.
 *
 * `title` is NOT NULL: unlike a project description or an expert's regalia there
 * is no publish-required-but-draft-incomplete field to model — a direction with no
 * title would be an unlabelled row with nothing else to identify it.
 */
export const directions = pgTable(
  "directions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The permanent public identity. Editable only while `first_published_at IS NULL`. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
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
    // Spans EVERY retained row (012-design §2.1): a retired direction keeps holding
    // its slug, so a bookmarked direction URL can never later resolve to a different
    // subject. Deliberately NOT a partial index.
    uniqueIndex("directions_slug_key").on(t.slug),
    check(
      "directions_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "directions_slug_pattern",
      sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
    check(
      "directions_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "directions_slug_bounds",
      sql`char_length(${t.slug}) BETWEEN 1 AND ${sql.raw(String(TAXONOMY_SLUG_MAX))}`,
    ),
    check(
      "directions_title_bounds",
      sql`char_length(${t.title}) BETWEEN 1 AND ${sql.raw(String(DIRECTION_TITLE_MAX))}`,
    ),
    check("directions_version_positive", sql`${t.version} >= 1`),
    check(
      "directions_published_has_first_published_at",
      sql`${t.status} <> 'published' OR ${t.firstPublishedAt} IS NOT NULL`,
    ),
  ],
);

export type Direction = typeof directions.$inferSelect;
export type NewDirection = typeof directions.$inferInsert;

export const PARTNER_TITLE_MAX = 160;
export const PARTNER_WEBSITE_URL_MAX = 2048;

/**
 * The absolute-HTTPS shape a partner website must have (012-design §2.2 — "an
 * optional absolute HTTPS website up to 2048"). Enforced in the DATABASE, not
 * only in Zod: `website_url` becomes an outbound link on the public partner
 * projection (§5.2 `PublicPartner`), so a relative path, a `javascript:` token
 * or a plaintext `http://` origin must be unrepresentable in the column — a row
 * written by a migration, a fixture or a future service must satisfy the same
 * rule the wire contract states.
 */
export const HTTPS_URL_PATTERN = "^https://[^\\s/?#]+[^\\s]*$";

/**
 * `partners` — the descriptive sponsor record (012 EARS-4, #1286).
 *
 * A partner is a first-class retained editorial row, never a per-event sponsor
 * string: `events.partner_ref` is the pre-012 free-text field this entity
 * replaces, and one `partners` row feeds the admin list, the admin detail, the
 * public projection (#1294) and the `project_partners` join (#1291) — including
 * its at-most-one-active-primary rule. There is no inline creation path.
 *
 * Shape-wise it is the `projects` lifecycle plus ONE media slot and ONE URL:
 * `title` is NOT NULL (like a direction's — a partner with no title would be an
 * unlabelled row with nothing else to identify it), while `logo_ref` and
 * `website_url` are nullable because §5.2 declares both optional and nullable on
 * `PublicPartner`. Neither is therefore publish-required: a published partner
 * with no logo and no site is a complete projection, so no
 * `PUBLISH_REQUIREMENTS_NOT_MET` branch exists for this entity.
 *
 * It carries NO `content_removed_at`: §2.4's editorial removal is about a
 * PERSON's regalia (`experts`); a sponsoring organization has no personal data
 * to remove, and retire/restore already expresses "off the site".
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The permanent public identity. Editable only while `first_published_at IS NULL`. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Server-generated object-storage key of the normalized WebP logo; never a client value. */
    logoRef: text("logo_ref"),
    /** Optional absolute HTTPS site — the only outbound link a partner carries. */
    websiteUrl: text("website_url"),
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
    // Spans EVERY retained row (012-design §2.1): a retired partner keeps
    // holding its slug, so a bookmarked partner URL can never later resolve to a
    // different organization. Deliberately NOT a partial index.
    uniqueIndex("partners_slug_key").on(t.slug),
    check(
      "partners_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "partners_slug_pattern",
      sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`,
    ),
    check(
      "partners_slug_not_uuid",
      sql`${t.slug} !~ ${sql.raw(`'${UUID_TEXT_PATTERN}'`)}`,
    ),
    check(
      "partners_slug_bounds",
      sql`char_length(${t.slug}) BETWEEN 1 AND ${sql.raw(String(TAXONOMY_SLUG_MAX))}`,
    ),
    check(
      "partners_title_bounds",
      sql`char_length(${t.title}) BETWEEN 1 AND ${sql.raw(String(PARTNER_TITLE_MAX))}`,
    ),
    check(
      "partners_website_url_bounds",
      sql`${t.websiteUrl} IS NULL OR char_length(${t.websiteUrl}) BETWEEN 1 AND ${sql.raw(String(PARTNER_WEBSITE_URL_MAX))}`,
    ),
    // Absolute HTTPS or nothing — see `HTTPS_URL_PATTERN`.
    check(
      "partners_website_url_https",
      sql`${t.websiteUrl} IS NULL OR ${t.websiteUrl} ~ ${sql.raw(`'${HTTPS_URL_PATTERN}'`)}`,
    ),
    check("partners_version_positive", sql`${t.version} >= 1`),
    check(
      "partners_published_has_first_published_at",
      sql`${t.status} <> 'published' OR ${t.firstPublishedAt} IS NOT NULL`,
    ),
  ],
);

export type Partner = typeof partners.$inferSelect;
export type NewPartner = typeof partners.$inferInsert;

/**
 * The shared two-state JOIN lifecycle (012-design §2.1, §3 `JoinLifecycle`).
 * A relationship is `active` or `retired`; retiring one affects only that
 * relationship, and a restore reuses the SAME row and id — a retired relation is
 * restored, never reinserted.
 */
export const relationshipStatus = pgEnum("relationship_status", [
  "active",
  "retired",
]);

export const EVENT_EXPERT_ROLE_MIN = 1;
export const EVENT_EXPERT_ROLE_MAX = 80;
/** `position` is a signed 2-byte range (012-design §2.2): integer step 1, 0–32767. */
export const EVENT_EXPERT_POSITION_MIN = 0;
export const EVENT_EXPERT_POSITION_MAX = 32767;

/**
 * `event_experts` — the explicit expert↔event link (012 EARS-7, #1289).
 *
 * Since the EARS-24 cutover this is the SOLE source of an event's speaker
 * projection: the free-text `event_speakers` list of feature 007 no longer
 * exists, so there is no legacy match to express and no suppression rule to
 * apply. A published, eligible expert linked here IS the speaker.
 *
 * `ON DELETE RESTRICT` on both endpoints plus the retained lifecycle envelope
 * means nothing here is ever physically deleted — there is no DELETE route
 * (§5.1).
 */
export const eventExperts = pgTable(
  "event_experts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id, { onDelete: "restrict" }),
    /**
     * The event-specific role of this expert — ordinary trimmed editorial text,
     * required on every link (EARS-7). `RemoveExpertContent` (#1306) clears it
     * to null when the person is taken off the site, which is why the column is
     * nullable at rest while the API contract requires it on write.
     */
    role: text("role"),
    /** Presentation order within the event's merged visible speaker projection. */
    position: integer("position").notNull(),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The logical endpoint pair spans EVERY retained row (§2.1): a retired link
    // is RESTORED, never re-created, so the same expert cannot accumulate two
    // rows on one event.
    uniqueIndex("event_experts_event_expert_key").on(t.eventId, t.expertId),
    // The visible-slot rule of §4, now enforced in full by the database:
    // partial on `active`, so a retired link never squats on a slot the live
    // projection needs. With `event_speakers` gone this index is the ONLY
    // source of a slot collision — the service surfaces it as 409
    // `SPEAKER_POSITION_OCCUPIED`.
    uniqueIndex("event_experts_event_position_active_uniq")
      .on(t.eventId, t.position)
      .where(sql`${t.status} = 'active'`),
    check(
      "event_experts_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "event_experts_role_bounds",
      sql`${t.role} IS NULL OR char_length(${t.role}) BETWEEN ${sql.raw(String(EVENT_EXPERT_ROLE_MIN))} AND ${sql.raw(String(EVENT_EXPERT_ROLE_MAX))}`,
    ),
    check(
      "event_experts_position_bounds",
      sql`${t.position} BETWEEN ${sql.raw(String(EVENT_EXPERT_POSITION_MIN))} AND ${sql.raw(String(EVENT_EXPERT_POSITION_MAX))}`,
    ),
    check("event_experts_version_positive", sql`${t.version} >= 1`),
  ],
);

export type EventExpert = typeof eventExperts.$inferSelect;
export type NewEventExpert = typeof eventExperts.$inferInsert;

/**
 * `event_projects` — the retained event↔project relationship (012 EARS-6,
 * #1288), and the first join table of the feature.
 *
 * Several projects may relate to one event and several events to one project;
 * the row is the relationship itself, never a copy of either endpoint's
 * editorial values. Creating, retiring or restoring it has NO lifecycle side
 * effect on the event or the project (012-design §3): public traversal simply
 * filters an ineligible endpoint out.
 *
 * The logical pair is unique across ACTIVE AND RETAINED rows
 * (`event_projects_pair_key` is deliberately NOT partial): a retired relation is
 * RESTORED — same row, same id, `version + 1` — never re-inserted as a second
 * row. That is what makes «этот проект уже был привязан к эфиру» answerable, and
 * what stops a duplicate audit lineage for one relationship.
 *
 * Both FKs are `RESTRICT`: nothing in 012 is physically deleted, so a cascade
 * would have no legitimate trigger and its presence in generated SQL is itself a
 * 012-design §2.1 violation (`retained-data` CI guard).
 */
export const eventProjects = pgTable(
  "event_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Spans active AND retained rows (012-design §2.1) — the restore-never-
    // reinsert rule expressed as a constraint rather than as service etiquette.
    uniqueIndex("event_projects_pair_key").on(t.eventId, t.projectId),
    check(
      "event_projects_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("event_projects_version_positive", sql`${t.version} >= 1`),
    // Both traversal directions of §5.2 are indexed reads, not scans: the pair
    // index already serves `event_id`-leading lookups, so only the reverse
    // direction needs its own.
    index("event_projects_project_id_idx").on(t.projectId),
  ],
);

export type EventProject = typeof eventProjects.$inferSelect;

/**
 * `event_directions` — the retained event↔direction relationship (012 EARS-11,
 * #1293; renamed from `event_topics` by #1645 per ADR-0016 §5).
 *
 * This is the ONLY way an event is classified by subject: the operator LINKS an
 * existing, non-retired `directions` row, so there is no inline direction
 * creation path and no per-event string that could drift into a second spelling
 * of the same subject. The pre-012 `events.specialties[]` text array is a
 * SEPARATE axis and is neither read nor written by this join
 * (012-requirements EARS-11, §axis invariant): the two coexist, byte-for-byte
 * untouched by each other.
 *
 * Several directions may classify one event and several events may carry one
 * direction; the row is the relationship itself, never a copy of either
 * endpoint's editorial values. Creating, retiring or restoring it has NO
 * lifecycle side effect on the event or the direction (012-design §3): public
 * traversal simply filters an ineligible endpoint out.
 *
 * The logical pair is unique across ACTIVE AND RETAINED rows
 * (`event_directions_pair_key` is deliberately NOT partial): a retired relation is
 * RESTORED — same row, same id, `version + 1` — never re-inserted as a second
 * row, so one relationship keeps one audit lineage.
 *
 * Both FKs are `RESTRICT`: nothing in 012 is physically deleted, so a cascade
 * would have no legitimate trigger and its presence in generated SQL is itself a
 * 012-design §2.1 violation (`retained-data` CI guard).
 */
export const eventDirections = pgTable(
  "event_directions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    directionId: uuid("direction_id")
      .notNull()
      // #1483 renamed the `topics` book to `directions` (ADR-0016 §5) and
      // #1645 renamed this join's own column `topic_id` → `direction_id` in the
      // same true-rename discipline: the row, its id and its audit lineage are
      // the 012 EARS-11 link untouched, only the NAME moved.
      .references(() => directions.id, { onDelete: "restrict" }),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Spans active AND retained rows (012-design §2.1) — the restore-never-
    // reinsert rule expressed as a constraint rather than as service etiquette.
    uniqueIndex("event_directions_pair_key").on(t.eventId, t.directionId),
    check(
      "event_directions_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("event_directions_version_positive", sql`${t.version} >= 1`),
    // Both traversal directions of §5.2 are indexed reads, not scans: the pair
    // index already serves `event_id`-leading lookups, so only the reverse
    // direction needs its own.
    index("event_directions_direction_id_idx").on(t.directionId),
  ],
);

export type EventDirection = typeof eventDirections.$inferSelect;
export type NewEventDirection = typeof eventDirections.$inferInsert;
export type NewEventProject = typeof eventProjects.$inferInsert;

/**
 * `project_experts` — the retained project↔expert relationship (012 EARS-9,
 * #1291), and the table the published-project curator invariant is written on.
 *
 * The row carries ONE attribute, `role`, and that attribute is the whole reason
 * this join is not shaped like `event_projects`: 012-design §3.2 requires every
 * committed `published` project to have exactly ONE active curator whose expert
 * is itself published and non-retired. The upper bound of that invariant lives
 * here as `project_experts_project_curator_active_uniq`, a PARTIAL unique index
 * over `(project_id) WHERE status = 'active' AND role = 'curator'`. Postgres
 * evaluates it IMMEDIATELY, not at commit — which is exactly why
 * `ReplaceProjectCurator` (§3.2) must demote the outgoing curator to `member`
 * BEFORE promoting the candidate: the two rows would otherwise collide mid-
 * transaction even though the end state is legal.
 *
 * The LOWER bound (at least one, and an eligible one) is not expressible as an
 * index — it spans this table and `experts.status` — so the publish, curator
 * and expert-lifecycle services enforce it under the shared §3.2 lock order:
 * affected experts by stable id → affected projects by stable id →
 * `project_experts` rows.
 *
 * The logical pair is unique across ACTIVE AND RETAINED rows: a retired
 * relation is RESTORED — same row, same id, `version + 1` — never re-inserted,
 * so one relationship never accumulates two audit lineages. Both FKs are
 * `RESTRICT`; nothing in 012 is physically deleted and there is no DELETE route.
 *
 * `role` is NOT NULL. §2.4's `RemoveExpertContent` (#1306) clears
 * `event_experts.role` because that column holds authored editorial text about
 * the person; `project_experts.role` is a structural enum that says which side
 * of the curator invariant the row sits on, and a removal RETIRES the row rather
 * than blanking it.
 */
export const projectExperts = pgTable(
  "project_experts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => experts.id, { onDelete: "restrict" }),
    /** `curator` (at most one active per project) or `member`. */
    role: projectExpertRole("role").notNull(),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Spans active AND retained rows (012-design §2.1) — restore, never reinsert.
    uniqueIndex("project_experts_pair_key").on(t.projectId, t.expertId),
    // The §3.2 upper bound. Partial on the ACTIVE CURATOR pair: a retired
    // curator row and an active member row both leave the slot free.
    uniqueIndex("project_experts_project_curator_active_uniq")
      .on(t.projectId)
      .where(sql`${t.status} = 'active' AND ${t.role} = 'curator'`),
    check(
      "project_experts_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("project_experts_version_positive", sql`${t.version} >= 1`),
    // The reverse traversal of §5.2 (`/experts/:key/projects`) is an indexed
    // read, not a scan; the pair index already serves `project_id`-leading ones.
    index("project_experts_expert_id_idx").on(t.expertId),
  ],
);

export type ProjectExpert = typeof projectExperts.$inferSelect;
export type NewProjectExpert = typeof projectExperts.$inferInsert;

/**
 * `project_partners` — the retained project↔partner relationship (012 EARS-10,
 * #1292).
 *
 * Its one attribute is `is_primary`. A project may list many partners; at most
 * ONE of them is the primary, and that one is what `PublicProjectSummary
 * .primaryPartner` resolves to (012-design §5.2). The bound is the same shape
 * as the curator one and for the same reason — a partial unique index over
 * `(project_id) WHERE status = 'active' AND is_primary`, immediate rather than
 * deferrable, so a service that wants to MOVE the primary flag must clear the
 * incumbent before setting the successor inside one transaction.
 *
 * Unlike the curator, there is no LOWER bound: a published project with no
 * primary partner is perfectly legal and its `primaryPartner` is `null`. That is
 * why this table needs no counterpart to the §3.2 lock protocol — the invariant
 * is entirely within one project's rows, so the project row lock plus the index
 * is the whole argument.
 */
export const projectPartners = pgTable(
  "project_partners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    /** At most one ACTIVE true per project — the index below is the backstop. */
    isPrimary: boolean("is_primary").notNull().default(false),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("project_partners_pair_key").on(t.projectId, t.partnerId),
    uniqueIndex("project_partners_project_primary_active_uniq")
      .on(t.projectId)
      .where(sql`${t.status} = 'active' AND ${t.isPrimary}`),
    check(
      "project_partners_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("project_partners_version_positive", sql`${t.version} >= 1`),
    index("project_partners_partner_id_idx").on(t.partnerId),
  ],
);

export type ProjectPartner = typeof projectPartners.$inferSelect;
export type NewProjectPartner = typeof projectPartners.$inferInsert;

// ── ADR-0016 §2.8 / §5 — the direction reference relations ──────────────────
//
// `directions` is the feature-012 taxonomy row family renamed (ADR-0016 §5:
// "the only shipped-surface change is the `topics` → `directions` rename"), and
// the two tables below are the EXTENSION that makes it the platform's targeting
// substrate: which official specialties a direction serves, and which other
// directions are adjacent to it.
//
// Both are JOIN rows under the §2.1 two-state `relationshipStatus` lifecycle,
// not editorial entities: they carry no slug, no title and no publication
// state — a link is `active` or `retired`, a retired link is RESTORED (same row,
// same id) rather than re-inserted, and nothing is ever physically deleted
// (`onDelete: "restrict"` on every endpoint, ADR-0003).
//
// 017 EARS-8 reads exactly these two tables: chosen specialty →
// `direction_specialties` → own directions → `direction_adjacency` → adjacent
// directions. Nothing enters a `TargetingSet` without a managed row behind it,
// so neither table has an inference, similarity or fallback path.

/**
 * `direction_specialties` — the many-to-many link between a direction and an
 * entry of the closed Минздрав specialty book (ADR-0016 §2.8; 017-design §5).
 *
 * This link DRIVES CONTENT DISPLAY (ADR-0016 §2.8, REQ-1): it is the only
 * managed statement that a direction serves a given specialty. There is no
 * name-similarity, shared-prefix or computed-likeness path anywhere — 017 EARS-8
 * forbids one explicitly, and the absence of such a column is the guard.
 *
 * The specialty endpoint is `specialties_minzdrav`, whose rows survive a re-seed
 * by `code` (see `specialties.ts`), so a link authored today keeps pointing at
 * the same specialty after an amended nomenclature order.
 */
export const directionSpecialties = pgTable(
  "direction_specialties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    directionId: uuid("direction_id")
      .notNull()
      .references(() => directions.id, { onDelete: "restrict" }),
    specialtyMinzdravId: uuid("specialty_minzdrav_id")
      .notNull()
      .references(() => specialtiesMinzdrav.id, { onDelete: "restrict" }),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Spans active AND retained rows (012-design §2.1): the pair is the
    // relationship's identity, so a retired link is restored rather than
    // duplicated — «эта специальность уже привязана к направлению» stays
    // answerable and the audit lineage stays single.
    uniqueIndex("direction_specialties_pair_key").on(
      t.directionId,
      t.specialtyMinzdravId,
    ),
    check(
      "direction_specialties_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("direction_specialties_version_positive", sql`${t.version} >= 1`),
    // The 017 EARS-8 read enters from the SPECIALTY side (chosen specialty →
    // own directions); the pair index already serves the direction-leading
    // admin read, so only the reverse direction needs its own.
    index("direction_specialties_specialty_id_idx").on(t.specialtyMinzdravId),
  ],
);

export type DirectionSpecialty = typeof directionSpecialties.$inferSelect;
export type NewDirectionSpecialty = typeof directionSpecialties.$inferInsert;

/**
 * The adjacency `kind` vocabulary — CLOSED, and closed here (017-design §9.3).
 *
 * An operator picking «вид связи» is making a taxonomy decision, so the set of
 * decisions available has to be enumerable at the point of choice: a `Combobox`
 * can only offer options that exist, and a shape CHECK over free text offers
 * none. The enum is therefore the single place the vocabulary lives — the Zod
 * contract mirrors it, the generated SDK carries it, and the RU labels the
 * operator reads are presentation over these machine values, never stored.
 *
 * The three members are the distinctions the reference book actually draws:
 * `related` — a neighbouring direction, no hierarchy implied; `subdiscipline` —
 * the adjacent direction is a narrower part of this one; `interdisciplinary` —
 * the two meet across fields rather than within one.
 */
export const directionAdjacencyKind = pgEnum("direction_adjacency_kind", [
  "related",
  "subdiscipline",
  "interdisciplinary",
]);

/** The relative-strength scale of an adjacency edge; 1 = weakest, 100 = strongest. */
export const DIRECTION_ADJACENCY_WEIGHT_MIN = 1;
export const DIRECTION_ADJACENCY_WEIGHT_MAX = 100;
/**
 * The declared weight every authored edge gets (017-design §9.3): weight is a
 * tuning parameter of targeting resolution, not an editorial decision, so it is
 * absent from the operator interface and the column supplies it. Mid-scale by
 * construction — an unweighted edge is neither promoted nor demoted against its
 * siblings, so the adjacent set falls back to its own ordering rather than to an
 * accident of the default.
 */
export const DIRECTION_ADJACENCY_WEIGHT_DEFAULT = 50;

/**
 * `direction_adjacency` — the direction ↔ direction self-relation carrying
 * `kind` and `weight` (ADR-0016 §2.8; 017-design §5 `DIRECTION_ADJACENCY`).
 *
 * The edge is DIRECTED: one row states that, reading FROM `direction_id`,
 * `adjacent_direction_id` is adjacent with this kind and this weight. Adjacency
 * in practice is not symmetric — a narrow direction may sit adjacent to a broad
 * one without the broad one wanting the narrow one's content in its own targeted
 * selection — so a mutual relation is TWO authored rows, each with its own kind
 * and weight, rather than one row read in both directions. Making it implicitly
 * symmetric would publish an edge no operator ever authored, which 017 EARS-8's
 * "nothing enters TargetingSet without a managed row behind it" forbids.
 *
 * `weight` orders the adjacent set when a targeted block has more candidates
 * than slots; it is never a similarity score and is never computed.
 */
export const directionAdjacency = pgTable(
  "direction_adjacency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    directionId: uuid("direction_id")
      .notNull()
      .references(() => directions.id, { onDelete: "restrict" }),
    adjacentDirectionId: uuid("adjacent_direction_id")
      .notNull()
      .references(() => directions.id, { onDelete: "restrict" }),
    /** The authored edge label — one member of the closed vocabulary above. */
    kind: directionAdjacencyKind("kind").notNull(),
    /**
     * Relative strength of the edge within the source direction's adjacent set.
     * Server-supplied: the operator never authors it (017-design §9.3).
     */
    weight: integer("weight")
      .notNull()
      .default(DIRECTION_ADJACENCY_WEIGHT_DEFAULT),
    status: relationshipStatus("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the join ETag; starts at 1, `++` per successful write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One edge per ordered pair, across active AND retained rows: a retired
    // edge is restored, never re-inserted as a second row with a different
    // weight.
    uniqueIndex("direction_adjacency_pair_key").on(
      t.directionId,
      t.adjacentDirectionId,
    ),
    // A direction is not adjacent to itself: the 017 EARS-8 read labels
    // everything reached through this table as ADJACENT, so a self-edge would
    // render the doctor's own direction as someone else's.
    check(
      "direction_adjacency_no_self_edge",
      sql`${t.directionId} <> ${t.adjacentDirectionId}`,
    ),
    // No `kind` CHECK: the enum type IS the constraint now, so a shape check
    // beside it would be a second, weaker statement of the same rule.
    check(
      "direction_adjacency_weight_bounds",
      sql`${t.weight} BETWEEN ${sql.raw(String(DIRECTION_ADJACENCY_WEIGHT_MIN))} AND ${sql.raw(String(DIRECTION_ADJACENCY_WEIGHT_MAX))}`,
    ),
    check(
      "direction_adjacency_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("direction_adjacency_version_positive", sql`${t.version} >= 1`),
    // The reverse traversal ("which directions point at this one") is an
    // indexed read, not a scan; the pair index already serves the forward one.
    index("direction_adjacency_adjacent_id_idx").on(t.adjacentDirectionId),
  ],
);

export type DirectionAdjacency = typeof directionAdjacency.$inferSelect;
export type NewDirectionAdjacency = typeof directionAdjacency.$inferInsert;
