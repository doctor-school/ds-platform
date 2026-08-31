import { NextResponse, type NextRequest } from "next/server";
import { parseSameOriginReturnTarget } from "@ds/schemas";

import {
  RETURN_TARGET_COOKIE,
  RETURN_TARGET_MAX_AGE_SECONDS,
} from "@/lib/return-to-origin";

/**
 * 014 EARS-6 — park the carried return target when a visitor enters the auth flow
 * from a login-gated surface (014 design §6).
 *
 * The gated surface links into the auth entry with `?returnTo=<same-origin path>`,
 * and the query carries it onward through the flow. The one hop the query CANNOT
 * survive is the registration branch's trip through the inbox: the verification
 * mail lands the visitor on a cold `/verify#email=…` in a fresh navigation with no
 * query at all. So the moment the visitor reaches an auth entry with a target,
 * this middleware validates it through the `@ds/schemas` same-origin guard and
 * parks the CANONICAL result in the short-lived `ds_return_to` cookie; the client
 * consumption point (`lib/return-to-origin` → `completeReturnTarget`) reads it
 * back exactly once, re-validates it, and clears it.
 *
 * Doing this here rather than in each auth page is what makes the mechanism
 * PLATFORM-WIDE rather than per-surface: every gated surface that links into the
 * auth entry with a valid `returnTo` is carried, present and future, with no
 * page-level wiring of its own.
 *
 * Only a guard-clean target is ever written, so the cookie can never hold a
 * cross-origin, protocol-relative, backslash-escaped or app-escaping value; an
 * unsafe one is dropped here and the visitor lands on the surface default.
 */
export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const target = parseSameOriginReturnTarget(
    request.nextUrl.searchParams.get("returnTo"),
  );
  if (target) {
    response.cookies.set(RETURN_TARGET_COOKIE, target, {
      path: "/",
      maxAge: RETURN_TARGET_MAX_AGE_SECONDS,
      sameSite: "lax",
      // Readable by the client-side auth success handler that consumes and clears
      // it; it holds a page path and no credential (see `lib/return-to-origin`).
      httpOnly: false,
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

/**
 * The auth entries only. A narrow matcher keeps the blast radius at the three
 * routes that actually begin or continue an authentication round-trip — no other
 * route pays for this middleware.
 */
export const config = {
  matcher: ["/login", "/register", "/verify"],
};
