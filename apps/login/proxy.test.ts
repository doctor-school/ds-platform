import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIGN_IN_HOST_ENTRY_HEADER as ENTRY_HEADER,
  SIGN_IN_HOST_UNAVAILABLE_HEADER as UNAVAILABLE_HEADER,
  readSignInHostHandOver as readEntryHeader,
} from "@ds/auth-flow/server";
import { proxy } from "./proxy";

/**
 * 003 EARS-60 / 66 / 67 / 70, ADR-0015 §4 req. 2(a)/3/4 — the sign-in host's
 * request gate (#3170). The API's entry answer is the single source of the
 * storefront and of every redirect; the gate adds the navigate-only rule and
 * the response hardening on every answer.
 */

const API = "http://api.test";
const ZITADEL_CALLBACK = "https://id.test/oauth/v2/callback?code=1";
const DOCTOR_LOGIN = "http://doctor.test/login";
const ACADEMY_LOGIN = "http://academy.test/login";

const fetchMock = vi.fn();

const NAVIGATE = {
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-site": "cross-site",
  "user-agent": "HostTest/1.0",
  "accept-language": "ru-RU",
  "x-forwarded-for": "203.0.113.7",
  cookie: "__Host-ds_login=rec; __Host-ds_login_form=old",
};

function request(path: string, headers: Record<string, string> = NAVIGATE) {
  return new NextRequest(new URL(path, "http://localhost:3005"), { headers });
}

function answer(body: unknown, setCookie?: string[]) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of setCookie ?? []) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

const RENDER_DOCTOR = {
  action: "render",
  storefront: "doctor",
  door: "login",
  authRequest: "V2_1",
  csrf: "csrf-1",
};

