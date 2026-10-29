import { NextResponse, type NextRequest } from "next/server";

import { parkReturnTarget, storefrontSilentCheck } from "@ds/auth-flow/server";

import { ACADEMY_STOREFRONT_OIDC } from "./lib/auth-flow.host-config";

/**
 * 003 EARS-63 (ADR-0015 §4 step 4) — the silent check on this storefront, and
 * 014 EARS-6 — park the carried return target when a visitor enters the auth
 * flow from a login-gated surface (014 design §6).
 *
 * Both RULES live once in `@ds/auth-flow/server`, the same on both
 * storefronts (ADR-0013 A1): the silent check (a signed-out document
 * navigation is answered, before anything renders and before the page cache
 * answers, with a `303` into a `prompt=none` transaction; the marker, guard,
 * exemption, crawler and caching rules are the core's), and the parking rule
 * (#2027 PR 1.4, rows 29–31; #2443). What is left here is the Next wiring:
 * which routes of this app run them.
 */
export async function middleware(request: NextRequest): Promise<Response> {
  const check = await storefrontSilentCheck(request, ACADEMY_STOREFRONT_OIDC);
  if ("response" in check) return check.response;
  // `undefined` = nothing to park; the pass-through response stays this host's
  // to mint, so any other header this middleware grows is never discarded.
  const response =
    (PARKING_ENTRIES.includes(request.nextUrl.pathname)
      ? parkReturnTarget(request)
      : undefined) ?? NextResponse.next();
  for (const cookie of check.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/**
 * 014 EARS-6 (#2495) — the auth doors that run the parking rule. Each door
 * runs the whole rule: a carried target is parked, and a guest's door without
 * one drops a target an earlier, abandoned flow parked.
 */
const PARKING_ENTRIES: readonly string[] = [
  "/login",
  "/register",
  "/verify",
  "/reset",
];

/**
 * Every page route: the silent check decides on any top-level document
 * request (its own exemptions keep `/v1/*`, assets, `/.well-known/*`, the auth
 * routes and the health route out), so the matcher only spares the API proxy
 * and the build assets the middleware call.
 */
export const config = {
  matcher: ["/((?!v1/|_next/static|_next/image|favicon.ico).*)"],
};
