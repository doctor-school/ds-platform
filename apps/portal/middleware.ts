import { NextResponse, type NextRequest } from "next/server";

import { parkReturnTarget } from "@ds/auth-flow/server";

import { ACADEMY_AUTH_RETURN_TO } from "@/lib/auth-flow-routes";

/**
 * 014 EARS-6 — park the carried return target when a visitor enters the auth
 * flow from a login-gated surface (014 design §6).
 *
 * The RULE — validate through the `@ds/schemas` same-origin guard, write only a
 * guard-clean value, never `HttpOnly` because the client success handler
 * consumes it — lives once in `@ds/auth-flow/server` (#2027 PR 1.4, rows 29–31).
 * What is left here is what is genuinely this host's: that the Academy parks at
 * all, under which cookie name, and on which routes.
 *
 * Doing this in middleware rather than in each auth page is what makes the
 * mechanism PLATFORM-WIDE rather than per-surface: every gated surface that
 * links into the auth entry with a valid `returnTo` is carried, present and
 * future, with no page-level wiring of its own.
 */
export function middleware(request: NextRequest): NextResponse {
  // `undefined` = nothing to park; the pass-through response stays this host's
  // to mint, so any other header this middleware grows is never discarded.
  return (
    parkReturnTarget(request, ACADEMY_AUTH_RETURN_TO) ?? NextResponse.next()
  );
}

/**
 * The auth entries only. A narrow matcher keeps the blast radius at the three
 * routes that actually begin or continue an authentication round-trip — no other
 * route pays for this middleware.
 */
export const config = {
  matcher: ["/login", "/register", "/verify"],
};
