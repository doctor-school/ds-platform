import { StorefrontHero } from "@/components/storefront-hero";

/**
 * Doctor storefront root (`doctor.school/`, ADR-0015 §2) — a PAGE inside the 017
 * shell layout (`app/(storefront)/layout.tsx`), not a self-contained screen. The
 * header and footer are the layout's (EARS-1); a page-local copy is a defect.
 *
 * 017 EARS-2 is the first REAL block of this page: the hero — kicker, headline,
 * free-for-the-doctor sub-line, the evolutionary goal verbatim — and the four
 * scale counters bound to one computed read (LD-3). The remaining home blocks
 * (EARS-4 specialty catalog, EARS-9/10/11) and the ADR-0015 §2 stage-3 migration
 * of the marketing routes out of `apps/promo` still land later, which is why the
 * route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking the full build — the hero is real, the PAGE is not
 * yet whole.
 *
 * The page owns the exactly-one-non-empty-`h1` the axe gate asserts: it lives in
 * the hero, and the shell — which wraps many routes — carries none.
 */
export default function DoctorHomePage() {
  return <StorefrontHero />;
}
