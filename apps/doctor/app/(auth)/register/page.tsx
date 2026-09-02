import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { RegistrationScreen } from "@/components/registration-screen";
import {
  ReturnContextPanel,
  ReturnContextPlate,
} from "@/components/return-context-card";
import {
  RETURN_CONTEXT_PARAM,
  resolveReturnContext,
} from "@/lib/return-context";

/**
 * 021 EARS-1 — `#d-register`, the doctor registration route (`doctor.school/register`,
 * `access: public`).
 *
 * The route belongs to the doctor storefront app but NOT to the storefront shell:
 * it lives under the chromeless `(auth)` route group (`app/(auth)/layout.tsx`), so
 * no header, navigation or footer renders on it. That is the canvas composition
 * (`design-source/auth.dc.html` `#d-register`) and the product decision behind it —
 * the door is a single-CTA surface, and the shell's onward links would lead the
 * doctor away from the form. The frame the canvas does draw — wordmark, brand
 * panel, card centred on the vertical axis — is `<AuthShell>`, the doctor-local
 * mirror of the Academy's auth frame (#1666 lifts the two into one).
 *
 * The route is what the shell's guest action cluster has been pointing at since
 * 017 shipped (`components/storefront-header.tsx` → «Регистрация»), so this slice
 * closes a link that resolved to a 404. The link crosses out of the shell, which
 * is the intended one-way step into the door.
 *
 * 021 EARS-2 (#1538) — THE RETURN CONTEXT. A doctor who pressed «Участвовать» on
 * a gated эфир arrives here carrying the event in the URL (`?from=<slug|id>`),
 * and the route resolves it server-side against the public event read before the
 * first paint: the context is a fact about the arrival, so it must be part of the
 * document rather than something that pops in afterwards beside a form the doctor
 * is already typing into. Resolved, it fills the split's LEFT HALF through
 * `<AuthShell returnContext>` on the wide layout and stands as the background
 * plate above the form below the mobile breakpoint — the two canvas compositions
 * of variant Б, exactly one of which renders per viewport.
 *
 * Unresolvable — no param, an unknown or draft event, an api that is down — is
 * `null`, and then NOTHING is passed: the left half falls back to the brand
 * panel's value prop and the form column carries no plate. Absent from the tree,
 * never an empty frame (EARS-3, and the requirements invariant on this card).
 * EARS-3's own fuller direct-arrival copy is #1539 and is not built here.
 *
 * The remaining envelope slots are still unsupplied, which is the correct state
 * of this slice and not an omission: the attribution line (#1544), the points
 * promise (#1545) and the two consent tiers (#1541/#1542, with the medical-worker
 * declaration at #1540) are separate EARS handlers under the same honest-empty
 * rule. `RegistrationScreen` enforces it; passing nothing is how the enforcement
 * is exercised.
 *
 * The route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking the full build: the form composition is real, but the
 * door does not open yet — the submit is inert pending the EARS-19 bot-protection
 * client half and the EARS-4/5 consent precondition (see the component header).
 *
 * No `headers()` read here: nothing on this screen is per-visitor — the event
 * read is `access: public` and identical for every caller, so it carries no
 * session and no fingerprint surface.
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
  const params = await searchParams;
  const raw = params[RETURN_CONTEXT_PARAM];
  // A repeated param arrives as an array; the FIRST value wins rather than the
  // request being rejected — a malformed return context degrades to no context,
  // it never breaks the door.
  const from = Array.isArray(raw) ? raw[0] : raw;
  const returnEvent = await resolveReturnContext(from);

  return (
    <AuthShell
      returnContext={
        returnEvent ? <ReturnContextPanel event={returnEvent} /> : undefined
      }
    >
      <RegistrationScreen
        returnContext={
          returnEvent ? <ReturnContextPlate event={returnEvent} /> : undefined
        }
      />
    </AuthShell>
  );
}
