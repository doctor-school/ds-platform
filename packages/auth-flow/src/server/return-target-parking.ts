import { parseSameOriginReturnTarget } from "@ds/schemas";
import { NextResponse, type NextRequest } from "next/server";

import type { AuthFlowReturnToConfig } from "../host-config";

/**
 * The ONE `returnTo` parking rule of the shared auth flow (wave-1 gate rows
 * 29-31, #2027 PR 1.4).
 *
 * 014 EARS-6 / design S6 is the behaviour. A gated surface links into the auth
 * entry with `?returnTo=<same-origin path>` and the query carries it onward
 * through the flow. The one hop the query CANNOT survive is the registration
 * branch trip through the inbox: the verification mail lands the visitor on a
 * cold `/verify#email=...` in a fresh navigation with no query at all. So the
 * moment a visitor reaches an auth entry with a target, the target is validated
 * through the `@ds/schemas` same-origin guard and the CANONICAL result is parked
 * in a short-lived cookie; the client consumption point
 * (`@ds/auth-flow/client` resolveReturnTarget) reads it back exactly once,
 * re-validates it, and clears it.
 *
 * Row 29 is why the rule takes the parking config rather than assuming it: the
 * doctor storefront parks NOTHING. It carries the target on the canonical query
 * param and has no cookie at all, which is a host fact, not a missing feature.
 * A host that states no `returnTo` gets the same rule, parking nothing - as
 * opposed to the host owning a second, absent copy of the rule.
 *
 * Only a guard-clean target is ever written, so the cookie can never hold a
 * cross-origin, protocol-relative, backslash-escaped or app-escaping value. The
 * cookie carries no signature because it carries no privilege: it is a page
 * path, and the guard - re-applied at the moment of use - is the defence that
 * makes following it safe.
 */

/**
 * Park the carried target, or return `undefined` when there is nothing to park.
 *
 * `undefined` rather than a bare `NextResponse.next()` on purpose: the caller (a
 * host middleware) owns what the pass-through response is, and a rule that
 * minted one would quietly discard any other header that middleware had set.
 */
export function parkReturnTarget(
  request: NextRequest,
  returnTo: AuthFlowReturnToConfig | undefined,
): NextResponse | undefined {
  // Row 29 - this host parks nothing.
  if (!returnTo?.parkingCookie) return undefined;

  const target = parseSameOriginReturnTarget(
    request.nextUrl.searchParams.get("returnTo"),
  );
  if (!target) return undefined;

  const response = NextResponse.next();
  response.cookies.set(returnTo.parkingCookie.name, target, {
    path: "/",
    maxAge: returnTo.parkingCookie.maxAgeSeconds,
    sameSite: "lax",
    // NOT HttpOnly: the consumption point is the client-side auth success
    // handler, which must both read and clear it. It holds a page path and no
    // credential.
    httpOnly: false,
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
