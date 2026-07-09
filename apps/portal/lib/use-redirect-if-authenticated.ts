"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

/**
 * Auth-surface guard (#675). An ALREADY-authenticated visitor (valid
 * `__Host-ds_session` cookie) who lands on one of the portal's auth surfaces
 * (`/login`, `/register`, `/reset`, `/verify`) must NOT be able to re-walk the
 * register→verify→login flow — they are sent straight to their destination and no
 * auth form is ever rendered. This hook is the single chokepoint the shared
 * `<AuthShell>` calls, so all four surfaces inherit the behaviour from one place.
 *
 * On mount it reads the principal through the same-origin `GET /v1/auth/session`
 * (`authClient.session()` returns `null` on 401, never throws), then:
 *   • `"pending"`       — the check is in flight; the shell renders NOTHING (the AC
 *                         forbids flashing the auth form to an authed visitor, and
 *                         we cannot know which case applies until it resolves);
 *   • `"authenticated"` — a session exists → `router.replace("/account")` and the
 *                         shell keeps rendering nothing while the navigation lands;
 *   • `"anonymous"`     — no session → the shell renders the auth form as before.
 *
 * Deliberate simplifications (scoped to this hotfix):
 *   • NO silent-refresh dance here — a plain `session()` read is the guard; the
 *     `/account` page owns the EARS-9 refresh-then-retry. A momentarily-expired
 *     access token simply falls through to the form, and `/account` recovers it on
 *     the next hop; we never want an auth surface to run the refresh machinery.
 *   • NO `returnTo` diversion — an authed visitor is sent straight to `/account`
 *     per the AC, never to a carried `returnTo` (an explicit non-goal here; the
 *     unauthenticated flows still honour `returnTo` themselves).
 *
 * `replace` (not `push`) mirrors `/account`'s own redirect so the auth surface is
 * not left on the history stack.
 */
export type AuthGuardState = "pending" | "authenticated" | "anonymous";

export function useRedirectIfAuthenticated(): AuthGuardState {
  const router = useRouter();
  const [state, setState] = useState<AuthGuardState>("pending");

  useEffect(() => {
    let active = true;
    void authClient.session().then((claims) => {
      if (!active) return;
      if (claims) {
        setState("authenticated");
        router.replace("/account");
      } else {
        setState("anonymous");
      }
    });
    return () => {
      active = false;
    };
  }, [router]);

  return state;
}
