import { describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import {
  CHECK_GUARD_COOKIE,
  GUEST_MARKER_COOKIE,
  checkGuardCookie,
  guestMarkerCookie,
  silentTransactionCookieValue,
  storefrontSilentCheck,
  type SilentCheckOutcome,
} from "./silent-check";
import {
  OIDC_TX_COOKIE,
  storefrontCallback,
  type StorefrontOidcHost,
} from "./storefront-oidc";

/**
 * 003 EARS-63 / EARS-62 (the silent halves), ADR-0015 §4 step 4, req. 1, 9,
 * 12 — the server-side silent check both storefronts mount in their
 * middleware / proxy, and the silent outcomes of the callback, driven against
 * a fake of the API's internal routes and session read (the API halves:
 * `apps/api/test/auth/storefront-oidc.e2e-spec.ts`).
 */

const ACADEMY: StorefrontOidcHost = {
  client: "academy",
  config: ACADEMY_AUTH_FLOW,
};
const DOCTOR: StorefrontOidcHost = {
  client: "doctor",
  config: DOCTOR_AUTH_FLOW,
};
const TOKEN = "t".repeat(40);
const ENV = { INTERNAL_API_URL: "http://api:3000/", INTERNAL_API_TOKEN: TOKEN };
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const SILENT_TX_ID = "S".repeat(43);
const INTERACTIVE_TX_ID = "I".repeat(43);
const AUTHORIZE =
  "https://id.example/oauth/v2/authorize?client_id=c&state=st&prompt=none";
const BROWSER = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0",
  "accept-language": "ru-RU",
  "x-forwarded-for": "203.0.113.5",
};
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

