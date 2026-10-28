import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, middleware } from "./middleware";

/**
 * 014 EARS-6 — the Academy wiring of the shared `@ds/auth-flow` parking rule:
 * which doors run it. The rule itself is pinned in the package
 * (`return-target-parking.test.ts`); these cases pin that this host's doors
 * reach it, the same doors the doctor storefront's proxy wires.
 *
 * 003 EARS-63 — the Academy wiring of the shared silent check: every page
 * route reaches it, and its answer is this host's. The rule itself is pinned
 * in the package (`silent-check.test.ts`).
 */
const PARKED = "ds_return_to=%2Fwebinars%2Fahilles-042";
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const AUTHORIZE =
  "https://id.example/oauth/v2/authorize?client_id=c&state=s&prompt=none";

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

/** The matcher's one source pattern, as Next compiles it (path-to-regexp form). */
function matched(path: string): boolean {
  const [pattern] = config.matcher;
  return new RegExp(`^${pattern}$`).test(path);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("014 EARS-6 (#2495): the Academy binds the parked target to the flow that carried it", () => {
  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6.10: %s with a guard-clean returnTo parks it",
    async (path) => {
      const response = await middleware(
        new NextRequest(
          `https://academy.doctor.school${path}?returnTo=%2Fwebinars%2Fahilles-042`,
        ),
      );
      expect(
        setCookies(response).some((h) =>
          h.startsWith("ds_return_to=%2Fwebinars%2Fahilles-042;"),
        ),
      ).toBe(true);
    },
  );

  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6.10: a guest opening %s with no returnTo drops the parked target",
    async (path) => {
      const response = await middleware(
        new NextRequest(`https://academy.doctor.school${path}`, {
          headers: { cookie: PARKED },
        }),
      );
      expect(
        setCookies(response).some(
          (h) => h.startsWith("ds_return_to=;") && /Max-Age=0/i.test(h),
        ),
      ).toBe(true);
    },
  );

  it("014 EARS-6.10: a signed-in visitor's parked value is left alone", async () => {
    const response = await middleware(
      new NextRequest("https://academy.doctor.school/login", {
        headers: { cookie: `__Host-ds_session=abc; ${PARKED}` },
      }),
    );
    expect(setCookies(response)).toEqual([]);
  });

  it("014 EARS-6.10: a page off the auth doors parks nothing", async () => {
    const response = await middleware(
      new NextRequest(
        "https://academy.doctor.school/webinars?returnTo=%2Fwebinars%2Fx",
      ),
    );
    expect(setCookies(response)).toEqual([]);
  });
});

describe("003 EARS-63: the Academy mounts the shared silent check", () => {
  it("EARS-63: the middleware reaches every page route, and spares the API proxy and the build assets", () => {
    for (const path of [
      "/",
      "/webinars",
      "/webinars/a-1",
      "/login",
      "/account",
    ]) {
      expect(matched(path), path).toBe(true);
    }
    for (const path of [
      "/v1/auth/session",
      "/_next/static/x.js",
      "/favicon.ico",
    ]) {
      expect(matched(path), path).toBe(false);
    }
  });

  it("EARS-63: a signed-out document navigation is answered with the check redirect into the Academy's silent transaction", async () => {
    vi.stubEnv("INTERNAL_API_URL", "http://api:3000");
    vi.stubEnv("INTERNAL_API_TOKEN", "t".repeat(40));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "http://api:3000/v1/internal/oidc/silent-check",
      );
      return Response.json({ txId: "S".repeat(43), authorizeUrl: AUTHORIZE });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await middleware(
      new NextRequest("https://academy.doctor.school/webinars", {
        headers: NAVIGATE,
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(AUTHORIZE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body))).toEqual({
      client: "academy",
      returnPath: "/webinars",
    });
  });
});