beforeEach(() => {
  vi.stubEnv("API_PROXY_TARGET", API);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectHardened(res: Response) {
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  for (const [name] of res.headers) {
    expect(name.toLowerCase().startsWith("access-control-")).toBe(false);
  }
}

describe("003 EARS-60: the form is chosen only by the API's entry answer", () => {
  it("003 EARS-60: a doctor-client auth request renders the doctor form, forwarding the browser's facts", async () => {
    fetchMock.mockResolvedValue(
      answer(RENDER_DOCTOR, [
        "__Host-ds_login_form=new; Path=/; Secure; HttpOnly; SameSite=Lax",
      ]),
    );
    const res = await proxy(request("/login?authRequest=V2_1"));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/sign-in-host/entry?authRequest=V2_1`);
    const sent = new Headers(init.headers);
    expect(sent.get("cookie")).toBe(NAVIGATE.cookie);
    expect(sent.get("user-agent")).toBe(NAVIGATE["user-agent"]);
    expect(sent.get("accept-language")).toBe(NAVIGATE["accept-language"]);
    expect(sent.get("x-forwarded-for")).toBe(NAVIGATE["x-forwarded-for"]);
    expect(sent.get("sec-fetch-site")).toBe("cross-site");

    // Rendered: the entry rides to the page as a request header, the API's
    // cookie reaches the browser.
    expect(res.headers.get("x-middleware-next")).toBe("1");
    const forwarded = res.headers.get(`x-middleware-request-${ENTRY_HEADER}`);
    expect(readEntryHeader(forwarded)).toEqual({
      door: "login",
      render: RENDER_DOCTOR,
    });
    expect(res.headers.get("set-cookie")).toContain("__Host-ds_login_form=new");
    expectHardened(res);
  });

  it("003 EARS-60: the admin or an unknown client gets the API's redirect and no form", async () => {
    fetchMock.mockResolvedValue(
      answer({
        action: "redirect",
        url: `${ZITADEL_CALLBACK}&error=access_denied`,
      }),
    );
    const res = await proxy(request("/login?authRequest=V2_admin"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `${ZITADEL_CALLBACK}&error=access_denied`,
    );
    expect(res.headers.get(`x-middleware-request-${ENTRY_HEADER}`)).toBeNull();
    expectHardened(res);
  });

  it("a header the browser sends under the entry's name never reaches the page", async () => {
    fetchMock.mockResolvedValue(answer(RENDER_DOCTOR));
    const res = await proxy(
      request("/login?authRequest=V2_1", {
        ...NAVIGATE,
        [ENTRY_HEADER]: "forged",
      }),
    );
    expect(
      readEntryHeader(res.headers.get(`x-middleware-request-${ENTRY_HEADER}`)),
    ).toEqual({ door: "login", render: RENDER_DOCTOR });
  });

  it("003 EARS-71: the Zitadel arrival on /login opens the door the entry chose; a same-origin hop keeps its own door", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(answer({ ...RENDER_DOCTOR, door: "register" })),
    );
    const arrival = await proxy(request("/login?authRequest=V2_1"));
    expect(
      readEntryHeader(
        arrival.headers.get(`x-middleware-request-${ENTRY_HEADER}`),
      )?.door,
    ).toBe("register");

    const hop = await proxy(
      request("/login?authRequest=V2_1", {
        ...NAVIGATE,
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(
      readEntryHeader(hop.headers.get(`x-middleware-request-${ENTRY_HEADER}`))
        ?.door,
    ).toBe("login");
  });
});

describe("003 EARS-66 / 67: stale requests and direct visits go where the API says", () => {
  it("003 EARS-66: a stale auth request follows the API's redirect to its storefront", async () => {
    fetchMock.mockResolvedValue(
      answer({ action: "redirect", url: ACADEMY_LOGIN }),
    );
    const res = await proxy(request("/register?authRequest=V2_gone"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(ACADEMY_LOGIN);
  });

  it.each(["/", "/admin", "/login", "/anything/else?authRequest=V2_1"])(
    "003 EARS-67: %s asks the API with no auth request and follows its redirect",
    async (path) => {
      fetchMock.mockResolvedValue(
        answer({ action: "redirect", url: DOCTOR_LOGIN }),
      );
      const res = await proxy(request(path));
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${API}/v1/sign-in-host/entry`);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(DOCTOR_LOGIN);
      expectHardened(res);
    },
  );

  it("an API that cannot answer is a 503 with no form, never a guessed redirect", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(request("/login?authRequest=V2_1"));
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    // Not an empty page: the door mount renders the unavailable banner.
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3005/login",
    );
    expect(res.headers.get(`x-middleware-request-${UNAVAILABLE_HEADER}`)).toBe(
      "unavailable",
    );
    expect(res.headers.get(`x-middleware-request-${ENTRY_HEADER}`)).toBeNull();
    expectHardened(res);
    // Never a silent 503: the cause is logged.
    expect(logged).toHaveBeenCalledWith(
      "[sign-in-host] entry read failed:",
      "down",
    );
    logged.mockRestore();
  });
});

describe("the API refuses the entry read: a truthful status and the forms' words", () => {
  it.each(["/login?authRequest=V2_1", "/"])(
    "a 429 on %s is a 429 rendering the rate-limit banner, Retry-After forwarded",
    async (path) => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ message: "Too Many Requests" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "42" },
        }),
      );
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await proxy(request(path));
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("42");
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-rewrite")).toBe(
        "http://localhost:3005/login",
      );
      expect(
        res.headers.get(`x-middleware-request-${UNAVAILABLE_HEADER}`),
      ).toBe("rate-limited");
      expect(
        res.headers.get("x-middleware-request-content-security-policy"),
      ).toBe(res.headers.get("content-security-policy"));
      expectHardened(res);
      logged.mockRestore();
    },
  );

  it("a 500 is a 503 rendering the unavailable banner, with no Retry-After it never sent", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(request("/login?authRequest=V2_1"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(res.headers.get(`x-middleware-request-${UNAVAILABLE_HEADER}`)).toBe(
      "unavailable",
    );
    expect(logged).toHaveBeenCalledWith(
      "[sign-in-host] entry read failed:",
      "sign-in entry answered 500",
    );
    expectHardened(res);
    logged.mockRestore();
  });

  it("a browser-sent unavailable header never reaches a rendered door", async () => {
    fetchMock.mockResolvedValue(answer(RENDER_DOCTOR));
    const res = await proxy(
      request("/login?authRequest=V2_1", {
        ...NAVIGATE,
        [UNAVAILABLE_HEADER]: "rate-limited",
      }),
    );
    expect(res.headers.get(`x-middleware-request-${UNAVAILABLE_HEADER}`)).toBeNull();
  });
});

