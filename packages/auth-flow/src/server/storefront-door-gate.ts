import { NextResponse, type NextRequest } from "next/server";

import { ENTRY_REFUSAL_HEADER, entryRefusalRewrite } from "./entry-refusal";
import { parkReturnTarget } from "./return-target-parking";
import {
  storefrontEntry,
  type StorefrontEntry,
  type StorefrontOidcDeps,
  type StorefrontOidcHost,
} from "./storefront-oidc";

/**
 * 003 EARS-72 — the storefront's refusal page route, the one path a refused
 * entry is rewritten to on both storefronts (each mounts the package's
 * refusal route there, inside its own storefront shell). The address the
 * person sees stays the door URL they opened.
 */
export const STOREFRONT_ENTRY_REFUSAL_ROUTE = "/auth/refused";

/**
 * 003 EARS-61 / 72, 014 EARS-6 — the storefront gate's answer for the four
 * door paths (`routes.login` / `register` / `reset` / `verify`), the same on
 * both storefronts: the door runs the return-target parking rule and the
 * shared entry; a granted entry is the core's answer unchanged (303 + its
 * cookies); a refused one is a rewrite to {@link STOREFRONT_ENTRY_REFUSAL_ROUTE}
 * at 429 (Retry-After forwarded) or 503, as the sign-in host's proxy answers
 * an unread entry. `undefined` for a path that is no door.
 */
export async function storefrontDoorGate(
  request: NextRequest,
  host: StorefrontOidcHost,
  deps: StorefrontOidcDeps = {},
): Promise<Response | undefined> {
  // 003 EARS-72: the refusal page is reached only by this gate's rewrite
  // (an internal rewrite re-runs no gate); a request for it from outside
  // loses any refusal it names, so the page answers 404.
  if (isRefusalRoute(request.nextUrl.pathname)) {
    const headers = new Headers(request.headers);
    headers.delete(ENTRY_REFUSAL_HEADER);
    return NextResponse.next({ request: { headers } });
  }
  const entry = doorEntry(host, request.nextUrl.pathname);
  if (!entry) return undefined;
  const parked = parkReturnTarget(request);
  const outcome = await storefrontEntry(request, host, entry, deps);
  const answer =
    outcome instanceof Response
      ? outcome
      : entryRefusalRewrite(
          request,
          STOREFRONT_ENTRY_REFUSAL_ROUTE,
          outcome.refused,
        );
  // 003 EARS-43 / 72: a middleware/proxy answer's Location must be absolute
  // (Next parses it as a URL and relativises a same-origin one again), so a
  // landing path the entry answers is resolved against the door's own URL.
  const location = answer.headers.get("location");
  if (location !== null) {
    answer.headers.set("location", new URL(location, request.url).href);
  }
  for (const cookie of parked?.headers.getSetCookie() ?? []) {
    answer.headers.append("set-cookie", cookie);
  }
  return answer;
}

/**
 * 003 EARS-72 — any spelling of the refusal route a router could resolve to
 * the page (percent-encoded segments, a trailing slash) counts as a direct
 * request, so a browser-sent hand-over never reaches the page.
 */
function isRefusalRoute(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const trimmed = decoded.replace(/\/+$/, "");
  return trimmed === STOREFRONT_ENTRY_REFUSAL_ROUTE;
}

function doorEntry(
  host: StorefrontOidcHost,
  path: string,
): StorefrontEntry | undefined {
  const { routes } = host.config;
  const doors: Array<[string, StorefrontEntry]> = [
    [routes.login, "login"],
    [routes.register, "register"],
    [routes.reset, "reset"],
    [routes.verify, "verify"],
  ];
  return doors.find(([route]) => route === path)?.[1];
}
