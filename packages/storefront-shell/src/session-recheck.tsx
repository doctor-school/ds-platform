"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { declaredGuestBounce } from "@ds/schemas";

/**
 * The read the shell's auth state already rests on — the endpoint
 * `resolveServerAuth` (`@ds/auth-flow/server`) reads on the server. From the
 * browser it is relative: each storefront proxies `/v1/*` same-origin, so the
 * `__Host-` session cookie travels and no token reaches script. (The literal
 * lives here because the §4 package graph allows this package `@ds/schemas`
 * and `@ds/design-system` only.)
 */
export const SESSION_READ_PATH = "/v1/auth/session";

/**
 * 003 EARS-73 — a returned-to signed-in tab re-checks its session (design
 * amendment 2026-11-05). Mounted by the signed-in cluster only, so a guest
 * render never listens and never reads.
 *
 * One hidden → visible transition is ONE return: `visibilitychange` to
 * `visible` and a bfcache `pageshow` (`persisted`) of that return share one
 * read, armed by the `hidden` / `pagehide` before it; no read on the first
 * render (the server resolved it), none while hidden, no timer, and no second
 * read while one is in flight.
 *
 * `401` — the session no longer holds: a route that declared its guest bounce
 * (`guestBounceMarker`, `@ds/schemas`) takes it by a top-level document request
 * — a router refresh would commit its server `redirect()` as an empty page —
 * and any other route re-renders as guest in place with `router.refresh()`, an
 * RSC request the storefront gate never answers with a silent check (EARS-63).
 * Any other status or a transport failure changes nothing: the re-check never
 * guesses a sign-out.
 */
export function SessionRecheck() {
  const router = useRouter();

  useEffect(() => {
    let armed = false;
    let inFlight = false;

    const recheck = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(SESSION_READ_PATH, {
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (res.status !== 401) return;
        const bounce = declaredGuestBounce(document);
        if (bounce) window.location.assign(bounce);
        else router.refresh();
      } catch {
        // A transport failure is no answer: the next request resolves as today.
      } finally {
        inFlight = false;
      }
    };

    const onReturn = () => {
      if (!armed) return;
      armed = false;
      void recheck();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") armed = true;
      else if (document.visibilityState === "visible") onReturn();
    };
    const onPageHide = () => {
      armed = true;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onReturn();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}
