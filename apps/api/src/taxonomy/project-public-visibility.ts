import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { projectResults, projects } from "@ds/db";

// 030 EARS-8 / EARS-17 (#3503) — the ONE public condition of a project.
//
// A public project is published, non-retired AND declares at least one result.
// The forward migration (0055) leaves every project without results, and «a
// published project without results SHALL stay off every public read»: so a
// read that lists a project (event→projects, expert→projects,
// partner→projects, the Academy project facet, the doctor-storefront source
// line) or is keyed by one (project→events / experts / partners) applies this
// predicate instead of its own `status = 'published'`. One condition, no copies:
// a read that kept the bare status test would leak a no-result project.
//
// Lifecycle-impact previews (`affectedRows`) are admin reads of what a
// transition changes, not public reads, and keep their own status test.

/** Published, non-retired, with ≥1 result — the only projects a public read may carry. */
export const projectPubliclyVisible: SQL = and(
  eq(projects.status, "published"),
  isNull(projects.deletedAt),
  sql`EXISTS (SELECT 1 FROM ${projectResults} WHERE ${projectResults.projectId} = ${projects.id})`,
)!;
