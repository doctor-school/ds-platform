import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccountScreen } from "@/components/account-screen";
import { resolveShellAuth } from "@/lib/shell-auth";

/**
 * #1958 — `doctor.school/account`, the doctor storefront's «Личный кабинет».
 *
 * The 017 shell signed-in cluster has pointed at `/account` since 017 shipped
 * (`components/storefront-header.tsx` → «Личный кабинет») and no such route
 * existed: every signed-in doctor who pressed the header action landed on a 404.
 * This route closes that link.
 *
 * WHAT IT RENDERS is the owner's release-1 decision, recorded in `017-design.md`:
 * not the full doctor cabinet — that is feature 022 (#1791, R5) — but the Academy's
 * 003 «Профиль аккаунта v1» surface PROJECTED onto this host, through the one
 * shared `<AccountProfileCard>` block both storefronts mount (AGENTS.md §6
 * cross-front reuse; registry row «Account profile surface»).
 *
 * INSIDE the storefront shell, unlike the `(auth)` doors next to it: an account
 * page is a destination a signed-in doctor navigates away from, so the header,
 * navigation and footer of `app/(storefront)/layout.tsx` belong on it.
 *
 * THE GUEST BRANCH IS DECIDED ON THE SERVER, through the same `resolveShellAuth`
 * read the 017 header branches on (ADR-0015 §4) — one session mechanism, not a
 * second. A visitor with no valid session never sees a frame of the cabinet: they
 * are redirected to the door carrying the canonical `?returnTo=/account`, the 005
 * EARS-2 vocabulary `/login` already understands, so signing in lands them back
 * here. The client screen re-checks on its own read as well — the server decision
 * can be a moment stale, and the EARS-9 silent refresh lives there.
 *
 * The route is registered `deferred` in `tools/lint/prod-surface-manifest.yaml`
 * alongside `/login` and `/register`: the journey is real and wired, but the
 * doctor storefront front door as a whole opens with the #1430 epic.
 */
export const metadata: Metadata = {
  title: "Личный кабинет — Doctor.School",
  description:
    "Личный кабинет врача на Doctor.School: данные аккаунта, вход и сессия.",
};

export default async function DoctorAccountPage() {
  const auth = await resolveShellAuth(await headers());
  if (auth.status === "guest") {
    redirect("/login?returnTo=%2Faccount");
  }

  return <AccountScreen />;
}
