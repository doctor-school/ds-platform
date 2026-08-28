import { NextResponse, type NextRequest } from "next/server";
import { API_BASE, SESSION_COOKIE_NAME } from "@/lib/session";
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
    const upstream = await fetchImpl(`${API_BASE}${SPECIALTY_CHOICE_ME_PATH}`, {
      headers: {
        accept: "application/json",
        cookie,
        "user-agent": request.headers.get("user-agent") ?? "",
        "accept-language": request.headers.get("accept-language") ?? "",
      },
      cache: "no-store",
    });
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

export function proxy(request: NextRequest): Promise<NextResponse> {
  return consumeGuestSpecialtyBeforeRender(request);
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
