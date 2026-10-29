import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import {
  ENTRY_REFUSAL_HEADER,
  readEntryRefusal,
} from "./entry-refusal";
import {
  STOREFRONT_ENTRY_REFUSAL_ROUTE,
  storefrontDoorGate,
} from "./storefront-door-gate";
import type { StorefrontOidcHost } from "./storefront-oidc";

/**
 * 003 EARS-61 / EARS-72 — the storefront gate answers the four door paths
 * itself: a granted entry is the core's answer unchanged, a refused one a
 * rewrite to the one refusal page at the truthful status.
 */

const HOSTS: Array<[string, StorefrontOidcHost]> = [
  ["academy", { client: "academy", config: ACADEMY_AUTH_FLOW }],
  ["doctor", { client: "doctor", config: DOCTOR_AUTH_FLOW }],
];
const ENV = {
  INTERNAL_API_URL: "http://api:3000/",
  INTERNAL_API_TOKEN: "t".repeat(40),
};
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

function api(transaction: () => Response) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/auth/session")) return new Response(null, { status: 401 });
    if (url.endsWith("/v1/internal/oidc/transaction")) return transaction();
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function door(path: string, headers: Record<string, string> = NAVIGATE) {
  return new NextRequest(`https://storefront.example${path}`, { headers });
}

/** Where a `NextResponse.rewrite` points (the middleware rewrite header). */
function rewriteOf(res: Response): string | null {
  const target = res.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

/** The request header a rewrite hands the page. */
function forwardedRefusal(res: Response): string | null {
  return res.headers.get(`x-middleware-request-${ENTRY_REFUSAL_HEADER}`);
}

describe("storefront door gate", () => {
  for (const [name, host] of HOSTS) {
    it(`003 EARS-61: on ${name} a path that is no door is not the gate's`, async () => {
      const res = await storefrontDoorGate(door("/webinars"), host, {
        fetchImpl: api(() => {
          throw new Error("no call");
        }),
        env: ENV,
      });
      expect(res).toBeUndefined();
    });

    it(`003 EARS-72: on ${name} a direct request for the refusal page drops a browser-sent refusal, so the page is a 404`, async () => {
      const res = await storefrontDoorGate(
        door(STOREFRONT_ENTRY_REFUSAL_ROUTE, {
          ...NAVIGATE,
          [ENTRY_REFUSAL_HEADER]: "reason=unavailable",
        }),
        host,
        {
          fetchImpl: api(() => {
            throw new Error("no call");
          }),
          env: ENV,
        },
      );
      expect(res).toBeDefined();
      expect(rewriteOf(res!)).toBeNull();
      expect(res!.headers.get("x-middleware-next")).toBe("1");
      expect(forwardedRefusal(res!)).toBeNull();
      expect(
        res!.headers.get("x-middleware-override-headers") ?? "",
      ).not.toContain(ENTRY_REFUSAL_HEADER);
    });

    it(`003 EARS-61: on ${name} a granted entry is the core's 303 unchanged, the parked return target riding on it`, async () => {
      const res = await storefrontDoorGate(
        door("/login?returnTo=%2Fdocuments"),
        host,
        {
          fetchImpl: api(() =>
            Response.json({
              txId: "T".repeat(43),
              authorizeUrl: "https://id.example/authorize",
            }),
          ),
          env: ENV,
        },
      );
      expect(res?.status).toBe(303);
      expect(res?.headers.get("location")).toBe("https://id.example/authorize");
      const cookies = res?.headers.getSetCookie() ?? [];
      expect(cookies.some((c) => c.startsWith("__Host-ds_oidc_tx="))).toBe(true);
      expect(cookies.some((c) => c.startsWith("ds_return_to=%2Fdocuments") || c.startsWith("ds_return_to=/documents"))).toBe(true);
    });

    it(`003 EARS-72: on ${name} a 429 entry rewrites every door to the refusal page with 429, Retry-After and the reason`, async () => {
      for (const path of ["/login", "/register", "/reset", "/verify"]) {
        const res = await storefrontDoorGate(door(path), host, {
          fetchImpl: api(
            () =>
              new Response(null, {
                status: 429,
                headers: { "retry-after": "105" },
              }),
          ),
          env: ENV,
        });
        expect(res?.status, path).toBe(429);
        expect(res?.headers.get("retry-after")).toBe("105");
        expect(rewriteOf(res!)).toBe(STOREFRONT_ENTRY_REFUSAL_ROUTE);
        expect(readEntryRefusal(forwardedRefusal(res!))).toEqual({
          reason: "rate-limited",
          retryAfterSeconds: 105,
        });
      }
    });

    it(`003 EARS-72: on ${name} any other refusal rewrites to the refusal page with 503 and no Retry-After`, async () => {
      const res = await storefrontDoorGate(door("/register"), host, {
        fetchImpl: api(() => new Response(null, { status: 502 })),
        env: ENV,
      });
      expect(res?.status).toBe(503);
      expect(res?.headers.get("retry-after")).toBeNull();
      expect(rewriteOf(res!)).toBe(STOREFRONT_ENTRY_REFUSAL_ROUTE);
      expect(readEntryRefusal(forwardedRefusal(res!))).toEqual({
        reason: "unavailable",
        retryAfterSeconds: null,
      });
    });
  }
});
