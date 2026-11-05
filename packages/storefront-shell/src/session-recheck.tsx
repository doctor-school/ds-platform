"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AUTH_SESSION_PATH, declaredGuestBounce } from "@ds/schemas";

/**
 * 003 EARS-73 — a returned-to signed-in tab re-checks its session (design
 * amendment 2026-11-05). Mounted by the signed-in clusters only — the
 * storefront header's `ShellAuthCluster` and the room's `HeaderUserCluster` —
 * so a guest render never listens and never reads.
 *
 * The read is `AUTH_SESSION_PATH` (`@ds/schemas`), the endpoint
 * `resolveServerAuth` (`@ds/auth-flow/server`) reads on the server; from the
 * browser it is relative, through each storefront's same-origin `/v1/*` proxy,
 * so the `__Host-` session cookie travels and no token reaches script. (The
 * shell may not import `@ds/auth-flow` — §4 package graph.)
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
        const res = await fetch(AUTH_SESSION_PATH, {
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (res.status !== 401) return;
        // Only a same-origin bounce is followed; anything else re-renders in place.
        const bounce = declaredGuestBounce(document, {
          origin: window.location.origin,
          originOf: (href) => new URL(href, window.location.origin).origin,
        });
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