/** The API: the session read, the silent-check start, the redeem. */
function fakeApi(
  opts: {
    signedIn?: boolean;
    silentCheck?: number;
    redeem?: () => Response;
  } = {},
) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null,
    });
    if (url.endsWith("/v1/auth/session")) {
      return opts.signedIn
        ? Response.json({ sub: "u1", roles: ["doctor_guest"], mfa: false })
        : new Response(null, { status: 401 });
    }
    if (url === "http://api:3000/v1/internal/oidc/silent-check") {
      return opts.silentCheck && opts.silentCheck !== 200
        ? new Response(null, { status: opts.silentCheck })
        : Response.json({ txId: SILENT_TX_ID, authorizeUrl: AUTHORIZE });
    }
    if (url === "http://api:3000/v1/internal/oidc/redeem" && opts.redeem) {
      return opts.redeem();
    }
    if (url.includes("/v1/public/events/")) {
      return new Response(null, { status: 503 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const starts = () =>
    calls.filter(
      (c) => c.url === "http://api:3000/v1/internal/oidc/silent-check",
    );
  return { fetchImpl, calls, starts };
}

function nav(
  path: string,
  headers: Record<string, string> = {},
  init: RequestInit = {},
): Request {
  return new Request(`https://academy.example${path}`, {
    ...init,
    headers: { ...BROWSER, ...NAVIGATE, ...headers },
  });
}

function check(
  request: Request,
  api: ReturnType<typeof fakeApi>,
  host: StorefrontOidcHost = ACADEMY,
  now = NOW,
): Promise<SilentCheckOutcome> {
  return storefrontSilentCheck(request, host, {
    fetchImpl: api.fetchImpl,
    env: ENV,
    now: () => now,
  });
}

function redirected(outcome: SilentCheckOutcome): Response {
  if (!("response" in outcome)) throw new Error("expected a check redirect");
  return outcome.response;
}

function rendered(outcome: SilentCheckOutcome): readonly string[] {
  if ("response" in outcome) throw new Error("expected a render");
  return outcome.setCookies;
}

/** The `name=value` pairs a browser keeps from `Set-Cookie` lines (Max-Age=0 deletes). */
function jar(lines: readonly string[], prior = ""): string {
  const values = new Map<string, string>();
  for (const part of prior.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) values.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  for (const line of lines) {
    const [pair = ""] = line.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at);
    if (/Max-Age=0(?:;|$)/.test(line)) values.delete(name);
    else values.set(name, pair.slice(at + 1));
  }
  return [...values].map(([k, v]) => `${k}=${v}`).join("; ");
}

const marker = async (now = NOW) =>
  (await guestMarkerCookie(TOKEN, now)).split(";")[0]!;

/**
 * Yandex's published robot User-Agents (yandex.ru/support/webmaster →
 * «Проверить, что робот принадлежит Яндексу»), as `<token>/<version>` or a
 * bare token; YandexMobileBot / YandexScreenshotBot carry a browser prefix.
 */
const YANDEX_ROBOTS = [
  "YandexAccessibilityBot/3.0",
  "YandexAdNet/1.0",
  "YandexBlogs/0.99; robot",
  "YandexBot/3.0",
  "YandexBot/3.0; MirrorDetector",
  "YandexCalendar/1.0",
  "YandexCheckBot/3.0",
  "YandexDialogs/1.0",
  "YandexDirect/3.0",
  "YandexDirectDyn/1.0",
  "YandexFavicons/1.0",
  "YandexFeed/1.0",
  "YaDirectFetcher/1.0; Dyatel",
  "YandexImages/3.0",
  "YandexImageResizer/2.0",
  "YandexMarket/1.0",
  "YandexMarket/2.0",
  "YandexMedia/3.0",
  "YandexMetrika/2.0",
  "YandexMetrika/3.0",
  "YandexMetrika/4.0",
  "YandexMobileScreenShotBot/1.0",
  "YandexOntoDB/1.0",
  "YandexOntoDBAPI/1.0",
  "YandexPagechecker/1.0",
  "YandexPartner/3.0",
  "YandexRCA/1.0",
  "YandexRenderResourcesBot/1.0",
  "YandexSearchShop/1.0",
  "YandexSitelinks; Dyatel",
  "YandexSpravBot/1.0",
  "YandexTracker/1.0",
  "YandexUserproxy; robot",
  "YandexVertis/3.0",
  "YandexVerticals/1.0",
  "YandexVideo/3.0",
  "YandexVideoParser/1.0",
  "YandexWebmaster/2.0",
  "YandexAdditionalBot/1.0",
  "YandexAdditional/1.0",
].map((token): [string, string] => [
  token,
  `Mozilla/5.0 (compatible; ${token}; +http://yandex.com/bots)`,
]);
YANDEX_ROBOTS.push(
  [
    "YandexMetrika/2.0 (yabs01)",
    "Mozilla/5.0 (compatible; YandexMetrika/2.0; +http://yandex.com/bots yabs01)",
  ],
  [
    "YandexMobileBot/3.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 8_1 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Version/8.0 Mobile/12B411 Safari/600.1.4 (compatible; YandexMobileBot/3.0; +http://yandex.com/bots)",
  ],
  [
    "YandexScreenshotBot/3.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; YandexScreenshotBot/3.0; +http://yandex.com/bots)",
  ],
  [
    "YandexComBot/3.0",
    "Mozilla/5.0 (compatible; YandexComBot/3.0; +http://ya.cc/bots)",
  ],
  [
    "YaComBot/3.0",
    "Mozilla/5.0 (compatible; YaComBot/3.0; +http://ya.cc/bots)",
  ],
);

describe("003 EARS-63: the silent check starts only on a checkable request", () => {
  it("EARS-63: a signed-out top-level document GET is answered, before any render, with a 303 into a silent transaction carrying its path and query", async () => {
    const api = fakeApi();
    const res = redirected(
      await check(nav("/webinars/live-1?utm=mail&ds_x=2"), api),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(AUTHORIZE);
    // EARS-63 (g) — the check redirect is never cached.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(api.starts().map((c) => c.body)).toEqual([
      { client: "academy", returnPath: "/webinars/live-1?utm=mail&ds_x=2" },
    ]);
    const tx = res.headers.getSetCookie();
    expect(tx).toEqual([
      `${OIDC_TX_COOKIE}=${await silentTransactionCookieValue(TOKEN, SILENT_TX_ID)}; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax`,
    ]);
  });

  it("EARS-63: both storefronts run the one core with their own client", async () => {
    const api = fakeApi();
    redirected(await check(nav("/events"), api, DOCTOR));
    expect(api.starts()[0]?.body).toEqual({
      client: "doctor",
      returnPath: "/events",
    });
  });

  it("EARS-63: a live storefront session renders signed in with no check", async () => {
    const api = fakeApi({ signedIn: true });
    expect(
      rendered(await check(nav("/", { cookie: "__Host-ds_session=sid" }), api)),
    ).toEqual([]);
    expect(api.starts()).toEqual([]);
  });

  it.each([
    [
      "a crawler User-Agent (Yandex)",
      nav("/", { "user-agent": "Mozilla/5.0 (compatible; YandexBot/3.0)" }),
    ],
    [
      "a crawler User-Agent (Google)",
      nav("/", { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }),
    ],
    [
      "a crawler User-Agent (Bing)",
      nav("/", { "user-agent": "Mozilla/5.0 (compatible; bingbot/2.0)" }),
    ],
    [
      "a request without fetch metadata",
      new Request("https://academy.example/", { headers: BROWSER }),
    ],
    ["a non-GET", nav("/", {}, { method: "POST", body: "x" })],
    ["a HEAD", nav("/", {}, { method: "HEAD" })],
    ["a prefetch (Sec-Purpose)", nav("/", { "sec-purpose": "prefetch" })],
    ["a prefetch (Purpose)", nav("/", { purpose: "prefetch" })],
    ["a Next.js router request (RSC)", nav("/", { rsc: "1" })],
    ["a Next.js router prefetch", nav("/", { "next-router-prefetch": "1" })],
    ["a frame", nav("/", { "sec-fetch-dest": "iframe" })],
    ["/v1/*", nav("/v1/auth/session")],
    ["a static asset (/_next)", nav("/_next/static/chunks/main.js")],
    ["a file with an extension", nav("/media/poster.png")],
    ["favicon.ico", nav("/favicon.ico")],
    ["robots.txt", nav("/robots.txt")],
    ["a sitemap", nav("/sitemap.xml")],
    ["/.well-known/*", nav("/.well-known/apple-app-site-association")],
    ["the sign-in entry", nav("/login")],
    ["the registration entry", nav("/register")],
    ["the reset entry", nav("/reset")],
    ["the verify step", nav("/verify")],
    ["the callback", nav("/auth/callback?code=c&state=s")],
    ["the health route", nav("/healthz")],
    [
      "a YandexBot crawler",
      nav("/", {
        "user-agent":
          "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
      }),
    ],
    [
      "a YandexMobileBot crawler",
      nav("/", {
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Mobile/15E148 Safari/604.1 (compatible; YandexMobileBot/3.0; +http://yandex.com/bots)",
      }),
    ],
    ["the one-shot ds_guest=1 return", nav("/webinars?ds_guest=1")],
  ])("EARS-63: (req. 12) %s is never redirected", async (_name, request) => {
    const api = fakeApi();
    expect(rendered(await check(request, api))).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it.each(YANDEX_ROBOTS)(
    "EARS-63: (e) the Yandex robot %s is a crawler — never redirected",
    async (_name, userAgent) => {
      const api = fakeApi();
      expect(
        rendered(await check(nav("/", { "user-agent": userAgent }), api)),
      ).toEqual([]);
      expect(api.calls).toEqual([]);
    },
  );

  it.each([
    [
      "the Yandex app (Android)",
      "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 YandexSearch/24.10.1 YaApp_Android/24.101 YaSearchBrowser/24.101 BroPP/1.0 SA/3 Mobile Safari/537.36",
    ],
    [
      "Yandex Browser (desktop)",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.4.0.0 Yowser/2.5 Safari/537.36",
    ],
    [
      "Yandex Browser (iPhone)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 YaBrowser/24.4.5.473.10 SA/3 Mobile/15E148 Safari/604.1",
    ],
  ])(
    "EARS-63: (e) %s is a person, not a crawler — its signed-out navigation is checked",
    async (_name, userAgent) => {
      const api = fakeApi();
      expect(
        redirected(await check(nav("/", { "user-agent": userAgent }), api))
          .status,
      ).toBe(303);
      expect(api.starts()).toHaveLength(1);
    },
  );

  it("EARS-63: (req. 1) the check's return path is held to requirement 1 — a look-alike path lands on /, an overlong one on its path", async () => {
    const api = fakeApi();
    redirected(await check(nav("//evil.example/x"), api));
    redirected(await check(nav(`/webinars?q=${"a".repeat(3000)}`), api));
    expect(api.starts().map((c) => c.body?.returnPath)).toEqual([
      "/",
      "/webinars",
    ]);
  });

  it("EARS-63: (f / req. 9) a limited silent-check start renders the guest page itself (no redirect, no cookie)", async () => {
    const api = fakeApi({ silentCheck: 429 });
    expect(rendered(await check(nav("/webinars"), api))).toEqual([]);
    expect(api.starts()).toHaveLength(1);
  });

  it("EARS-63: without the internal credential no check starts", async () => {
    const api = fakeApi();
    const outcome = await storefrontSilentCheck(nav("/"), ACADEMY, {
      fetchImpl: api.fetchImpl,
      env: {},
      now: () => NOW,
    });
    expect(rendered(outcome)).toEqual([]);
    expect(api.calls).toEqual([]);
  });
});

describe("003 EARS-63 (a): the guest marker", () => {
  it("EARS-63: a valid marker suppresses the check", async () => {
    const api = fakeApi();
    const cookie = await marker(NOW - 9 * 60 * 1000);
    expect(rendered(await check(nav("/", { cookie }), api))).toEqual([]);
    expect(api.calls).toEqual([]);
  });

  it("EARS-63: (req. 12) a marker with a bad HMAC, or issued more than 10 minutes ago, is ignored", async () => {
    const api = fakeApi();
    const issued = Math.floor(NOW / 1000);
    const forged = `${GUEST_MARKER_COOKIE}=${issued}.${"A".repeat(43)}`;
    const planted = `${GUEST_MARKER_COOKIE}=${issued + 10 ** 6}.x`;
    const stale = await marker(NOW - 11 * 60 * 1000);
    for (const cookie of [forged, planted, stale]) {
      redirected(await check(nav("/", { cookie }), api));
    }
    expect(api.starts()).toHaveLength(3);
  });
});

describe("003 EARS-63 (b) / (c): the loop guard and the transaction in flight", () => {
  it("EARS-63: the first document request carrying the guard deletes it; signed in it renders signed in", async () => {
    const api = fakeApi({ signedIn: true });
    const set = rendered(
      await check(
        nav("/", { cookie: `${CHECK_GUARD_COOKIE}=1; __Host-ds_session=sid` }),
        api,
      ),
    );
    expect(set).toEqual([
      `${CHECK_GUARD_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    ]);
    expect(api.starts()).toEqual([]);
  });

  it("EARS-63: (req. 12) a minted session refused on the next request (fingerprint mismatch) renders the guest page with the marker and no second redirect", async () => {
    const api = fakeApi({ signedIn: false });
    const set = rendered(
      await check(
        nav("/", { cookie: `${CHECK_GUARD_COOKIE}=1; __Host-ds_session=sid` }),
        api,
      ),
    );
    expect(set[0]).toMatch(new RegExp(`^${CHECK_GUARD_COOKIE}=; .*Max-Age=0`));
    expect(set[1]).toBe(await guestMarkerCookie(TOKEN, NOW));
    expect(api.starts()).toEqual([]);
  });

  it("EARS-63: a live silent transaction holds the check back; a planted one does not", async () => {
    const api = fakeApi();
    const live = `${OIDC_TX_COOKIE}=${await silentTransactionCookieValue(TOKEN, SILENT_TX_ID)}`;
    expect(rendered(await check(nav("/", { cookie: live }), api))).toEqual([]);
    expect(api.starts()).toEqual([]);
    const planted = `${OIDC_TX_COOKIE}=${SILENT_TX_ID}.${"A".repeat(43)}`;
    redirected(await check(nav("/", { cookie: planted }), api));
    expect(api.starts()).toHaveLength(1);
  });

  it("EARS-63: (c) a live interactive transaction never holds the check back — the silent one replaces it", async () => {
    const api = fakeApi();
    const res = redirected(
      await check(
        nav("/webinars", { cookie: `${OIDC_TX_COOKIE}=${INTERACTIVE_TX_ID}` }),
        api,
      ),
    );
    expect(api.starts()[0]?.body).toEqual({
      client: "academy",
      returnPath: "/webinars",
      replaces: INTERACTIVE_TX_ID,
    });
    expect(res.headers.getSetCookie()[0]).toMatch(
      new RegExp(`^${OIDC_TX_COOKIE}=${SILENT_TX_ID}\\.`),
    );
  });
});

describe("003 EARS-62 / 63: the silent outcomes of the callback", () => {
  const silentTx = async () =>
    `${OIDC_TX_COOKIE}=${await silentTransactionCookieValue(TOKEN, SILENT_TX_ID)}`;
  const minted = (kind: "silent" | "interactive") => () =>
    new Response(
      JSON.stringify({
        sub: "u1",
        roles: ["doctor_guest"],
        mfa: false,
        returnPath: "/webinars?utm=mail",
        door: "login",
        kind,
        completeRegistration: null,
      }),
      {
        status: 200,
        headers: {
          "set-cookie":
            "__Host-ds_session=fresh-sid; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
        },
      },
    );
  const loginRequired = () =>
    Response.json(
      {
        message: "redeem refused",
        returnPath: "/webinars?utm=mail",
        door: "login",
        kind: "silent",
      },
      { status: 401 },
    );
  const callback = (
    path: string,
    cookie: string | undefined,
    api: ReturnType<typeof fakeApi>,
  ) =>
    storefrontCallback(nav(path, cookie ? { cookie } : {}), ACADEMY, {
      fetchImpl: api.fetchImpl,
      env: ENV,
      now: () => NOW,
    });

  it("EARS-63: a silent callback that mints sets the guard, deletes the marker and lands on the return path", async () => {
    const api = fakeApi({ redeem: minted("silent") });
    const res = await callback(
      "/auth/callback?code=c&state=st",
      `${await silentTx()}; ${await marker()}`,
      api,
    );
    expect(res.headers.get("location")).toBe("/webinars?utm=mail#");
    const set = res.headers.getSetCookie();
    expect(set).toContain(
      `${GUEST_MARKER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(set).toContain(
      `${CHECK_GUARD_COOKIE}=1; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(api.calls[0]?.body).toMatchObject({ txId: SILENT_TX_ID });
  });

  it("EARS-63: (a) an interactive callback that mints deletes the marker and sets no guard", async () => {
    const api = fakeApi({ redeem: minted("interactive") });
    const res = await callback(
      "/auth/callback?code=c&state=st",
      `${OIDC_TX_COOKIE}=${INTERACTIVE_TX_ID}`,
      api,
    );
    const set = res.headers.getSetCookie();
    expect(set.some((c) => c.startsWith(`${GUEST_MARKER_COOKIE}=;`))).toBe(
      true,
    );
    expect(set.some((c) => c.startsWith(`${CHECK_GUARD_COOKIE}=`))).toBe(false);
  });

  it("EARS-63: login_required of a silent transaction sets the marker and the guard and lands on the return path as a guest", async () => {
    const api = fakeApi({ redeem: loginRequired });
    const res = await callback(
      "/auth/callback?error=login_required&state=st",
      await silentTx(),
      api,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/webinars?utm=mail#");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const set = res.headers.getSetCookie();
    expect(set).toContain(await guestMarkerCookie(TOKEN, NOW));
    expect(set).toContain(
      `${CHECK_GUARD_COOKIE}=1; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(set.join()).not.toContain("__Host-ds_session");
  });

  it("EARS-63: (req. 9) a limited silent callback (429) still ends as a guest with the marker", async () => {
    const api = fakeApi({ redeem: () => new Response(null, { status: 429 }) });
    const res = await callback(
      "/auth/callback?code=c&state=st",
      await silentTx(),
      api,
    );
    expect(res.status).toBe(303);
    expect(res.headers.getSetCookie()).toContain(
      await guestMarkerCookie(TOKEN, NOW),
    );
  });

  it("EARS-63: (b / req. 12) a client that keeps no cookies makes one round trip and lands on ds_guest=1, never a second check", async () => {
    const api = fakeApi({ redeem: loginRequired });
    // The check: no cookie of any kind.
    redirected(await check(nav("/webinars?utm=mail"), api));
    // The callback arrives without `__Host-ds_oidc_tx`.
    const res = await callback(
      "/auth/callback?error=login_required&state=st",
      undefined,
      api,
    );
    expect(res.headers.get("location")).toBe("/webinars?utm=mail&ds_guest=1#");
    expect(api.calls.find((c) => c.url.endsWith("/redeem"))?.body).toEqual({
      client: "academy",
      state: "st",
    });
    // The landing carries the flag: no second check.
    expect(
      rendered(await check(nav("/webinars?utm=mail&ds_guest=1"), api)),
    ).toEqual([]);
    expect(api.starts()).toHaveLength(1);
  });
  it("EARS-63: (b / req. 1) a cookieless silent callback whose kept return path is hostile lands on a same-origin path with ds_guest=1", async () => {
    for (const hostile of [
      "/..//evil.example",
      "/\\evil.example",
      "/%2F%2Fevil.example",
      "/%2e%2e//evil.example",
    ]) {
      const api = fakeApi({
        redeem: () =>
          Response.json(
            {
              message: "redeem refused",
              returnPath: hostile,
              door: "login",
              kind: "silent",
            },
            { status: 401 },
          ),
      });
      const res = await callback(
        "/auth/callback?error=login_required&state=st",
        undefined,
        api,
      );
      const location = res.headers.get("location") ?? "";
      expect(location, hostile).toMatch(/^\/(?![/\\])/);
      const landed = new URL(location, "https://academy.example");
      expect(landed.origin, hostile).toBe("https://academy.example");
      expect(landed.pathname.startsWith("//"), hostile).toBe(false);
      expect(landed.searchParams.get("ds_guest"), hostile).toBe("1");
    }
  });

  it.each([
    ["its own redeem limit (429)", () => new Response(null, { status: 429 })],
    ["an API failure (5xx)", () => new Response(null, { status: 503 })],
    [
      "a network failure",
      (): Response => {
        throw new TypeError("fetch failed");
      },
    ],
    [
      "a 200 with no session cookie",
      () => Response.json({ sub: "u1" }, { status: 200 }),
    ],
    [
      "a 200 with an unparsable body",
      () =>
        new Response("not json", {
          status: 200,
          headers: { "set-cookie": "__Host-ds_session=x; Path=/" },
        }),
    ],
  ])(
    "EARS-63: (b / req. 9, 12) a callback without its transaction cookie whose redeem fails on %s lands on a ds_guest=1 path, never a checkable page",
    async (_name, redeem) => {
      const api = fakeApi({ redeem });
      const res = await callback(
        "/auth/callback?error=login_required&state=st",
        undefined,
        api,
      );
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      const landed = new URL(location, "https://academy.example");
      expect(landed.origin).toBe("https://academy.example");
      expect(landed.searchParams.get("ds_guest")).toBe("1");
      // The landing is never checked: one round trip, no loop.
      expect(
        rendered(await check(nav(`${landed.pathname}${landed.search}`), api)),
      ).toEqual([]);
      expect(api.starts()).toHaveLength(0);
    },
  );

  it.each([
    [
      "a 200 with no session cookie",
      () => Response.json({ sub: "u1" }, { status: 200 }),
    ],
    [
      "a 200 with an unparsable body",
      () =>
        new Response("not json", {
          status: 200,
          headers: { "set-cookie": "__Host-ds_session=x; Path=/" },
        }),
    ],
  ])(
    "EARS-63: (b) a silent callback whose mint is malformed (%s) ends as a guest with the marker and the guard",
    async (_name, redeem) => {
      const api = fakeApi({ redeem });
      const res = await callback(
        "/auth/callback?code=c&state=st",
        await silentTx(),
        api,
      );
      expect(res.status).toBe(303);
      const set = res.headers.getSetCookie();
      expect(set).toContain(await guestMarkerCookie(TOKEN, NOW));
      expect(set).toContain(checkGuardCookie());
    },
  );
});

describe("003 EARS-63 / ADR-0015 §4 req. 12: whole navigations", () => {
  it("EARS-63: (req. 12) with a live shared session, a signed-out navigation gets a redirect as its first response and ends on the signed-in page", async () => {
    const api = fakeApi({
      redeem: () =>
        new Response(
          JSON.stringify({
            sub: "u1",
            roles: ["doctor_guest"],
            mfa: false,
            returnPath: "/webinars/live-1",
            door: "login",
            kind: "silent",
            completeRegistration: null,
          }),
          {
            status: 200,
            headers: {
              "set-cookie":
                "__Host-ds_session=fresh-sid; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
            },
          },
        ),
    });
    const first = redirected(await check(nav("/webinars/live-1"), api));
    expect(first.status).toBe(303);
    let cookies = jar(first.headers.getSetCookie());
    const cb = await storefrontCallback(
      nav("/auth/callback?code=c&state=st", { cookie: cookies }),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV, now: () => NOW },
    );
    expect(cb.headers.get("location")).toBe("/webinars/live-1#");
    cookies = jar(cb.headers.getSetCookie(), cookies);
    expect(cookies).toContain("__Host-ds_session=fresh-sid");
    expect(cookies).not.toContain(OIDC_TX_COOKIE);
    const signedIn = fakeApi({ signedIn: true });
    const landing = rendered(
      await check(nav("/webinars/live-1", { cookie: cookies }), signedIn),
    );
    expect(jar(landing, cookies)).not.toContain(CHECK_GUARD_COOKIE);
    expect(signedIn.starts()).toEqual([]);
  });

  it("EARS-63: (req. 12) with no shared session it ends on the guest page with the marker set, and the next navigation starts no check", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          {
            message: "redeem refused",
            returnPath: "/webinars",
            door: "login",
            kind: "silent",
          },
          { status: 401 },
        ),
    });
    let cookies = jar(
      redirected(await check(nav("/webinars"), api)).headers.getSetCookie(),
    );
    const cb = await storefrontCallback(
      nav("/auth/callback?error=login_required&state=st", { cookie: cookies }),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV, now: () => NOW },
    );
    expect(cb.headers.get("location")).toBe("/webinars#");
    cookies = jar(cb.headers.getSetCookie(), cookies);
    expect(cookies).toContain(`${GUEST_MARKER_COOKIE}=`);
    // The landing: the guard is spent, the page renders as a guest.
    cookies = jar(
      rendered(await check(nav("/webinars", { cookie: cookies }), api)),
      cookies,
    );
    expect(cookies).not.toContain(CHECK_GUARD_COOKIE);
    // The next navigation: the marker holds the check back.
    expect(
      rendered(await check(nav("/events", { cookie: cookies }), api)),
    ).toEqual([]);
    expect(api.starts()).toHaveLength(1);
  });
});
