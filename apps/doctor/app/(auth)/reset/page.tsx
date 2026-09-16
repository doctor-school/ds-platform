import type { Metadata } from "next";
import { headers } from "next/headers";
import { guardAuthRoute, resolveServerAuth } from "@ds/auth-flow/server";

import { DOCTOR_AUTH_ROUTES } from "@/lib/auth-flow-routes";
import { AuthShell } from "@/components/auth-shell";
import { ResetScreen } from "@/components/reset-screen";

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
 * NO OTHER PER-VISITOR READ. Nothing this surface RENDERS depends on who is
 * asking: the identifier is typed, not resolved, and the post-completion landing
 * is the fixed `/account`. So there is no return-context plumbing — recovery is
 * not a gate arrival, and a doctor who was on their way to an эфир restarts that
 * journey signed in.
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

export default async function DoctorResetPage() {
  const auth = await resolveServerAuth(await headers());
  guardAuthRoute({
    authenticated: auth.status === "doctor",
    pathname: DOCTOR_AUTH_ROUTES.reset,
    routes: DOCTOR_AUTH_ROUTES,
  });

  return (
    <AuthShell>
      <ResetScreen />
    </AuthShell>
  );
}
