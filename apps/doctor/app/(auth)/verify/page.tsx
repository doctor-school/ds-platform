import type { Metadata } from "next";

import { VerifyRoute } from "@ds/auth-flow/verify/route";

import { DOCTOR_AUTH_FLOW } from "../../../lib/auth-flow.host-config";

/**
 * 003 EARS-24 — `doctor.school/verify`, the doctor storefront's confirmation
 * route (`access: public`): the registration door hops here with `?email=` and
 * the arrival `returnTo`, exactly as it does on the Academy.
 *
 * The route is a MOUNT, not a composition: the one code step (six cells, the
 * resend, the «← Изменить почту» back link — 003 EARS-42), the submission of
 * the held registration values WITH the code to this host's `api.verifyPath`
 * whose accepted answer is the session (003 EARS-41), its 021 EARS-10 landing
 * and the #675 signed-in guard are the ONE
 * confirmation step of `@ds/auth-flow/verify`. What stays here is what this
 * host STATES about itself: `DOCTOR_AUTH_FLOW`.
 *
 * It lives under the chromeless `(auth)` route group with the other auth doors,
 * so no storefront header, navigation or footer renders on it — the canvas
 * «Подтверждение» composition (`design-source/auth.dc.html`).
 */
export const metadata: Metadata = {
  title: "Подтверждение почты — Doctor.School",
};

export default async function DoctorVerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <VerifyRoute config={DOCTOR_AUTH_FLOW} searchParams={searchParams} />;
}
