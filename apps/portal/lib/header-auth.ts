"use client";

import { useEffect, useState } from "react";
import { getMyProfile } from "@/lib/profile-client";
import { initialsFromDisplayName } from "@/lib/display-name";

/**
 * 008 EARS-4 / EARS-5 — the client-side auth-state input for the persistent
 * app-shell header's account affordance. This feature mints no session and owns
 * no new backend primitive (requirements Constraints): it reads the shipped
 * self-profile (`GET /v1/me/profile`, feature 003) once on mount and derives the
 * minimal `{ authenticated, initials }` the header branch needs.
 *
 * Source note (design §3 reconciliation): the design names `GET /v1/auth/session`
 * as the AuthState source, but that endpoint returns only `{ sub, roles, mfa }` —
 * it carries NO display name, so it cannot yield the EARS-5 avatar initials. The
 * self-profile read is the single shipped surface that returns BOTH the
 * authenticated signal (200 vs 401) AND the display name the initials derive from
 * (mirroring `my-display-name.ts`, whose own doc names deriving the header-avatar
 * initials as its purpose). No new endpoint is introduced either way.
 *
 * Resolution:
 *   • `loading` — the read is in flight; the header reserves the affordance box
 *     (no layout shift, no first-paint flash of the wrong branch).
 *   • `guest`   — `getMyProfile()` returned `null` (401 / no session) → «Войти».
 *   • `doctor`  — a profile came back → the initials avatar icon → `/account`.
 *     `initials` is `null` for a doctor with no saved display name (the header
 *     renders a neutral fallback glyph then; the affordance still navigates).
 *
 * A non-401 transient error degrades to `guest`: the header must never block or
 * throw the whole shell over a flaky profile read — the worst case is a guest
 * affordance the doctor can still use to reach the login/profile path. The header
 * lives in the root layout, which does not remount across client navigations, so
 * the read runs once on mount and again whenever {@link refreshHeaderAuth} is
 * signaled — the auth flows fire it right after a successful login so the avatar
 * appears immediately on the soft post-login landing, no hard reload (#1004).
 */
export type HeaderAuth =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "doctor"; initials: string | null };

/** Mounted {@link useHeaderAuth} subscribers awaiting a re-read signal. */
const listeners = new Set<() => void>();

/**
 * #1004 — signal every mounted {@link useHeaderAuth} to re-read the profile.
 * Called by the auth flows immediately after a successful login (login ×2 /
 * verify auto-login / reset auto-login), right before the soft navigation, so
 * the persistent header (already mounted on the auth surface) swaps «Войти» →
 * avatar without a hard reload. A no-op when no header is mounted.
 */
export function refreshHeaderAuth(): void {
  for (const listener of listeners) listener();
}

export function useHeaderAuth(): HeaderAuth {
  const [state, setState] = useState<HeaderAuth>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let latest = 0;

    const read = () => {
      // On a signaled re-read KEEP the current state (no reset to `loading` —
      // no affordance flash); swap when the read resolves. `latest` makes the
      // most recently STARTED read win — a slow stale response never
      // overwrites a fresher one, and `active` bars setState after unmount.
      const seq = ++latest;
      void (async () => {
        try {
          const profile = await getMyProfile();
          if (!active || seq !== latest) return;
          if (profile === null) {
            setState({ status: "guest" });
            return;
          }
          const initials = profile.displayName
            ? initialsFromDisplayName(profile.displayName)
            : null;
          setState({ status: "doctor", initials });
        } catch {
          // Non-401 transient/server error — never take the shell down over it;
          // degrade to the guest affordance (still a usable way in).
          if (active && seq === latest) setState({ status: "guest" });
        }
      })();
    };

    read();
    listeners.add(read);
    return () => {
      active = false;
      listeners.delete(read);
    };
  }, []);

  return state;
}
