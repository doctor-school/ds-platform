import { headers } from "next/headers";
import { SpecialtyCatalog } from "@/components/specialty-catalog";
import { StorefrontHero } from "@/components/storefront-hero";
import { resolveRememberedSpecialty } from "@/lib/specialty-choice";

/**
 * Doctor storefront root (`doctor.school/`, ADR-0015 §2) — a PAGE inside the 017
 * shell layout (`app/(storefront)/layout.tsx`), not a self-contained screen. The
 * header and footer are the layout's (EARS-1); a page-local copy is a defect.
 *
 * Two REAL blocks so far, in the canvas's own order: the hero (EARS-2 — kicker,
 * headline, free-for-the-doctor sub-line, the evolutionary goal verbatim, and
 * the four scale counters bound to one computed read, LD-3), then the specialty
 * catalog (EARS-4/EARS-5 — Stage-A variant Б: search field, frequent set,
 * «Показать весь список — N») or, once a specialty is remembered, its collapsed
 * targeted row (EARS-6/EARS-7).
 *
 * The catalog is a SIBLING in ordinary page flow, not a wrapper and not a gate.
 * That placement is the requirement, not a layout preference: EARS-4 forbids a
 * modal, interstitial, scroll lock or empty page keyed on the absence of a
 * choice, so the catalog cannot be something the rest of the page renders
 * inside of or waits for.
 *
 * The remembered choice is resolved HERE, on the server, from the request
 * headers — the same shape the shell resolves its action cluster with. EARS-6
 * says a subsequent visit OPENS in the targeted view, so the collapsed row has
 * to be in the first byte of HTML; a client effect that painted the catalog and
 * then folded it away would be the transitional state the shell is forbidden to
 * show, one section lower on the same page. `resolveRememberedSpecialty` never
 * throws: an unreachable api resolves «unknown», and the catalog then re-issues
 * the read from the browser rather than guessing.
 *
 * Reading `headers()` already opts this route group into dynamic rendering (the
 * layout does it for the header), so this read adds no caching trade-off — and a
 * statically cached page would in any case serve one visitor's specialty to all.
 *
 * The remaining home blocks (EARS-9/10/11) and the ADR-0015 §2 stage-3 migration
 * of the marketing routes out of `apps/promo` still land later, which is why the
 * route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking the full build — these blocks are real, the PAGE is
 * not yet whole.
 *
 * The page owns the exactly-one-non-empty-`h1` the axe gate asserts: it lives in
 * the hero, and the shell — which wraps many routes — carries none.
 */
export default async function DoctorHomePage() {
  const remembered = await resolveRememberedSpecialty(await headers());

  return (
    <>
      <StorefrontHero />
      <SpecialtyCatalog
        actor={remembered.actor}
        initialChoice={remembered.choice}
      />
    </>
  );
}
