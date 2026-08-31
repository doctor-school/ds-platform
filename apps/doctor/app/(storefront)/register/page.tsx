import type { Metadata } from "next";

import { RegistrationScreen } from "@/components/registration-screen";

/**
 * 021 EARS-1 — `#d-register`, the doctor registration route (`doctor.school/register`,
 * `access: public`). A PAGE inside the 017 shell layout
 * (`app/(storefront)/layout.tsx`), which is why it lives under the `(storefront)`
 * route group: the header, navigation and footer are the layout's, and EARS-1
 * forbids 021 defining or duplicating any of them.
 *
 * The route is what the shell's guest action cluster has been pointing at since
 * 017 shipped (`components/storefront-header.tsx` → «Регистрация»), so this slice
 * closes a link that resolved to a 404.
 *
 * The screen is rendered with EVERY envelope slot unsupplied. That is the correct
 * state of this slice, not an omission: the return context (#1540), the
 * attribution line (#1541), the points promise (#1545) and the two consent tiers
 * (#1538/#1544) are separate EARS handlers, and EARS-3's honest-empty rule says an
 * unsupplied slot is absent from the tree rather than rendered as an empty frame.
 * `RegistrationScreen` enforces that; passing nothing here is how the enforcement
 * is exercised.
 *
 * The route stays registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * against the epic tracking the full build: the form composition is real, but the
 * door does not open yet — the submit is inert pending the EARS-19 bot-protection
 * client half and the EARS-4/5 consent precondition (see the component header).
 *
 * No `headers()` read here: nothing on this screen is per-visitor. The route group
 * is already dynamic because the layout resolves the action cluster per request.
 */
export const metadata: Metadata = {
  title: "Регистрация — Doctor.School",
  description:
    "Регистрация врача на Doctor.School: рабочая почта, пароль и промокод, если он есть. Документы на входе не нужны.",
};

export default function DoctorRegisterPage() {
  return <RegistrationScreen />;
}
