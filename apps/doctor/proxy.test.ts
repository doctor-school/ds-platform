import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { consumeGuestSpecialtyBeforeRender, proxy } from "./proxy";

const cookies =
  "__Host-ds_session=profile-a; __Host-ds_specialty=22222222-2222-4222-8222-222222222222";

describe("017 EARS-6 authenticated guest-choice consumption proxy", () => {
  it("EARS-6.21: successful server-side consumption shall relay cookie deletion before render without hiding the adoption input", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ specialty: null, storedIn: "none" }), {
        status: 200,
        headers: {
          "set-cookie":
            "__Host-ds_specialty=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      }),
    );
    const request = new NextRequest("http://doctor.test/", {
      headers: { cookie: cookies, "user-agent": "ua", "accept-language": "ru" },
    });

    const response = await consumeGuestSpecialtyBeforeRender(
      request,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/v1/me/specialty"),
      expect.objectContaining({
        headers: expect.objectContaining({ cookie: cookies }),
      }),
    );
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-ds_specialty=;",
    );
    expect(request.headers.get("cookie")).toBe(cookies);
  });

  it("EARS-6.22: an API failure shall retain the guest choice for a later lossless retry", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    const request = new NextRequest("http://doctor.test/", {
      headers: { cookie: cookies },
    });

    const response = await consumeGuestSpecialtyBeforeRender(
      request,
      fetchImpl,
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).not.toContain(
      "__Host-ds_specialty",
    );
    expect(
      response.headers.get(
        "x-middleware-request-x-ds-specialty-consumption-deferred",
      ),
    ).toBe("1");
    expect(request.headers.get("cookie")).toBe(cookies);
  });
});

/** The parked `ds_return_to` value this response writes, as it leaves the server. */
function parkedTarget(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((header) => header.startsWith("ds_return_to="))
    ?.split(";")[0]
    ?.slice("ds_return_to=".length);
}