describe("003 EARS-70: page routes answer top-level navigations only", () => {
  it.each([
    [
      "a fetch (mode cors)",
      { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    ],
    ["a frame", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }],
    ["no fetch metadata", {}],
  ])(
    "003 EARS-70: %s is refused, the API is never asked and no cookie is set",
    async (_label, fetchMeta) => {
      const res = await proxy(
        request("/login?authRequest=V2_1", {
          cookie: NAVIGATE.cookie,
          ...fetchMeta,
        }),
      );
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.headers.get("set-cookie")).toBeNull();
      expectHardened(res);
    },
  );

  it("003 EARS-70: every response carries a fresh nonce", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer(RENDER_DOCTOR)));
    const a = await proxy(request("/login?authRequest=V2_1"));
    const b = await proxy(request("/login?authRequest=V2_1"));
    const nonceOf = (r: Response) =>
      /'nonce-([^']+)'/.exec(
        r.headers.get("content-security-policy") ?? "",
      )?.[1];
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
    // Next reads the nonce from the REQUEST's CSP header to stamp its scripts.
    expect(
      a.headers.get("x-middleware-request-content-security-policy"),
    ).toContain(`'nonce-${nonceOf(a)}'`);
  });

  it("003 EARS-70: the icon is served to a non-navigation with the same hardening", async () => {
    const res = await proxy(
      request("/icon.svg", {
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "image",
      }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
    expectHardened(res);
  });
});

/**
 * ADR-0015 §4 req. 4 — the host's cookies are the API's, set through this
 * origin: the gate passes each `Set-Cookie` through byte for byte, so the
 * host-only attributes the API serializes (`apps/api/src/sign-in-host/
 * sign-in-host.cookies.ts`) are what the browser stores.
 */
describe("ADR-0015 §4 req. 4: the API's host-only cookies pass through unchanged", () => {
  const FORM =
    "__Host-ds_login_form=f1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400";
  const RECORD_CLEARED =
    "__Host-ds_login=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

  function cookiesOf(res: Response): string[] {
    return res.headers.getSetCookie();
  }

  function expectHostOnly(cookie: string) {
    const attrs = cookie.split("; ").slice(1);
    expect(cookie.startsWith("__Host-")).toBe(true);
    expect(attrs).toEqual(
      expect.arrayContaining(["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]),
    );
    expect(attrs.some((a) => /^domain=/i.test(a))).toBe(false);
  }

  it("003 EARS-70: a render answer's form-state cookie reaches the browser as the API serialized it", async () => {
    fetchMock.mockResolvedValueOnce(answer(RENDER_DOCTOR, [FORM]));
    const res = await proxy(request("/login?authRequest=V2_1"));
    expect(cookiesOf(res)).toEqual([FORM]);
    expectHostOnly(cookiesOf(res)[0]);
  });

  it("003 EARS-66: a redirect answer's cookies ride the 303 unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ action: "redirect", url: DOCTOR_LOGIN }, [RECORD_CLEARED, FORM]),
    );
    const res = await proxy(request("/login?authRequest=V2_stale"));
    expect(res.status).toBe(303);
    expect(cookiesOf(res)).toEqual([RECORD_CLEARED, FORM]);
    for (const cookie of cookiesOf(res)) expectHostOnly(cookie);
  });
});
