import { NextResponse, type NextRequest } from "next/server";

import {
  contentSecurityPolicy,
  HARDENING_HEADERS,
  isTopLevelNavigation,
  newNonce,
} from "@/lib/host-headers";
import {
  SIGN_IN_HOST_ENTRY_HEADER,
  SIGN_IN_HOST_UNAVAILABLE_HEADER,
  writeSignInHostHandOver,
  type SignInHostUnavailable,
} from "@ds/auth-flow/server";
import {
  DOOR_ROUTES,
  doorFor,
  EntryReadError,
  readEntry,
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
 * - An entry the API refuses or cannot answer keeps a truthful status — its
 *   429 stays 429 (Retry-After forwarded), anything else is 503 — and the
 *   `/login` mount renders the forms' own banner for it (no form, no
 *   guessed redirect, never an empty page).
 * - `/healthz` (the image liveness probe) passes to its route for any
 *   request: no auth state, no API call, no cookie.
 * - Every other path is EARS-67's direct visit: the API's answer for a
 *   request naming no auth request (the doctor storefront `/login`), never a
 *   URL of this app's own.
 * - Every answer carries the strict nonce CSP, COOP `same-origin`,
 *   `Referrer-Policy: no-referrer`; none carries a CORS header.
 *
 * `/v1/*` (the API rewrite) and `/_next/*` never reach here; `next.config.ts`
 * hardens those.
 */
/** The liveness probe the image smoke and the stand healthcheck call. */
const HEALTH_PATH = "/healthz";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);
  const path = request.nextUrl.pathname;

  if (path === "/icon.svg" || path.startsWith("/brand/")) {
    return harden(NextResponse.next(), csp);
  }

  // The image liveness probe (`app/healthz/route.ts`): no auth state, no API
  // call, no cookie. Only this exact path; every page stays navigate-only.
  if (path === HEALTH_PATH) {
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
  } catch (error) {
    // Fail closed: no form and no guessed destination. Logged, so the
    // failure is never a silent one (the API status or the transport failure).
    console.error(
      "[sign-in-host] entry read failed:",
      error instanceof Error ? error.message : error,
    );
    const refused = error instanceof EntryReadError ? error : null;
    return harden(
      unavailable(
        request,
        csp,
        refused?.status === 429 ? "rate-limited" : "unavailable",
        refused?.retryAfter ?? null,
      ),
      csp,
    );
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
    SIGN_IN_HOST_ENTRY_HEADER,
    writeSignInHostHandOver({
      door: doorFor(
        pathDoor,
        entry.answer,
        request.headers.get("sec-fetch-site"),
      ),
      render: entry.answer,
    }),
  );
  forwarded.delete(SIGN_IN_HOST_UNAVAILABLE_HEADER);
  forwarded.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: forwarded } });
  return harden(withCookies(res, entry.setCookies), csp);
}

/**
 * The unread entry's answer: a rewrite to the `/login` mount (every path,
 * a direct visit included, has the one page that renders the banner) at the
 * truthful status, the reason riding as a request header.
 */
function unavailable(
  request: NextRequest,
  csp: string,
  reason: SignInHostUnavailable,
  retryAfter: string | null,
): NextResponse {
  const forwarded = new Headers(request.headers);
  forwarded.delete(SIGN_IN_HOST_ENTRY_HEADER);
  forwarded.set(SIGN_IN_HOST_UNAVAILABLE_HEADER, reason);
  forwarded.set("content-security-policy", csp);
  const res = NextResponse.rewrite(new URL("/login", request.url), {
    status: reason === "rate-limited" ? 429 : 503,
    request: { headers: forwarded },
  });
  if (retryAfter !== null) res.headers.set("Retry-After", retryAfter);
  return res;
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
