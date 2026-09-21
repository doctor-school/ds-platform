import type { Metadata } from "next";

import { RegisterRoute } from "@ds/auth-flow/register/route";

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow.host-config";

/**
 * 003 EARS-1 / #131 — `academy.doctor.school/register`, the Academy sign-up door.
 *
 * The route is a MOUNT, not a composition (#2027 wave 1, PR 1.6), the way
 * `/login` has been since PR 1.5. Everything this page used to assemble by hand
 * — the return-context resolution, the arrival landing, the #675 signed-in
 * guard, the consent read model, the transport and the `/verify` hop — is the
 * ONE sign-up door of `@ds/auth-flow/register`, which both storefronts mount.
 * What stays on this side is what this host STATES about itself, and that is
 * `ACADEMY_AUTH_FLOW` (`lib/auth-flow.host-config.ts`): its routes (including
 * `verify`, the standalone confirmation surface the verification mail links
 * into — the doctor storefront confirms inline instead), its one required
 * consent read as a single read-only sentence, and its sentences.
 *
 * The rendered result is the shipped Academy render: the door states no
 * `register.form` and no `brand.registerIcon`, so the card keeps the block's own
 * defaults, which ARE this host's composition.
 *
 * The #675 guard now runs INSIDE the mount, before the first byte of HTML, so
 * `app/register/layout.tsx` is gone — the same retirement `/login` had in PR 1.5.
 */
export const metadata: Metadata = {
  title: "Регистрация — Doctor.School",
  description:
    "Регистрация врача в Академии Doctor.School: нужны только рабочая почта и пароль.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <RegisterRoute config={ACADEMY_AUTH_FLOW} searchParams={searchParams} />
  );
}
