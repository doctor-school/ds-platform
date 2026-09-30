import { parseSameOriginReturnTarget } from "@ds/schemas";
import { NextResponse, type NextRequest } from "next/server";

import { RETURN_TARGET_PARKING } from "../host-config";
import { hasSessionCookie } from "./session";

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
 *
 * A signed-in visitor never parks (#2443). The consumer clears the cookie
 * exactly once on auth success; after that, the landing page's router
 * PREFETCH of an auth entry that still carries `returnTo` (the «Создать
 * аккаунт» link, `/register?returnTo=...`) reaches this rule and would re-park
 * the target just used, so a later plain `/login` would land on a stale page.
 * The prefetch itself cannot be recognised here: Next 16's middleware adapter
 * strips every flight header (`rsc`, `next-router-prefetch`,
 * `next-router-segment-prefetch`, ...) and the `_rsc` query param before the
 * host's proxy/middleware sees the request
 * (`next/dist/server/web/adapter.js`, FLIGHT_HEADERS loop and
 * `stripInternalSearchParams`), and no `x-middleware-prefetch` is set for the
 * app router. The session is the signal that survives: parking exists to carry
 * a GUEST through the auth round-trip, and a visitor who already holds a
 * session (`hasSessionCookie`, the platform's one session-presence contract)
 * has no round-trip left to carry. Sign-out drops the session cookie, so a
 * guest parks again from then on. This holds for every prefetch strategy,
 * including a `<Link prefetch>` "Full" prefetch.
 *
 * The parked target lives only inside the flow that carried it (014 EARS-6,
 * amendment 2026-09-30, #2495). Every hop INSIDE a flow carries `returnTo` on
 * the URL (the doors' footer links, register -> verify, verify -> login, the
 * address-less verify -> register) or never leaves the page (the OTP step, the
 * reset code step), so a guest who opens an auth door with no guard-clean
 * `returnTo` has started a NEW flow - the header «Войти», a bare `/login`
 * typed or bookmarked, Back followed by another entry. That door drops any
 * parked target, so an abandoned «Записаться» can never register the visitor
 * on a later, unrelated sign-in. Same rule, same cookie, both storefronts.
 */

/**
 * Park the carried target; with no guard-clean target, drop a target parked by
 * an earlier flow. Returns `undefined` when there is nothing to write (the
 * visitor is already signed in, or nothing is carried and nothing is parked).
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
  if (hasSessionCookie(request.headers.get("cookie"))) return undefined;
  const target = parseSameOriginReturnTarget(
    request.nextUrl.searchParams.get("returnTo"),
  );
  if (!target && !request.cookies.has(RETURN_TARGET_PARKING.name)) {
    return undefined;
  }

  const parked = NextResponse.next();
  parked.cookies.set(RETURN_TARGET_PARKING.name, target ?? "", {
    path: "/",
    // No carried target: a new flow began, so the earlier flow's target dies.
    maxAge: target ? RETURN_TARGET_PARKING.maxAgeSeconds : 0,
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
