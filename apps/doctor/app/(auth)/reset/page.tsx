import type { Metadata } from "next";

import { AUTH_FLOW_PAGE_TITLES } from "@ds/auth-flow/copy";
import { ResetRoute } from "@ds/auth-flow/reset/route";

import { DOCTOR_AUTH_FLOW } from "../../../lib/auth-flow.host-config";

/**
 * 003 EARS-11 / EARS-12 — `doctor.school/reset`, the doctor storefront's
 * password-recovery route: `/login` «Забыли пароль?» and the `/account`
 * «Сменить пароль» row (003 EARS-28) both send the doctor here, and the journey
 * starts, runs and finishes on this origin, where the `__Host-` session it mints
 * belongs.
 *
 * The route is a MOUNT (#2027 wave 1, PR 1.8), the way `/login` and
 * `/register` are: the recovery card, both stages, the challenge, the resend,
 * the reveal toggle, the carried return target and the #675 guard with its
 * reset-route exemption are the ONE recovery flow of
 * `@ds/auth-flow/reset`, the same body the Academy mounts. What stays here is
 * what this host STATES about itself: `DOCTOR_AUTH_FLOW` and its page metadata.
 *
 * The route is registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * alongside `/login` and `/register`: the journey is real and wired, but the
 * doctor storefront front door as a whole opens with the #1430 epic.
 */
export const metadata: Metadata = {
  title: AUTH_FLOW_PAGE_TITLES.reset,
  description:
    "Восстановление пароля для врача на Doctor.School: пришлём код на почту и поможем задать новый пароль.",
};

export default async function DoctorResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ResetRoute config={DOCTOR_AUTH_FLOW} searchParams={searchParams} />;
}
