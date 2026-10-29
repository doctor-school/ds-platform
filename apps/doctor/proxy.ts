import { NextResponse, type NextRequest } from "next/server";
import {
  serverApiBase,
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  storefrontDoorGate,
  storefrontSilentCheck,
} from "@ds/auth-flow/server";
import { DOCTOR_STOREFRONT_OIDC } from "@/lib/auth-flow.host-config";
import {
  SPECIALTY_CHOICE_COOKIE_NAME,
  SPECIALTY_CHOICE_ME_PATH,
  SPECIALTY_CONSUMPTION_DEFERRED_HEADER,
} from "@/lib/specialty-choice";

/**
 * Consume LD-2's guest choice before the page render and relay the API's exact
 * deletion on the document response. The request cookie is deliberately left
 * intact: the API needs it to adopt into an empty profile before it is removed
 * from the browser.
 */
export async function consumeGuestSpecialtyBeforeRender(
  request: NextRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<NextResponse> {
  const cookie = request.headers.get("cookie") ?? "";
  if (
    !hasCookie(cookie, SESSION_COOKIE_NAME) ||
    !hasCookie(cookie, SPECIALTY_CHOICE_COOKIE_NAME)
  ) {
    return NextResponse.next();
  }

  try {
    const upstream = await fetchImpl(
      `${serverApiBase()}${SPECIALTY_CHOICE_ME_PATH}`,
      {
        // The adoption read runs on the doctor's own session, so it carries the
        // full fingerprint surface — client chain included, or the api re-derives a
        // different fingerprint and 401s a valid session (#2054).
        headers: forwardedHeaders(forwardedSessionFrom(request.headers)),
        cache: "no-store",
      },
    );
    if (!upstream.ok) return deferredResponse(request);

    const setCookie = upstream.headers.get("set-cookie");
    if (isSpecialtyDeletion(setCookie)) {
      const response = NextResponse.next();
      response.headers.append("set-cookie", setCookie);
      return response;
    }
  } catch {
    return deferredResponse(request);
  }
  return deferredResponse(request);
}

/**
 * 003 EARS-63 (ADR-0015 §4 step 4) — the silent check runs first, before
 * anything renders and before the page cache answers: a signed-out document
 * navigation is answered with a `303` into a `prompt=none` transaction. The
 * RULE is `@ds/auth-flow/server`'s, the same on both storefronts; a render it
 * lets through carries its cookies (the spent guard, the guest marker).
 *
 * 003 EARS-61 / 72, 014 EARS-6 — the four door paths are answered here by the
 * shared door gate (the parking rule, the entry, a refusal rewritten to the
 * refusal page at its truthful status); only the specialty cookies a door
 * relays ride on that answer — a deferred request rewrite does not, as no
 * door answer renders a page that reads the specialty.
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const check = await storefrontSilentCheck(request, DOCTOR_STOREFRONT_OIDC);
  if ("response" in check) return check.response;
  const consumed = await consumeGuestSpecialtyBeforeRender(request);
  const door = await storefrontDoorGate(request, DOCTOR_STOREFRONT_OIDC);
  if (door) {
    for (const cookie of consumed.headers.getSetCookie()) {
      door.headers.append("set-cookie", cookie);
    }
  }
  const response = door ?? consumed;
  for (const cookie of check.setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

export const config = {
  matcher: ["/((?!v1/|_next/static|_next/image|favicon.ico).*)"],
};

function hasCookie(header: string, name: string): boolean {
  return header.split(";").some((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name;
  });
}

function isSpecialtyDeletion(value: string | null): value is string {
  return (
    value !== null &&
    value.startsWith(`${SPECIALTY_CHOICE_COOKIE_NAME}=`) &&
    /(?:^|;)\s*Max-Age=0(?:;|$)/i.test(value)
  );
}

function deferredResponse(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "cookie",
    withoutCookie(
      request.headers.get("cookie") ?? "",
      SPECIALTY_CHOICE_COOKIE_NAME,
    ),
  );
  requestHeaders.set(SPECIALTY_CONSUMPTION_DEFERRED_HEADER, "1");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function withoutCookie(header: string, name: string): string {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(`${name}=`))
    .join("; ");
}
