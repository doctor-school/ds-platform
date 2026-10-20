import type { Metadata } from "next";

import { AccountPage } from "@ds/account/page";

import { DOCTOR_ACCOUNT } from "../../../lib/auth-flow.host-config";

/**
 * 017 #1958 / 003 EARS-28 — `doctor.school/account`, the doctor storefront's
 * «Личный кабинет», mounted from `@ds/account` with the doctor host config
 * (#2073, wave-4 gate §4 PR 4.2) — the one cabinet the Academy mounts too. The
 * server guest decision, the client cabinet and its copy live in the package.
 *
 * INSIDE the storefront shell, unlike the `(auth)` doors next to it: an account
 * page is a destination a signed-in doctor navigates away from, so the header,
 * navigation and footer of `app/(storefront)/layout.tsx` belong on it.
 *
 * `metadata` and `dynamic` cannot live in the package, so they are declared
 * here: the tab title is the same on both storefronts (gate row 18), and the
 * answer is per-visitor — a static prerender would serve one doctor's verdict to
 * everyone.
 */
export const metadata: Metadata = {
  title: "Личный кабинет — Doctor.School",
  description:
    "Личный кабинет врача на Doctor.School: данные аккаунта, вход и сессия.",
};

export const dynamic = "force-dynamic";

export default function DoctorAccountRoute() {
  return <AccountPage config={DOCTOR_ACCOUNT} />;
}
