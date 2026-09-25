import type { Metadata } from "next";

import { RegisterRoute } from "@ds/auth-flow/register/route";

import { DOCTOR_AUTH_FLOW } from "../../../lib/auth-flow.host-config";

/**
 * 021 EARS-1 — `#d-register`, the doctor registration route
 * (`doctor.school/register`, `access: public`).
 *
 * The route is a MOUNT, not a composition (#2027 wave 1, PR 1.6): everything it
 * used to assemble by hand — the return-context resolution, the LD-4 / rule-S4
 * landing, the #675 signed-in guard, the consent read model and the inline
 * confirmation — is the ONE sign-up door of `@ds/auth-flow/register`, which both
 * storefronts now mount. What stays on this side is what this host STATES about
 * itself, and that is `DOCTOR_AUTH_FLOW` (`lib/auth-flow.host-config.ts`): its
 * routes (no `verify` — this host confirms inline), its consent tiers, its form
 * composition and its sentences.
 *
 * The route still belongs to the doctor app but NOT to the storefront shell: it
 * lives under the chromeless `(auth)` route group (`app/(auth)/layout.tsx`), so
 * no header, navigation or footer renders on it — the canvas composition
 * (`design-source/auth.dc.html` `#d-register`) and the product decision behind
 * it, the door being a single-CTA surface.
 */
export const metadata: Metadata = {
  title: "Регистрация — Doctor.School",
  description:
    "Регистрация врача на Doctor.School: рабочая почта, пароль и промокод, если он есть. Документы на входе не нужны.",
};

export default async function DoctorRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <RegisterRoute config={DOCTOR_AUTH_FLOW} searchParams={searchParams} />;
}
