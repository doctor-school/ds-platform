import type { Metadata } from "next";

import { AccountPage } from "@ds/account/page";

import { ACADEMY_ACCOUNT } from "../../lib/auth-flow.host-config";

/**
 * 003 EARS-28 / 014 EARS-6 — the Academy cabinet, `academy.doctor.school/account`,
 * mounted from `@ds/account` with the Academy host config (wave-4 gate §4 PR 4.1).
 * The guest decision on the server, the client cabinet and its copy live in the
 * package.
 *
 * `metadata` and `dynamic` cannot live in the package, so they are declared
 * here: the tab title is the same on both storefronts (gate row 18), and the
 * answer is per-visitor — a static prerender would serve one doctor's verdict
 * to everyone.
 */
export const metadata: Metadata = {
  title: "Личный кабинет — Doctor.School",
};

export const dynamic = "force-dynamic";

export default function AccountRoute() {
  return <AccountPage config={ACADEMY_ACCOUNT} />;
}
