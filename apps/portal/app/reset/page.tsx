import type { Metadata } from "next";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { ResetRoute } from "@ds/auth-flow/reset/route";

import { ACADEMY_AUTH_FLOW } from "../../lib/auth-flow.host-config";

/**
 * 003 EARS-11 / EARS-12 — `academy.doctor.school/reset`, the Academy's
 * password-recovery surface: `/login` «Забыли пароль?» and the cabinet
 * «Сменить пароль» (003 EARS-28) both hand
 * off here.
 *
 * The route is a MOUNT, not a composition (#2027 wave 1, PR 1.8), the way
 * `/login`, `/register` and `/verify` are. Both stages of the recovery card, the
 * challenge, the resend with its neutral acknowledgement, the reveal toggle,
 * «Начать заново», the carried return target and the #675 guard with its
 * reset-route exemption are the ONE recovery flow of
 * `@ds/auth-flow/reset` — the same body the doctor storefront mounts. What
 * stays here is what this host STATES about itself: `ACADEMY_AUTH_FLOW`. The
 * guard runs inside the mount, so `app/reset/layout.tsx` is gone.
 */
export const metadata: Metadata = {
  title: AUTH_FLOW_PAGE_TITLES.reset,
};

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ResetRoute config={ACADEMY_AUTH_FLOW} searchParams={searchParams} />;
}
