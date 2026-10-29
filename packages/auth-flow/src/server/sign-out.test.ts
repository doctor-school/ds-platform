import { SESSION_COOKIE_NAME } from "@ds/schemas";
import { describe, expect, it } from "vitest";

import { STOREFRONT_SIGN_OUT_PATH } from "../sign-out-path";
import { GUEST_MARKER_COOKIE, hasValidGuestMarker } from "./silent-check";
import { storefrontSignOut } from "./sign-out";

/**
 * 003 EARS-10 (amended) / EARS-63 (a) — the storefront sign-out: one call to
 * the API's sign-out (which ends the shared session and every linked
 * storefront session), then the signed guest marker on THIS storefront, so
 * its next navigation runs no silent check (the API half:
 * `apps/api/test/auth/logout.e2e-spec.ts`).
 */

const TOKEN = "t".repeat(40);
const ENV = { INTERNAL_API_URL: "http://api:3000/", INTERNAL_API_TOKEN: TOKEN };
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);
const CLEARED = `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function request(cookie = `${SESSION_COOKIE_NAME}=sid-1; other=x`) {
  return new Request(`https://academy.example${STOREFRONT_SIGN_OUT_PATH}`, {
    method: "POST",
    headers: {
      cookie,
      "user-agent": "Browser/1.0",
      "accept-language": "ru-RU",
      "x-forwarded-for": "203.0.113.5",
    },
  });
}

function fakeApi(status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const headers = new Headers({ "content-type": "application/json" });
    if (status === 200) headers.append("set-cookie", CLEARED);
    return Promise.resolve(
      new Response(
        JSON.stringify(
          status === 200 ? { status: "logged_out" } : { message: "x" },
        ),
        { status, headers },
      ),
    );
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("storefront sign-out (003 EARS-10 amended, EARS-63 (a))", () => {
  it("EARS-10: the sign-out calls the API once with the session cookie and the browser's fingerprint surface, then clears the session and sets the signed guest marker", async () => {
    const api = fakeApi();
    const res = await storefrontSignOut(request(), {
      env: ENV,
      fetchImpl: api.fetchImpl,
      now: () => NOW,
    });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.url).toBe("http://api:3000/v1/auth/logout");
    const sent = new Headers(api.calls[0]!.init?.headers);
    expect(api.calls[0]!.init?.method).toBe("POST");
    expect(sent.get("cookie")).toBe(`${SESSION_COOKIE_NAME}=sid-1`);
    expect(sent.get("user-agent")).toBe("Browser/1.0");
    expect(sent.get("accept-language")).toBe("ru-RU");
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.5");
    // The internal credential never rides the public sign-out.
    expect(sent.get("authorization")).toBeNull();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "logged_out" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookies = res.headers.getSetCookie();
    expect(cookies).toContain(CLEARED);
    const marker = cookies.find((c) => c.startsWith(`${GUEST_MARKER_COOKIE}=`));
    expect(marker).toMatch(
      /; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/,
    );
    const value = marker!.split(";")[0]!;
    expect(await hasValidGuestMarker(value, TOKEN, NOW)).toBe(true);
    // No end_session redirect: the answer is the API's JSON, never a Location.
    expect(res.headers.get("location")).toBeNull();
  });

  it("EARS-10: a refused or failed API sign-out is relayed as is and sets no marker", async () => {
    for (const status of [401, 503]) {
      const api = fakeApi(status);
      const res = await storefrontSignOut(request(), {
        env: ENV,
        fetchImpl: api.fetchImpl,
        now: () => NOW,
      });
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(
        res.headers
          .getSetCookie()
          .some((c) => c.startsWith(GUEST_MARKER_COOKIE)),
      ).toBe(false);
    }
  });

  it("EARS-10: an unreachable API or a storefront without the internal API answers 503 and sets no marker", async () => {
    const down = await storefrontSignOut(request(), {
      env: ENV,
      fetchImpl: (() => Promise.reject(new Error("down"))) as typeof fetch,
      now: () => NOW,
    });
    expect(down.status).toBe(503);
    expect(down.headers.getSetCookie()).toEqual([]);
    const unconfigured = await storefrontSignOut(request(), { env: {} });
    expect(unconfigured.status).toBe(503);
  });
});
