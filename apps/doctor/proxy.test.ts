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
  it.each(["/login", "/register", "/verify"])(
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
