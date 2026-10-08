import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DrizzleHandle } from "@ds/db";
import {
  directions,
  eventDirections,
  eventExperts,
  eventProjects,
  events,
  experts,
  projects,
} from "@ds/db";
import type {
  AcademyEventFacets,
  PublicEventFacetOption,
  PublicEventFacetOptions,
} from "@ds/schemas";

type Db = DrizzleHandle["db"];

/**
 * 014 EARS-12 (wave-2 entry gate §4.2, PR 2.5) — the Academy facets Проект,
 * Эксперт, Тема as SQL over 012's join tables.
 *
 * Every hop carries 012's public allow-list (014-design §9): an ACTIVE,
 * undeleted link to a PUBLISHED, undeleted record (an expert also not
 * content-removed, and named — the speaker projection's eligibility). A
 * draft or retired record is therefore indistinguishable from a slug nothing
 * carries: both select no event. Values of one facet OR together; the facets
 * AND together.
 */

/** No facet applied — the reads that take facets default to this. */
export const NO_ACADEMY_FACETS: AcademyEventFacets = {
  project: [],
  expert: [],
  topic: [],
};

/** The facet half of a parsed listing query. */
export function academyFacetsOf(query: AcademyEventFacets): AcademyEventFacets {
  return { project: query.project, expert: query.expert, topic: query.topic };
}

type FacetKey = keyof AcademyEventFacets;
const FACET_KEYS: readonly FacetKey[] = ["project", "expert", "topic"];

interface FacetHop {
  /** The link table (`event_projects` / `event_experts` / `event_directions`). */
  link: typeof eventProjects | typeof eventExperts | typeof eventDirections;
  /** The taxonomy record table the link points at. */
  record: typeof projects | typeof experts | typeof directions;
  /** link ⋈ record. */
  on: SQL;
  eventId: AnyPgColumn;
  recordId: AnyPgColumn;
  slug: AnyPgColumn<{ data: string }>;
  title: SQL<string>;
  /** 012's public allow-list at both hops. */
  eligible: SQL[];
}

/** The `event → record` hop of one facet, with its eligibility. */
function facetHop(key: FacetKey): FacetHop {
  switch (key) {
    case "project":
      return {
        link: eventProjects,
        record: projects,
        on: eq(projects.id, eventProjects.projectId),
        eventId: eventProjects.eventId,
        recordId: projects.id,
        slug: projects.slug,
        title: sql<string>`${projects.title}`,
        eligible: [
          eq(eventProjects.status, "active"),
          isNull(eventProjects.deletedAt),
          eq(projects.status, "published"),
          isNull(projects.deletedAt),
        ],
      };
    case "expert":
      return {
        link: eventExperts,
        record: experts,
        on: eq(experts.id, eventExperts.expertId),
        eventId: eventExperts.eventId,
        recordId: experts.id,
        slug: experts.slug,
        title: sql<string>`concat_ws(' ', ${experts.familyName}, ${experts.givenName}, ${experts.patronymic})`,
        eligible: [
          eq(eventExperts.status, "active"),
          isNull(eventExperts.deletedAt),
          eq(experts.status, "published"),
          isNull(experts.deletedAt),
          isNull(experts.contentRemovedAt),
          isNotNull(experts.familyName),
          isNotNull(experts.givenName),
        ],
      };
    case "topic":
      return {
        link: eventDirections,
        record: directions,
        on: eq(directions.id, eventDirections.directionId),
        eventId: eventDirections.eventId,
        recordId: directions.id,
        slug: directions.slug,
        title: sql<string>`${directions.title}`,
        eligible: [
          eq(eventDirections.status, "active"),
          isNull(eventDirections.deletedAt),
          eq(directions.status, "published"),
          isNull(directions.deletedAt),
        ],
      };
  }
}

/** The one facet's predicate: the event carries one of `slugs` through an eligible hop. */
function facetClause(db: Db, key: FacetKey, slugs: string[]): SQL {
  const hop = facetHop(key);
  return inArray(
    events.id,
    db
      .select({ id: hop.eventId })
      .from(hop.link)
      .innerJoin(hop.record, hop.on)
      .where(and(...hop.eligible, inArray(hop.slug, slugs))),
  );
}

/**
 * The applied facets as `events` predicates, AND-composed by the caller's
 * `and(...)`; `except` leaves one facet out — a facet's own option counts
 * read under the OTHER facets' selections (014-design §9).
 */
export function academyFacetClauses(
  db: Db,
  facets: AcademyEventFacets,
  except?: FacetKey,
): SQL[] {
  return FACET_KEYS.filter(
    (key) => key !== except && facets[key].length > 0,
  ).map((key) => facetClause(db, key, facets[key]));
}

/**
 * The facet panel's options over the events `base` selects (the read's tense,
 * no facet): every eligible record linked to one of them, with `count` — those
 * events carrying it under the other facets' selections. A record no base
 * event carries is not an option; one whose count is zero under the other
 * facets stays listed at `0` (014 EARS-12). Ordered by title, then slug.
 */
export async function academyFacetOptions(
  db: Db,
  base: SQL[],
  facets: AcademyEventFacets,
): Promise<PublicEventFacetOptions> {
  const [project, expert, topic] = await Promise.all(
    FACET_KEYS.map(async (key): Promise<PublicEventFacetOption[]> => {
      const hop = facetHop(key);
      const others = academyFacetClauses(db, facets, key);
      const count =
        others.length === 0
          ? sql<number>`count(DISTINCT ${events.id})::int`
          : sql<number>`(count(DISTINCT ${events.id}) FILTER (WHERE ${and(...others)}))::int`;
      const rows = await db
        .select({ slug: hop.slug, title: hop.title, count })
        .from(hop.link)
        .innerJoin(hop.record, hop.on)
        .innerJoin(events, eq(events.id, hop.eventId))
        .where(and(...base, ...hop.eligible))
        .groupBy(hop.recordId)
        .orderBy(asc(hop.title), asc(hop.slug));
      return rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        count: Number(row.count),
      }));
    }),
  );
  return { project: project!, expert: expert!, topic: topic! };
}
