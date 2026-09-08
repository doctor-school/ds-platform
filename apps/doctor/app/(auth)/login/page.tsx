import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
  resolveReturnLandingPath,
  resolveReturnTargetPath,
} from "@/lib/return-context";
import { resolveShellAuth } from "@/lib/shell-auth";
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
 * A DOCTOR WHO IS ALREADY SIGNED IN NEVER SEES THIS DOOR (#1955). The route is
 * reachable from anywhere — a bookmark, a shared link, the 017 guest cluster
 * still painted in a stale tab — and rendering a password box to a visitor who
 * already holds a session invites them to re-authenticate for nothing, on a
 * CHROMELESS screen with no way back onto the storefront. So the session is
 * resolved before the render and a signed-in doctor is sent straight to the
 * landing this route had already computed: the эфир they came from on a gate
 * arrival, the LD-4 destination otherwise. The redirect target is the SAME
 * value the screen would have published — one landing vocabulary, decided once
 * — so the door and the guard can never disagree about where sign-in leads.
 *
 * The status comes from `lib/shell-auth.ts`, the app's ONE server-side session
 * read (ADR-0015 §4): no second auth path, and its fail-safe answer is `guest`,
 * so a flaky api shows the sign-in form rather than bouncing a doctor off it.
 * `/register` deliberately keeps no such guard — the Issue names `/login`, and
 * a sign-up door answers a different question for someone with an account.
 *
 * ONE `headers()` READ FOR THE WHOLE RENDER, exactly as `/register` does it:
 * the rendered screen is not per-visitor, but the LD-4 landing and the session
 * status BOTH are, so the request headers are read once and forwarded through
 * the shared resolvers (`lib/specialty-choice.ts`, `lib/shell-auth.ts`) rather
 * than inspected here or read twice.
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
  // resolved before the read so the same value serves the context and the
  // hand-off into `/register`, and the raw param serves neither.
  const safeTarget = resolveReturnTargetPath(returnTo);
  // WHERE this host takes them afterwards. Not the canonical target verbatim:
  // the academy serves the эфир at `/webinars/<slug>` and this storefront serves
  // it at `/events/<slug>` (020-design §1), so the landing is the doctor-host
  // projection of the SAME guard output (#1945).
  const landingTarget = resolveReturnLandingPath(returnTo);
  // ONE read of the request headers, serving both per-visitor facts below.
  const requestHeaders = await headers();

  // Already signed in ⇒ the door is not for this visitor: send them to the same
  // place a successful sign-in would have. Before the render, so no form is ever
  // painted for a doctor who does not need it (#1955) — and before the upstream
  // event read, because a direct arrival's landing is decided by the remembered
  // specialty alone, so that round-trip would answer a question nobody asks. A
  // gate arrival genuinely needs both facts and pays for both.
  const auth = await resolveShellAuth(requestHeaders);
  if (auth.status === "doctor" && !landingTarget) {
    redirect(
      resolveDirectArrivalLanding(
        await resolveRememberedSpecialty(requestHeaders),
      ),
    );
  }

  const returnEvent = safeTarget
    ? await resolveReturnContext(safeTarget)
    : null;

  const landing =
    landingTarget && returnEvent
      ? landingTarget
      : resolveDirectArrivalLanding(
          await resolveRememberedSpecialty(requestHeaders),
        );

  if (auth.status === "doctor") redirect(landing);

  // Sign-up is a co-equal auth path, so the arrival context survives the hop
  // into it — built from the GUARD output, so a hostile param can never be
  // propagated onward.
  const registerHref = safeTarget
    ? `/register?${RETURN_CONTEXT_PARAM}=${encodeURIComponent(safeTarget)}`
    : "/register";

  return (
    <AuthShell
      returnContext={
        returnEvent ? (
          <ReturnContextPanel event={returnEvent} variant="login" />
        ) : undefined
      }
    >
      <LoginScreen
        registerHref={registerHref}
        landing={landing}
        // 005 EARS-2 — the эфир intent to COMPLETE after sign-in, in this host's
        // vocabulary. Supplied only when the target actually resolved to a live
        // эфир: an unknown or draft slug is not something to register anyone for,
        // and `landing` has already fallen back to the LD-4 destination for it,
        // so the two facts never disagree about where sign-in leads.
        {...(landingTarget && returnEvent ? { returnTarget: landingTarget } : {})}
        returnContext={
          returnEvent ? <ReturnContextPlate event={returnEvent} /> : undefined
        }
      />
    </AuthShell>
  );
}
