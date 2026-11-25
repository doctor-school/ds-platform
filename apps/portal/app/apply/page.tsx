import type { Metadata } from "next";

import { ApplyRoute } from "@ds/applications/route";

import { ACADEMY_APPLY } from "../../lib/auth-flow.host-config";

/**
 * 033 EARS-1 / EARS-2 — «Подать заявку», `academy.doctor.school/apply`,
 * mounted from `@ds/applications` with the Academy host config. The guest gate,
 * the form, its states and the consent version tag live in the package; the
 * doctor storefront has no such route (its not-found page answers).
 *
 * `metadata` and `dynamic` cannot live in the package, so they are declared
 * here: the answer is per-visitor (gate or form under the visitor's account), so
 * a static prerender would serve one account's form to everyone.
 */
export const metadata: Metadata = {
  title: "Подать заявку — Академия Doctor.School",
};

export const dynamic = "force-dynamic";

export default function ApplyRoutePage() {
  return <ApplyRoute config={ACADEMY_APPLY} />;
}
