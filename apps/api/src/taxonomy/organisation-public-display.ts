import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { organisations } from "@ds/db";

// 032 EARS-5 (#3494) — the ONE public display predicate of an organisation.
//
// 032-design §«Display rules on public reads»: every public read that projects
// an organisation — project→partners, partner→projects (its keyed source), the
// primary partner embedded in `PublicProjectSummary`, and 048's material
// partner mark (#3513) — goes through these two exports, so no projection can
// silently forget a rule.
//
//   - `organisationPubliclyDisplayed` — the row condition: published,
//     non-retired, and the name rule on. A name-hidden organisation is OMITTED,
//     never returned without a title: `PublicPartner.title` is required and the
//     logo alone would still identify it.
//   - `publicOrganisationColumns` — the projection: `logoRef` is resolved only
//     while the logo rule is on, so a logo-hidden organisation keeps its exact
//     wire shape and answers `logoUrl: null` (the no-logo fallback).
//
// The count (EARS-12) deliberately does NOT use the predicate: it counts every
// published organisation, display rules regardless.

/** Published, non-retired, name rule on — the only organisations a public read may project. */
export const organisationPubliclyDisplayed: SQL = and(
  eq(organisations.status, "published"),
  isNull(organisations.deletedAt),
  eq(organisations.publicNameVisible, true),
)!;

/** The public projection of an organisation: the logo key only while the logo rule is on. */
export const publicOrganisationColumns = {
  id: organisations.id,
  slug: organisations.slug,
  title: organisations.title,
  logoRef: sql<
    string | null
  >`CASE WHEN ${organisations.publicLogoVisible} THEN ${organisations.logoRef} END`.as(
    "public_logo_ref",
  ),
  websiteUrl: organisations.websiteUrl,
};

/** One organisation as `publicOrganisationColumns` reads it, before its logo URL is signed. */
export interface PublicOrganisationRow {
  id: string;
  slug: string;
  title: string;
  logoRef: string | null;
  websiteUrl: string | null;
}
