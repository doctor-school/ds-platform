import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { RegistrationScreen } from "@/components/registration-screen";

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
 * The screen is rendered with EVERY envelope slot unsupplied. That is the correct
 * state of this slice, not an omission: the return context (#1538), the
 * attribution line (#1544), the points promise (#1545) and the two consent tiers
 * (#1541/#1542, with the medical-worker declaration at #1540) are separate EARS
 * handlers, and EARS-3's honest-empty rule says an
 * unsupplied slot is absent from the tree rather than rendered as an empty frame.
 * `RegistrationScreen` enforces that; passing nothing here is how the enforcement
 * is exercised.
 *
 * The route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking the full build: the form composition is real, but the
 * door does not open yet — the submit is inert pending the EARS-19 bot-protection
 * client half and the EARS-4/5 consent precondition (see the component header).
 *
 * No `headers()` read here: nothing on this screen is per-visitor.
 */
export const metadata: Metadata = {
  title: "Регистрация — Doctor.School",
  description:
    "Регистрация врача на Doctor.School: рабочая почта, пароль и промокод, если он есть. Документы на входе не нужны.",
};

export default function DoctorRegisterPage() {
  return (
    <AuthShell>
      <RegistrationScreen />
    </AuthShell>
  );
}
