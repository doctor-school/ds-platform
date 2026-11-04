import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { specialtyFeedPath } from "@ds/schemas";

import { SPECIALTY_CATALOG_ANCHOR } from "@/lib/navigation-model";
import { resolveRememberedSpecialty } from "@/lib/specialty-choice";

/**
 * «Моя лента» (018 entry, #3674) — the header item's static target. It paints
 * nothing: it resolves the visitor's remembered specialty (017 LD-2, the same
 * server read the home and the feed make) and redirects.
 *
 *  • a specialty is chosen → that specialty's feed, `/feed/<code>`;
 *  • nothing chosen, or the read could not resolve → the home specialty
 *    catalog, the one surface that lets the visitor choose (017 EARS-4). An
 *    unresolved read lands there too: the catalog re-issues the read from the
 *    browser and collapses to the remembered row if there is one.
 *
 * The header stays a static config value (`lib/navigation-model.ts`), so the
 * shell never needs to know about specialties.
 */
export const dynamic = "force-dynamic";

export default async function MyFeedPage(): Promise<never> {
  const { choice } = await resolveRememberedSpecialty(await headers());
  const code = choice?.specialty?.code;
  redirect(code ? specialtyFeedPath(code) : `/#${SPECIALTY_CATALOG_ANCHOR}`);
}
