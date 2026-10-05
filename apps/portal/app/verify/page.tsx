import { VerifyRoute } from "@ds/auth-flow/verify/route";

import { ACADEMY_AUTH_FLOW } from "../../lib/auth-flow.host-config";

/**
 * 003 EARS-3 / EARS-24 — `academy.doctor.school/verify`, the Academy's
 * confirmation route: the registration door hops here with `?email=` and the
 * arrival `returnTo`.
 *
 * The route is a MOUNT, not a composition (#2027 wave 1, PR 1.7), the way
 * `/login` and `/register` are. The one code step (six cells, the resend, the
 * «← Изменить почту» back link — 003 EARS-42), the submission of the held
 * registration values WITH the code whose accepted answer is the session (003
 * EARS-41), its 005 EARS-2 completion and the #675 signed-in guard are the ONE
 * confirmation step of `@ds/auth-flow/verify` — the
 * same route the doctor storefront mounts. What stays here is what this host
 * STATES about itself: `ACADEMY_AUTH_FLOW` (its `/verify` route and its parked
 * return target). The guard runs inside the mount.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <VerifyRoute config={ACADEMY_AUTH_FLOW} searchParams={searchParams} />;
}
