import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { consumeGuestSpecialtyBeforeRender } from "./proxy";

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
