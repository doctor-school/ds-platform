import { parseSameOriginReturnTarget } from "@ds/schemas";
import { NextResponse, type NextRequest } from "next/server";

import { RETURN_TARGET_PARKING } from "../host-config";

/**
 * The ONE `returnTo` parking rule of the shared auth flow (wave-1 gate rows
 * 29-31, #2027 PR 1.4).
 *
 * 014 EARS-6 / design S6 is the behaviour; which step consumes a parked target
 * is decided there and in 021 EARS-10, not here. This rule only parks: the
 * target is validated through the `@ds/schemas` same-origin guard and the
 * CANONICAL result is written to a short-lived cookie, so every consumer reads
 * back a value that already passed the guard.
 *
 * Row 29 (#2443): the parking is package mechanics, ON for both storefronts
 * under one cookie (`RETURN_TARGET_PARKING`), so a hop that loses the query
 * param lands the same way on either storefront. Each host's middleware calls
 * this rule on its auth entries; neither host states whether or where it parks.
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
 * A host whose middleware already minted its response for another reason (the
 * doctor storefront's specialty consumption) hands it in as `response`, and the
 * cookie is written onto it, so both effects reach the browser.
 */
export function parkReturnTarget(
  request: NextRequest,
  response?: NextResponse,
): NextResponse | undefined {
  const target = parseSameOriginReturnTarget(
    request.nextUrl.searchParams.get("returnTo"),
  );
  if (!target) return undefined;

  const parked = NextResponse.next();
  parked.cookies.set(RETURN_TARGET_PARKING.name, target, {
    path: "/",
    maxAge: RETURN_TARGET_PARKING.maxAgeSeconds,
    sameSite: "lax",
    // NOT HttpOnly: the consumption point is the client-side auth success
    // handler, which must both read and clear it. It holds a page path and no
    // credential.
    httpOnly: false,
    secure: request.nextUrl.protocol === "https:",
  });
  if (!response) return parked;
  // APPENDED as a header rather than set through `response.cookies`: the cookie
  // store re-serialises `set-cookie` from its own entries and would drop any
  // header the host appended by hand (the doctor proxy relays the API's exact
  // specialty-cookie deletion that way).
  for (const header of parked.headers.getSetCookie()) {
    response.headers.append("set-cookie", header);
  }
  return response;
}
