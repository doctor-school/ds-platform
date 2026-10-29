import type { NextRequest } from "next/server";

import { entryRefusalRewrite } from "./entry-refusal";
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
  for (const cookie of parked?.headers.getSetCookie() ?? []) {
    answer.headers.append("set-cookie", cookie);
  }
  return answer;
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
