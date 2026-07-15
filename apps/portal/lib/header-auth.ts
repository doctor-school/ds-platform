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
 * this fetches once per hard load.
 */
export type HeaderAuth =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "doctor"; initials: string | null };

export function useHeaderAuth(): HeaderAuth {
  const [state, setState] = useState<HeaderAuth>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await getMyProfile();
        if (!active) return;
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
        if (active) setState({ status: "guest" });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
