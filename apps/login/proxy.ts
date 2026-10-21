import { NextResponse, type NextRequest } from "next/server";

import {
  contentSecurityPolicy,
  HARDENING_HEADERS,
  isTopLevelNavigation,
  newNonce,
} from "@/lib/host-headers";
import {
  DOOR_ROUTES,
  ENTRY_HEADER,
  doorFor,
  readEntry,
  writeEntryHeader,
} from "@/lib/sign-in-entry";

/**
 * The sign-in host's request gate (Next 16 proxy) — 003 EARS-60 / 66 / 67 /
 * 70, ADR-0015 §4 req. 2(a) / 4.
 *
 * - A door route (`/login`, `/register`, `/reset`, `/verify`) answers only a
 *   top-level navigation; anything else is a bare 403, the API is never asked
 *   and no cookie is set. A navigation asks the API's entry what it is: a
 *   `redirect` is a 303 to the API's URL; a `render` reaches the page as a
 *   request header (the page cannot set cookies — the API's form-state cookie
 *   rides THIS response).
 * - Every other path is EARS-67's direct visit: the API's answer for a
 *   request naming no auth request (the doctor storefront `/login`), never a
 *   URL of this app's own.
 * - Every answer carries the strict nonce CSP, COOP `same-origin`,
 *   `Referrer-Policy: no-referrer`; none carries a CORS header.
 *
 * `/v1/*` (the API rewrite) and `/_next/*` never reach here; `next.config.ts`
 * hardens those.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);
  const path = request.nextUrl.pathname;

  if (path === "/icon.svg" || path.startsWith("/brand/")) {
    return harden(NextResponse.next(), csp);
  }

  if (!isTopLevelNavigation(request.headers)) {
    return harden(new NextResponse(null, { status: 403 }), csp);
  }

  const pathDoor = DOOR_ROUTES[path];
  const authRequest = pathDoor
    ? request.nextUrl.searchParams.get("authRequest")
    : null;

  let entry;
  try {
    entry = await readEntry(request.headers, authRequest);
  } catch {
    // Fail closed: no form and no guessed destination.
    return harden(new NextResponse(null, { status: 503 }), csp);
  }

  if (entry.answer.action === "redirect" || !pathDoor) {
    const location =
      entry.answer.action === "redirect" ? entry.answer.url : null;
    const res = location
      ? NextResponse.redirect(location, 303)
      : // A render answer for a path that is no door cannot happen (the path
        // sends no auth request); refuse rather than invent a destination.
        new NextResponse(null, { status: 503 });
    return harden(withCookies(res, entry.setCookies), csp);
  }

  const forwarded = new Headers(request.headers);
  forwarded.set(
    ENTRY_HEADER,
    writeEntryHeader({
      door: doorFor(
        pathDoor,
        entry.answer,
        request.headers.get("sec-fetch-site"),
      ),
      render: entry.answer,
    }),
  );
  forwarded.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: forwarded } });
  return harden(withCookies(res, entry.setCookies), csp);
}

function withCookies(res: NextResponse, cookies: string[]): NextResponse {
  for (const cookie of cookies) res.headers.append("set-cookie", cookie);
  return res;
}

function harden(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(HARDENING_HEADERS)) {
    res.headers.set(name, value);
  }
  return res;
}

export const config = {
  matcher: ["/((?!v1/|_next/).*)"],
};