describe("014 EARS-6 (#2443): the doctor storefront parks the carried return target like the Academy", () => {
  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6: %s with a guard-clean returnTo parks it in the package cookie",
    async (path) => {
      const request = new NextRequest(
        `https://doctor.school${path}?returnTo=%2Fevents%2Fahilles-042`,
      );

      const response = await proxy(request);

      expect(parkedTarget(response)).toBe("%2Fevents%2Fahilles-042");
    },
  );

  it("014 EARS-6: a page outside the auth entries parks nothing", async () => {
    const request = new NextRequest(
      "https://doctor.school/events?returnTo=%2Fevents%2Fahilles-042",
    );

    const response = await proxy(request);

    expect(parkedTarget(response)).toBeUndefined();
  });

  it("017 EARS-6 + 014 EARS-6 (#2443): a signed-in visitor on an auth entry gets the relayed specialty deletion and parks nothing", async () => {
    // The relay runs only on a session (017 EARS-6); a signed-in visitor has
    // no auth round-trip left to carry, and parking here is exactly what let
    // the post-sign-in prefetch of `/register?returnTo=...` re-park a target
    // the success handler had already consumed.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ specialty: null, storedIn: "none" }), {
        status: 200,
        headers: {
          "set-cookie":
            "__Host-ds_specialty=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const response = await proxy(
        new NextRequest(
          "https://doctor.school/register?returnTo=%2Fevents%2Fahilles-042",
          { headers: { cookie: cookies } },
        ),
      );
      const headers = response.headers.getSetCookie();
      expect(headers.some((h) => h.startsWith("__Host-ds_specialty=;"))).toBe(
        true,
      );
      expect(parkedTarget(response)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("014 EARS-6 (#2443): a guest holding only a specialty choice parks, and the choice is not consumed", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const response = await proxy(
        new NextRequest(
          "https://doctor.school/login?returnTo=%2Fevents%2Fahilles-042",
          {
            headers: {
              cookie:
                "__Host-ds_specialty=22222222-2222-4222-8222-222222222222",
            },
          },
        ),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(parkedTarget(response)).toBe("%2Fevents%2Fahilles-042");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("014 EARS-6: an auth entry with no carried target parks nothing", async () => {
    const response = await proxy(
      new NextRequest("https://doctor.school/login"),
    );

    expect(parkedTarget(response)).toBeUndefined();
  });
});

describe("014 EARS-6 (#2487): the parked land-only return stays land-only", () => {
  it("014 EARS-6: /login with a land-only returnTo parks the marked value, never the bare event page", async () => {
    const request = new NextRequest(
      "https://doctor.school/login?returnTo=%2Fevents%2Fahilles-042%3Fintent%3Dland",
    );

    const response = await proxy(request);

    const parked = parkedTarget(response);
    expect(parked).toBeDefined();
    expect(decodeURIComponent(parked ?? "")).toBe(
      "/events/ahilles-042?intent=land",
    );
  });
});

describe("014 EARS-6 (#2495): the doctor storefront binds the parked target to the flow that carried it", () => {
  const PARKED = "ds_return_to=%2Fevents%2Fahilles-042";

  function dropsParked(response: Response): boolean {
    return response.headers
      .getSetCookie()
      .some((header) => header.startsWith("ds_return_to=;") && /Max-Age=0/i.test(header));
  }

  it.each(["/login", "/register", "/verify", "/reset"])(
    "014 EARS-6.10: a guest opening %s with no returnTo drops the parked target",
    async (path) => {
      const response = await proxy(
        new NextRequest(`https://doctor.school${path}`, {
          headers: { cookie: PARKED },
        }),
      );
      expect(dropsParked(response)).toBe(true);
    },
  );

  it("014 EARS-6.10: the reset door carrying the target keeps it parked (reset started from «Записаться»)", async () => {
    const response = await proxy(
      new NextRequest(
        "https://doctor.school/reset?returnTo=%2Fevents%2Fahilles-042",
        { headers: { cookie: PARKED } },
      ),
    );
    expect(dropsParked(response)).toBe(false);
    expect(parkedTarget(response)).toBe("%2Fevents%2Fahilles-042");
  });

  it("014 EARS-6.10: a page outside the auth doors never drops the parked target", async () => {
    const response = await proxy(
      new NextRequest("https://doctor.school/events/ahilles-042", {
        headers: { cookie: PARKED },
      }),
    );
    expect(dropsParked(response)).toBe(false);
  });
});

/**
 * 003 EARS-63 — the doctor storefront's wiring of the shared silent check: it
 * runs first in the proxy, before the guest-choice consumption and the
 * parking. The rule is pinned in the package (`silent-check.test.ts`).
 */
describe("003 EARS-63: the doctor storefront mounts the shared silent check", () => {
  const AUTHORIZE =
    "https://id.example/oauth/v2/authorize?client_id=c&state=s&prompt=none";

  it("EARS-63: a signed-out document navigation is answered with the check redirect into the doctor storefront's silent transaction, before anything else runs", async () => {
    vi.stubEnv("INTERNAL_API_URL", "http://api:3000");
    vi.stubEnv("INTERNAL_API_TOKEN", "t".repeat(40));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "http://api:3000/v1/internal/oidc/silent-check",
      );
      return Response.json({ txId: "S".repeat(43), authorizeUrl: AUTHORIZE });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await proxy(
        new NextRequest("https://doctor.school/events?specialty=cardio", {
          headers: {
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
          },
        }),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(AUTHORIZE);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init[1].body))).toEqual({
        client: "doctor",
        returnPath: "/events?specialty=cardio",
      });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("EARS-63: a render the check lets through carries its cookies (the spent guard)", async () => {
    vi.stubEnv("INTERNAL_API_URL", "http://api:3000");
    vi.stubEnv("INTERNAL_API_TOKEN", "t".repeat(40));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ sub: "u1", roles: ["doctor_guest"], mfa: false }),
      ),
    );
    try {
      const response = await proxy(
        new NextRequest("https://doctor.school/events", {
          headers: {
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            cookie: "__Host-ds_check=1; __Host-ds_session=sid",
          },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toContain(
        "__Host-ds_check=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      );
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

describe("003 EARS-72: the doctor storefront answers its doors and rewrites a refused entry to the refusal page", () => {
  const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
  function refusingApi(transaction: Response) {
    vi.stubEnv("INTERNAL_API_URL", "http://api:3000");
    vi.stubEnv("INTERNAL_API_TOKEN", "t".repeat(40));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/auth/session")) return new Response(null, { status: 401 });
        if (url.endsWith("/v1/internal/oidc/transaction")) return transaction;
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  }

  it.each(["/login", "/register", "/reset", "/verify"])(
    "003 EARS-72: a 429 on %s is a 429 rewrite to /auth/refused with Retry-After and the reason",
    async (path) => {
      refusingApi(new Response(null, { status: 429, headers: { "retry-after": "105" } }));
      try {
        const res = await proxy(
          new NextRequest(`https://doctor.school${path}?returnTo=${encodeURIComponent("/events/live-1")}`, { headers: NAV }),
        );
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("105");
        expect(new URL(res.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/auth/refused");
        expect(res.headers.get("x-middleware-request-x-ds-entry-refusal")).toBe(
          "reason=rate-limited&retryAfter=105&event=live-1",
        );
      } finally {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
      }
    },
  );

  it("003 EARS-72: any other refusal is a 503 rewrite with no Retry-After", async () => {
    refusingApi(new Response(null, { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await proxy(new NextRequest("https://doctor.school/login", { headers: NAV }));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(res.headers.get("x-middleware-request-x-ds-entry-refusal")).toBe("reason=unavailable");
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});
