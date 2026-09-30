import { NextResponse, type NextRequest } from "next/server";
import {
  serverApiBase,
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  parkReturnTarget,
} from "@ds/auth-flow/server";
import { DOCTOR_AUTH_ROUTES } from "@/lib/auth-flow-routes";
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
 * 014 EARS-6 (#2443, #2495) — the auth doors that run the parking rule: the
 * same four routes the Academy middleware matches, read from this host's route
 * table. A door carrying a target parks it; a guest's door without one drops a
 * target an earlier flow parked. The RULE and the cookie are
 * `@ds/auth-flow/server`'s, the same on both storefronts; this host only wires
 * its doors to it.
 */
const PARKING_ENTRIES: readonly string[] = [
  DOCTOR_AUTH_ROUTES.login,
  DOCTOR_AUTH_ROUTES.register,
  DOCTOR_AUTH_ROUTES.verify,
  DOCTOR_AUTH_ROUTES.reset,
];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = await consumeGuestSpecialtyBeforeRender(request);
  if (!PARKING_ENTRIES.includes(request.nextUrl.pathname)) return response;
  return parkReturnTarget(request, response) ?? response;
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
