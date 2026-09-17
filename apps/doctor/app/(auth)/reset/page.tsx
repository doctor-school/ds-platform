import type { Metadata } from "next";
import { headers } from "next/headers";
import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { DOCTOR_AUTH_ROUTES } from "@/lib/auth-flow-routes";
import { AuthShell } from "@/components/auth-shell";
import { ResetScreen } from "@/components/reset-screen";
import {
  RETURN_CONTEXT_PARAM,
  resolveReturnLandingPath,
  withReturnContext,
} from "@/lib/return-context";

/**
 * #1989 — `doctor.school/reset`, the doctor storefront password-recovery route.
 *
 * The third door in the `(auth)` group, and deliberately the SAME SHAPE as its
 * `/login` and `/register` siblings rather than a new composition: same route
 * group, same chromeless `<AuthShell>` frame, the card inside it the shared
 * `@ds/design-system/blocks` `<PasswordRecoveryCard>` both storefronts recover
 * through (#1666), projected by `components/reset-screen.tsx`.
 *
 * WHAT IT CLOSES. `/login` and `/account` both offered password recovery and
 * both sent the doctor to the Academy — `academy.doctor.school/reset` — because
 * a doctor-relative `/reset` would have 404'd here. That was the #1933/#1958
 * interim, and this route ends it: the recovery journey now starts, runs and
 * finishes on this origin, where the `__Host-` session it mints belongs.
 *
 * NO SIGNED-IN REDIRECT, unlike `/login` — and since #2027 PR 1.4 that is
 * DECLARED rather than implied. The `/account` «Сменить пароль» entry is by
 * definition a SIGNED-IN doctor, so bouncing an authenticated visitor away from
 * this door would break the only way to change a password from the account page
 * (003 EARS-28). The route runs the SAME `guardAuthRoute` its two siblings run;
 * what lets the doctor through is `DOCTOR_AUTH_ROUTES.allowAuthenticated`, host
 * data both storefronts state for themselves. An exemption that is the absence of
 * a call cannot be read, tested or kept in step with the Academy's; this one can.
 *
 * IT CARRIES, like every other door (rules S3 + S4 of the auth-flow standard,
 * `packages/auth-flow/README.md`). Recovery is an INTERRUPTION of wherever the
 * doctor was going, not a journey of its own: `/login` and `/account` both send
 * visitors here, and this route used to drop whatever they were carrying — the
 * «Вспомнили пароль» link went to a bare `/login` and completion always landed
 * on the fixed `/account`. It now reads the same `returnTo` param its siblings
 * read, hands the screen the door built through `withReturnContext` and the
 * landing resolved through `resolveReturnLandingPath`, and falls back to
 * `/account` only when the arrival carried nothing (#221's default, unchanged).
 * Nothing this surface RENDERS depends on who is asking — the identifier is
 * typed, not resolved, and no эфир is read — so there is no return-CONTEXT card
 * here, only the return TARGET.
 *
 * The route is registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * alongside `/login` and `/register`: the journey is real and wired, but the
 * doctor storefront front door as a whole opens with the #1430 epic.
 */
export const metadata: Metadata = {
  title: "Восстановление пароля — Doctor.School",
  description:
    "Восстановление пароля для врача на Doctor.School: пришлём код на почту или в СМС и поможем задать новый пароль.",
};

export default async function DoctorResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — the same degradation rule the sibling doors apply.
  const returnTo = Array.isArray(raw) ? raw[0] : raw;

  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: DOCTOR_AUTH_ROUTES.reset,
    routes: DOCTOR_AUTH_ROUTES,
  });

  return (
    <AuthShell>
      <ResetScreen
        // Rule S3 — back out of recovery through the door they came in by, still
        // carrying it. A rejected or absent target simply drops off.
        loginHref={withReturnContext(DOCTOR_AUTH_ROUTES.login, returnTo)}
        // Rule S4 — the host projection of the carried target (#1945), or the
        // #221 default when the arrival carried none.
        landing={
          resolveReturnLandingPath(returnTo) ?? DOCTOR_AUTH_ROUTES.account
        }
      />
    </AuthShell>
  );
}
