import type { Metadata } from "next";
import { headers } from "next/headers";

import { AuthShell } from "@/components/auth-shell";
import { LoginScreen } from "@/components/login-screen";
import {
  ReturnContextPanel,
  ReturnContextPlate,
} from "@/components/return-context-card";
import { resolveDirectArrivalLanding } from "@/lib/registration-landing";
import {
  RETURN_CONTEXT_PARAM,
  resolveReturnContext,
  resolveReturnTargetPath,
} from "@/lib/return-context";
import { resolveRememberedSpecialty } from "@/lib/specialty-choice";

/**
 * #1933 — `doctor.school/login`, the doctor storefront sign-in route.
 *
 * The 017 shell guest cluster has pointed at `/login` since 017 shipped
 * (`components/storefront-header.tsx` → «Войти»), and no such route existed:
 * every signed-out visitor who pressed the header action landed on a 404. This
 * route closes that link, and it is deliberately the SAME SHAPE as its
 * `/register` sibling rather than a new composition — same route group, same
 * return-target read, same landing decision, same frame.
 *
 * CHROMELESS, LIKE THE DOOR NEXT TO IT. The route lives in the `(auth)` group
 * (`app/(auth)/layout.tsx`), so no header, navigation or footer renders on it:
 * that is the canvas composition (`design-source/auth.dc.html`, the `#d-register`
 * chromeless frame) and the product decision behind it — the door is a
 * single-CTA surface and the shell onward links would lead the doctor away from
 * the form. The frame itself is `<AuthShell>`; the card inside it is the shared
 * `@ds/design-system/blocks` `<LoginCard>` both storefronts sign in through
 * (#1666), projected by `components/login-screen.tsx`.
 *
 * THE RETURN CONTEXT (021 EARS-2). Sign-in is the OTHER half of the gate
 * arrival: a doctor who pressed «Участвовать» on a gated эфир and already has an
 * account arrives here carrying the canonical `?returnTo=/webinars/<slug>` — the
 * one vocabulary 005 EARS-2 defined, read through the shared `parseReturnTarget`
 * guard and never re-parsed locally. It is resolved SERVER-side before the first
 * paint, because the context is a fact about the arrival rather than something
 * that may pop in beside a form the doctor is already typing into: resolved, it
 * fills the split left half on the wide layout and stands as the plate above the
 * card below the mobile breakpoint. Unresolvable — no param, an unknown or draft
 * event, an api that is down — is `null`, and then NOTHING is passed: absent
 * from the tree, never an empty frame (EARS-3 honest-empty rule).
 *
 * WHERE A SUCCESSFUL SIGN-IN LANDS. A gate arrival goes back to the эфир it came
 * from — the GUARD reconstruction of the target, never the raw param (LD-3). A
 * direct arrival gets the LD-4 decision: `lib/registration-landing.ts` maps what
 * 017 remembers about this visitor onto the 019 events feed or the storefront
 * home, and never onto the account page. The route publishes the answer as a
 * server fact on the screen (`data-login-landing`), the same read model
 * `/register` uses for `data-registration-landing` — one vocabulary, decided
 * once, on the server.
 *
 * ONE `headers()` READ, AND ONLY ON A DIRECT ARRIVAL, exactly as `/register`
 * does it: the rendered screen is not per-visitor, but the LD-4 landing IS, so
 * the request headers are read on the branch that needs them and forwarded
 * through the one shared resolver (`lib/specialty-choice.ts`) rather than
 * inspected here.
 *
 * The route is registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * alongside `/register`: the sign-in journey is real and wired, but the doctor
 * storefront front door as a whole opens with the #1430 epic.
 */
export const metadata: Metadata = {
  title: "Вход — Doctor.School",
  description:
    "Вход для врача на Doctor.School: по паролю или по одноразовому коду на почту или в СМС.",
};

export default async function DoctorLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — a malformed return context degrades to no context,
  // it never breaks the door.
  const returnTo = Array.isArray(raw) ? raw[0] : raw;
  // The guard reconstruction of the arrival target — the ONE vocabulary,
  // resolved before the read so the same value serves the context, the landing
  // and the hand-off into `/register`, and the raw param serves none of them.
  const safeTarget = resolveReturnTargetPath(returnTo);
  const returnEvent = safeTarget
    ? await resolveReturnContext(safeTarget)
    : null;

  const landing =
    safeTarget && returnEvent
      ? safeTarget
      : resolveDirectArrivalLanding(
          await resolveRememberedSpecialty(await headers()),
        );

  // Sign-up is a co-equal auth path, so the arrival context survives the hop
  // into it — built from the GUARD output, so a hostile param can never be
  // propagated onward.
  const registerHref = safeTarget
    ? `/register?${RETURN_CONTEXT_PARAM}=${encodeURIComponent(safeTarget)}`
    : "/register";

  return (
    <AuthShell
      returnContext={
        returnEvent ? <ReturnContextPanel event={returnEvent} /> : undefined
      }
    >
      <LoginScreen
        registerHref={registerHref}
        landing={landing}
        returnContext={
          returnEvent ? <ReturnContextPlate event={returnEvent} /> : undefined
        }
      />
    </AuthShell>
  );
}
