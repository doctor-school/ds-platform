import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolveServerAuth } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_ROUTES } from "@/lib/auth-flow-routes";
import { withReturnTarget } from "@/lib/registration-handoff";

import { AccountProfile } from "./account-profile";

/**
 * 003 EARS-28 / 014 EARS-6 — the Academy cabinet, `academy.doctor.school/account`.
 *
 * THE GUEST DECISION IS TAKEN ON THE SERVER, before the first byte. That is rule
 * S1 of the auth-flow standard (`packages/auth-flow/README.md`): a visitor who
 * may not see a page never sees a frame of it. Until #2027 PR 1.4 this route was
 * a `"use client"` surface that painted «Загружаем ваш профиль…», fetched the
 * profile, and only then bounced a guest with `router.replace` — a cabinet-shaped
 * flash followed by a client round-trip, on the one storefront surface a doctor
 * reaches most often. The sibling `/account/events`, the doctor host's own
 * `/account` and the four auth doors all already decided on the server; this
 * route was the last client-side guard on the Academy.
 *
 * ONE session read, the shared one (`resolveServerAuth`, wave-1 gate rows 24–25),
 * and the guest bounce carries THIS route as its return target through the shared
 * `withReturnTarget` — the account family is a legal landing shape in
 * `@ds/auth-flow`, so `/account` survives the round-trip and signing in brings
 * the doctor back to the cabinet they asked for.
 *
 * Everything the browser genuinely owns stays in {@link AccountProfile}: the
 * EARS-27 self-read, the inline display-name write, the EARS-9 silent refresh and
 * logout. The server decision can be a moment stale — a session that expires
 * while the cabinet is open still bounces from there, carrying the same target.
 *
 * Rendered per request: the answer is per-visitor and a static prerender would
 * serve one doctor's verdict to everyone.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const auth = await resolveServerAuth(await headers());
  if (auth.status !== "doctor") {
    redirect(
      withReturnTarget(ACADEMY_AUTH_ROUTES.login, ACADEMY_AUTH_ROUTES.account),
    );
  }

  return <AccountProfile />;
}
