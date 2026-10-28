import { toStorefrontReturnPath } from "@ds/schemas";
import { describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import {
  OIDC_TX_COOKIE,
  storefrontCallback,
  storefrontEntry,
  type StorefrontOidcHost,
} from "./storefront-oidc";

/**
 * 003 EARS-61 / 62 / 71 (storefront halves), ADR-0015 §4 req. 1, 3, 5, 6, 9 —
 * the storefront entry and callback, driven against a fake of the API's
 * internal and public reads (the API halves: `apps/api/test/auth/storefront-oidc.e2e-spec.ts`).
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
const TX_ID = "T".repeat(43);
const AUTHORIZE = "https://id.example/oauth/v2/authorize?client_id=c&state=s";
const BROWSER = {
  "user-agent": "Browser/1.0",
  "accept-language": "ru-RU",
  "x-forwarded-for": "203.0.113.5",
};
const HANDOFF = "H".repeat(43);
const SILENT_TX_ID = "S".repeat(43);
const SILENT_AUTHORIZE =
  "https://id.example/oauth/v2/authorize?client_id=c&state=silent&prompt=none";

interface Call {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
}

/** The API as the storefront server sees it: session read, internal routes, public event read. */
function fakeApi(
  opts: {
    signedIn?: boolean;
    ownHandoff?: boolean;
    redeem?: () => Response;
    event?: number;
    /** 003 EARS-63 — the silent-check start's status (200 by default; 429 = limited). */
    silentCheck?: number;
    /** 005 EARS-2 — the `RegisterForEvent` answer; `"throw"` = a network failure. */
    registration?: number | "throw";
  } = {},
) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    calls.push({ url, init, body });
    if (url.endsWith("/v1/auth/session")) {
      return opts.signedIn
        ? Response.json({ sub: "u1", roles: ["doctor_guest"], mfa: false })
        : new Response(null, { status: 401 });
    }
    if (url.includes("/handoff/own")) {
      return Response.json({ own: opts.ownHandoff ?? false });
    }
    if (url === "http://api:3000/v1/internal/oidc/silent-check") {
      return opts.silentCheck && opts.silentCheck !== 200
        ? new Response(null, { status: opts.silentCheck })
        : Response.json({ txId: SILENT_TX_ID, authorizeUrl: SILENT_AUTHORIZE });
    }
    if (url === "http://api:3000/v1/internal/oidc/transaction") {
      return Response.json({ txId: TX_ID, authorizeUrl: AUTHORIZE });
    }
    if (url === "http://api:3000/v1/internal/oidc/redeem") {
      return opts.redeem
        ? opts.redeem()
        : new Response(
            JSON.stringify({
              sub: "u1",
              roles: ["doctor_guest"],
              mfa: false,
              returnPath: "/webinars/live-1",
              door: "login",
              kind: "interactive",
              completeRegistration: null,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "set-cookie":
                  "__Host-ds_session=fresh-sid; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
              },
            },
          );
    }
    if (url.endsWith("/registration")) {
      if (opts.registration === "throw") throw new TypeError("fetch failed");
      return new Response(null, { status: opts.registration ?? 200 });
    }
    if (url.includes("/v1/public/events/")) {
      return opts.event === 404
        ? new Response(null, { status: 404 })
        : new Response(null, { status: opts.event ?? 503 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const internal = (path: string) =>
    calls.filter((c) => c.url === `http://api:3000/v1/internal/oidc/${path}`);
  return { fetchImpl, calls, internal };
}

/** A top-level document navigation, as a browser opens an entry (003 EARS-61). */
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://academy.example${path}`, {
    headers: { ...BROWSER, ...NAVIGATE, ...headers },
  });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

describe("storefront entry", () => {
  const ENTRIES = ["login", "register", "reset", "verify"] as const;
  const NOT_NAVIGATIONS: Array<[string, Record<string, string>, string?]> = [
    [
      "a Next router prefetch",
      {
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        rsc: "1",
        "next-router-prefetch": "1",
      },
    ],
    [
      "a Sec-Purpose prefetch",
      {
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "empty",
        "sec-purpose": "prefetch",
      },
    ],
    [
      "a client-router fetch",
      { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", rsc: "1" },
    ],
    ["a request without fetch metadata", {}],
    ["a frame", { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" }],
    ["a HEAD", { ...NAVIGATE }, "HEAD"],
  ];

  for (const entry of ENTRIES) {
    for (const [kind, headers, method] of NOT_NAVIGATIONS) {
      it(`003 EARS-61: ${kind} of /${entry} mints no transaction, sets no cookie, calls no API and answers 204 no-store`, async () => {
        const api = fakeApi({ signedIn: true });
        const res = await storefrontEntry(
          new Request(`https://academy.example/${entry}?returnTo=%2Fwebinars`, {
            method: method ?? "GET",
            headers: { ...BROWSER, ...headers },
          }),
          ACADEMY,
          entry,
          { fetchImpl: api.fetchImpl, env: ENV },
        );
        expect(res.status).toBe(204);
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("location")).toBeNull();
        expect(setCookies(res)).toEqual([]);
        expect(api.calls).toEqual([]);
      });
    }

    it(`003 EARS-61: a top-level document navigation of /${entry} still mints a transaction and answers 303 to the authorize URL`, async () => {
      const api = fakeApi();
      const res = await storefrontEntry(get(`/${entry}`), ACADEMY, entry, {
        fetchImpl: api.fetchImpl,
        env: ENV,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(AUTHORIZE);
      expect(setCookies(res)[0]).toMatch(new RegExp(`^${OIDC_TX_COOKIE}=`));
      expect(api.internal("transaction")).toHaveLength(1);
    });
  }

  it("003 EARS-61: /login creates an interactive transaction through the internal API, keeps only its id in a host-only cookie, and answers 303 to the authorize URL", async () => {
    const api = fakeApi();
    const res = await storefrontEntry(get("/login"), ACADEMY, "login", {
      fetchImpl: api.fetchImpl,
      env: ENV,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(AUTHORIZE);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [cookie] = setCookies(res);
    expect(cookie).toBe(
      `${OIDC_TX_COOKIE}=${TX_ID}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(cookie).not.toMatch(/Domain=/i);
    const [call] = api.internal("transaction");
    expect(call?.body).toEqual({
      client: "academy",
      kind: "interactive",
      door: "login",
    });
    expect(call?.init?.method).toBe("POST");
    // The internal credential and the browser's surface, as the BFF forwards it.
    expect(call?.init?.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      ...BROWSER,
    });
    // Nothing of the PKCE pair or the nonce is held by the storefront.
    expect(JSON.stringify(call?.body)).not.toMatch(/verifier|nonce|state/);
  });

  it("003 EARS-61 (req. 1): the return path is same-origin relative only — //evil.example, https://evil.example and /\\evil.example never reach the transaction", async () => {
    for (const hostile of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
    ]) {
      const api = fakeApi();
      await storefrontEntry(
        get(`/login?returnTo=${encodeURIComponent(hostile)}`),
        ACADEMY,
        "login",
        { fetchImpl: api.fetchImpl, env: ENV },
      );
      expect(api.internal("transaction")[0]?.body).not.toHaveProperty(
        "returnPath",
      );
    }
  });

  it("003 EARS-61 (req. 1): a return path is cut to its path past 2048 characters and is / when the path alone is longer, and an unsafe one is /", () => {
    expect(toStorefrontReturnPath("//evil.example")).toBe("/");
    expect(toStorefrontReturnPath("https://evil.example")).toBe("/");
    expect(toStorefrontReturnPath("/\\evil.example")).toBe("/");
    expect(toStorefrontReturnPath("/a\u0000b")).toBe("/");
    expect(toStorefrontReturnPath("/events/x?mode=online#frag")).toBe(
      "/events/x?mode=online",
    );
    expect(toStorefrontReturnPath(`/events/x?q=${"a".repeat(2100)}`)).toBe(
      "/events/x",
    );
    expect(toStorefrontReturnPath(`/${"a".repeat(2100)}`)).toBe("/");
  });

  it("003 EARS-61 (req. 1): S1615 an entry whose return target's query passes 2048 characters stores the target cut to its path; a path alone longer stores none", async () => {
    for (const [host, stored] of [
      [ACADEMY, "/webinars/live-1"],
      [DOCTOR, "/events/live-1"],
    ] as const) {
      const long = fakeApi();
      await storefrontEntry(
        get(
          `/login?returnTo=${encodeURIComponent(`/webinars/live-1?x=${"a".repeat(2100)}`)}`,
        ),
        host,
        "login",
        { fetchImpl: long.fetchImpl, env: ENV },
      );
      expect(long.internal("transaction")[0]?.body).toMatchObject({
        returnPath: stored,
      });

      const longPath = fakeApi();
      await storefrontEntry(
        get(`/login?returnTo=${encodeURIComponent(`/${"a".repeat(2100)}`)}`),
        host,
        "login",
        { fetchImpl: longPath.fetchImpl, env: ENV },
      );
      expect(longPath.internal("transaction")[0]?.body).not.toHaveProperty(
        "returnPath",
      );
    }
  });

  it("003 EARS-71 / EARS-43: /login?method=code records the code-method intent; a plain /login records none", async () => {
    const plain = fakeApi();
    await storefrontEntry(get("/login"), ACADEMY, "login", {
      fetchImpl: plain.fetchImpl,
      env: ENV,
    });
    expect(plain.internal("transaction")[0]?.body).not.toHaveProperty("intent");

    const code = fakeApi();
    await storefrontEntry(get("/login?method=code"), ACADEMY, "login", {
      fetchImpl: code.fetchImpl,
      env: ENV,
    });
    expect(code.internal("transaction")[0]?.body).toMatchObject({
      door: "login",
      intent: { method: "code" },
    });
  });

  it("003 EARS-44 / 044 EARS-40: the doctor storefront's hand-off entry redirects to the sign-in host with the reference only in the server-held intent, with Referrer-Policy: no-referrer", async () => {
    const api = fakeApi();
    const res = await storefrontEntry(
      get(`/login?method=code&handoff=${HANDOFF}`),
      DOCTOR,
      "login",
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("location")).not.toContain(HANDOFF);
    expect(api.internal("transaction")[0]?.body).toMatchObject({
      client: "doctor",
      intent: { method: "code", handoff: HANDOFF },
    });
  });

  it("003 EARS-71 / EARS-24 / 021 EARS-2: /register with an event return target records the event slug and stores the host's event path", async () => {
    const api = fakeApi();
    await storefrontEntry(
      get("/register?returnTo=%2Fwebinars%2Flive-1"),
      DOCTOR,
      "register",
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(api.internal("transaction")[0]?.body).toEqual({
      client: "doctor",
      kind: "interactive",
      door: "register",
      returnPath: "/events/live-1",
      intent: { eventTarget: "live-1" },
      completeRegistration: "live-1",
    });
  });

  it("005 EARS-2: an event return target carries its registration into the transaction on every door; a land-only, room or account return carries none", async () => {
    const carried = async (path: string, entry: "login" | "reset") => {
      const api = fakeApi();
      await storefrontEntry(get(path), ACADEMY, entry, {
        fetchImpl: api.fetchImpl,
        env: ENV,
      });
      return api.internal("transaction")[0]?.body?.completeRegistration;
    };
    expect(await carried("/login?returnTo=%2Fwebinars%2Flive-1", "login")).toBe(
      "live-1",
    );
    expect(await carried("/reset?returnTo=%2Fwebinars%2Flive-1", "reset")).toBe(
      "live-1",
    );
    for (const returnTo of [
      "/webinars/live-1?intent=land",
      "/webinars/live-1/room",
      "/account",
      "/webinars",
    ]) {
      expect(
        await carried(
          `/login?returnTo=${encodeURIComponent(returnTo)}`,
          "login",
        ),
        returnTo,
      ).toBeUndefined();
    }
  });

  it("003 EARS-12: a reset entry that carries no return target returns to this storefront's account page; a carried one stands", async () => {
    const entered = async (path: string) => {
      const api = fakeApi();
      await storefrontEntry(get(path), ACADEMY, "reset", {
        fetchImpl: api.fetchImpl,
        env: ENV,
      });
      return api.internal("transaction")[0]?.body?.returnPath;
    };
    expect(await entered("/reset")).toBe(ACADEMY.config.routes.account);
    expect(await entered("/reset?returnTo=%2Fwebinars%2Flive-1")).toBe(
      "/webinars/live-1",
    );
  });

  it("003 EARS-12 / EARS-71: /reset records the reset door's intent; /verify opens the registration door", async () => {
    const reset = fakeApi();
    await storefrontEntry(get("/reset"), ACADEMY, "reset", {
      fetchImpl: reset.fetchImpl,
      env: ENV,
    });
    expect(reset.internal("transaction")[0]?.body).toMatchObject({
      door: "reset",
      intent: {},
    });
    const verify = fakeApi();
    await storefrontEntry(get("/verify"), ACADEMY, "verify", {
      fetchImpl: verify.fetchImpl,
      env: ENV,
    });
    expect(verify.internal("transaction")[0]?.body).toMatchObject({
      door: "register",
    });
  });

  it("003 EARS-71: a /reset entry from an event records the event target with the reset door, as /login and /register do", async () => {
    const api = fakeApi();
    await storefrontEntry(
      get("/reset?returnTo=%2Fwebinars%2Flive-1"),
      ACADEMY,
      "reset",
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(api.internal("transaction")[0]?.body).toMatchObject({
      door: "reset",
      intent: { eventTarget: "live-1" },
    });
  });

  it("003 EARS-61: the storefront /verify is the registration entry and carries no address", async () => {
    const api = fakeApi();
    const res = await storefrontEntry(
      get("/verify?email=doctor%40clinic.ru"),
      ACADEMY,
      "verify",
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    const sent = api.internal("transaction")[0]?.body;
    expect(sent).toMatchObject({ door: "register" });
    expect(JSON.stringify(sent)).not.toContain("clinic.ru");
    expect(res.headers.get("location") ?? "").not.toContain("clinic.ru");
  });

  it("003 EARS-43 / EARS-44: a signed-in browser keeps the existing redirect to its landing and starts no transaction", async () => {
    const signedIn = { cookie: "__Host-ds_session=live-sid" };
    const api = fakeApi({ signedIn: true });
    const res = await storefrontEntry(
      get("/login?returnTo=%2Faccount", signedIn),
      ACADEMY,
      "login",
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account");
    expect(api.internal("transaction")).toHaveLength(0);
    // The baseline own-account hand-off: its own link is no exception.
    const own = fakeApi({ signedIn: true, ownHandoff: true });
    const ownRes = await storefrontEntry(
      get(`/login?method=code&handoff=${HANDOFF}`, signedIn),
      ACADEMY,
      "login",
      { fetchImpl: own.fetchImpl, env: ENV },
    );
    expect(ownRes.headers.get("location")).toBe("/webinars");
    expect(own.internal("transaction")).toHaveLength(0);
  });

  it("003 EARS-10 (req. 6): after the storefront sign-out the next «Войти» starts a NEW interactive transaction, never a silent finalisation", async () => {
    // The sign-out removed the session server-side: the session read is a guest.
    const api = fakeApi({ signedIn: false });
    const res = await storefrontEntry(
      get("/login", { cookie: "__Host-ds_session=revoked-sid" }),
      ACADEMY,
      "login",
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(api.internal("transaction")[0]?.body).toMatchObject({
      kind: "interactive",
    });
  });
});

describe("storefront callback", () => {
  const withTx = (path: string, cookie = `${OIDC_TX_COOKIE}=${TX_ID}`) =>
    get(path, { cookie });

  it("003 EARS-62: redeems {txId, state, code} through the internal API, relays the session cookie unchanged, clears the transaction cookie and answers 303 <path>#", async () => {
    const api = fakeApi();
    const res = await storefrontCallback(
      withTx("/auth/callback?code=c0de&state=st4te"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/webinars/live-1#");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(api.internal("redeem")[0]?.body).toEqual({
      client: "academy",
      txId: TX_ID,
      state: "st4te",
      code: "c0de",
    });
    const cookies = setCookies(res);
    expect(cookies).toContain(
      `${OIDC_TX_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(cookies).toContain(
      "__Host-ds_session=fresh-sid; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax",
    );
    expect(await res.text()).toBe("");
  });

  it("003 EARS-62 (req. 5): a session id the browser already presents is never reused — the callback sets the redeem's fresh one", async () => {
    const api = fakeApi();
    const res = await storefrontCallback(
      withTx(
        "/auth/callback?code=c&state=s",
        `__Host-ds_session=attacker-sid; ${OIDC_TX_COOKIE}=${TX_ID}`,
      ),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    const session = setCookies(res).filter((c) =>
      c.startsWith("__Host-ds_session="),
    );
    expect(session).toEqual([expect.stringContaining("fresh-sid")]);
    expect(session.join()).not.toContain("attacker-sid");
  });

  it("003 EARS-62 (req. 3): a callback without a transaction cookie still redeems its code by state before it answers, so the code is spent, and mints nothing", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          { message: "redeem refused", returnPath: null, door: null },
          { status: 401 },
        ),
    });
    const res = await storefrontCallback(
      get("/auth/callback?code=c&state=s"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    // No live transaction of its own: the EARS-62 recovery (a fresh silent
    // transaction with no return path), so a live shared session still signs in.
    expect(res.headers.get("location")).toBe(`${SILENT_AUTHORIZE}#`);
    expect(api.internal("redeem").map((c) => c.body)).toEqual([
      { client: "academy", state: "s", code: "c" },
    ]);
    expect(setCookies(res).join()).not.toContain("__Host-ds_session");
  });

  it("003 EARS-62 (req. 3): an unsolicited callback with neither a transaction cookie nor a state redeems nothing and mints nothing", async () => {
    const api = fakeApi();
    const res = await storefrontCallback(
      get("/auth/callback?code=c"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/webinars#");
    expect(api.internal("redeem")).toHaveLength(0);
    expect(setCookies(res).join()).not.toContain("__Host-ds_session");
  });

  it("003 EARS-62 (req. 3): a refused redeem (foreign state, spent or expired transaction) mints nothing and lands on the browser's own path", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          {
            message: "redeem refused",
            returnPath: "/webinars/x",
            door: "login",
          },
          { status: 401 },
        ),
    });
    const res = await storefrontCallback(
      withTx("/auth/callback?code=c&state=forged"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.headers.get("location")).toBe("/webinars/x#");
    expect(setCookies(res).join()).not.toContain("__Host-ds_session");
  });

  it("003 EARS-62 (req. 9): an exhausted callback limit answers 303 <path>#, never an error document", async () => {
    const api = fakeApi({
      redeem: () => new Response(null, { status: 429 }),
    });
    const res = await storefrontCallback(
      withTx("/auth/callback?code=c&state=s"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/webinars#");
  });

  it("003 EARS-62: an OIDC error answer (the person aborted) spends the transaction without a code and lands on its path", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          {
            message: "redeem refused",
            returnPath: "/webinars/y",
            door: "login",
          },
          { status: 401 },
        ),
    });
    const res = await storefrontCallback(
      withTx("/auth/callback?error=access_denied&state=s&code=ignored"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(api.internal("redeem")[0]?.body).not.toHaveProperty("code");
    expect(res.headers.get("location")).toBe("/webinars/y#");
  });

  it("003 EARS-62: a POST (form_post) callback is refused with the 303, its body unread", async () => {
    const api = fakeApi();
    const res = await storefrontCallback(
      new Request("https://academy.example/auth/callback", {
        method: "POST",
        headers: { cookie: `${OIDC_TX_COOKIE}=${TX_ID}` },
        body: "code=c&state=s",
      }),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/webinars#");
    expect(api.internal("redeem")).toHaveLength(0);
  });

  it("003 EARS-62 / 021 EARS-20: a completed registration lands on its event only while it exists; only not-found falls back to the landing", async () => {
    const registered = (event: number) =>
      fakeApi({
        event,
        redeem: () =>
          new Response(
            JSON.stringify({
              sub: "u1",
              roles: ["doctor_guest"],
              mfa: false,
              returnPath: "/webinars/gone-1",
              door: "register",
              kind: "interactive",
              completeRegistration: null,
            }),
            {
              status: 200,
              headers: { "set-cookie": "__Host-ds_session=s; Path=/" },
            },
          ),
      });
    const gone = await storefrontCallback(
      withTx("/auth/callback?code=c&state=s"),
      ACADEMY,
      { fetchImpl: registered(404).fetchImpl, env: ENV },
    );
    expect(gone.headers.get("location")).toBe("/webinars#");
    const unknown = await storefrontCallback(
      withTx("/auth/callback?code=c&state=s"),
      ACADEMY,
      { fetchImpl: registered(503).fetchImpl, env: ENV },
    );
    expect(unknown.headers.get("location")).toBe("/webinars/gone-1#");
  });

  it("003 EARS-62: every answer — minted, refused, limited, unsolicited, form_post — is 303 <path># with Cache-Control: no-store and clears the transaction cookie", async () => {
    const answers = [
      await storefrontCallback(
        withTx("/auth/callback?code=c&state=s"),
        ACADEMY,
        { fetchImpl: fakeApi().fetchImpl, env: ENV },
      ),
      await storefrontCallback(
        // With the guard: the EARS-62 recovery lands on `/` (without it, it
        // answers into a fresh silent transaction, pinned separately).
        withTx(
          "/auth/callback?code=c&state=s",
          `${OIDC_TX_COOKIE}=${TX_ID}; __Host-ds_check=1`,
        ),
        ACADEMY,
        {
          fetchImpl: fakeApi({
            redeem: () => new Response(null, { status: 401 }),
          }).fetchImpl,
          env: ENV,
        },
      ),
      await storefrontCallback(
        withTx("/auth/callback?code=c&state=s"),
        ACADEMY,
        {
          fetchImpl: fakeApi({
            redeem: () => new Response(null, { status: 429 }),
          }).fetchImpl,
          env: ENV,
        },
      ),
      await storefrontCallback(get("/auth/callback?code=c&state=s"), ACADEMY, {
        fetchImpl: fakeApi().fetchImpl,
        env: ENV,
      }),
      await storefrontCallback(
        new Request("https://academy.example/auth/callback", {
          method: "POST",
          body: "code=c",
        }),
        ACADEMY,
        { fetchImpl: fakeApi().fetchImpl, env: ENV },
      ),
    ];
    for (const res of answers) {
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toMatch(/^\/[^#]*#$/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.body).toBeNull();
      expect(setCookies(res)[0]).toMatch(
        new RegExp(`^${OIDC_TX_COOKIE}=; .*Max-Age=0`),
      );
    }
  });

  it("003 EARS-62: a redeem refusal without a live transaction (expired or used) mints nothing and, with no check guard, answers into a fresh silent transaction with no return path and sets the guard", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          { message: "redeem refused", returnPath: null, door: null },
          { status: 401 },
        ),
    });
    const res = await storefrontCallback(
      withTx("/auth/callback?code=c&state=s"),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${SILENT_AUTHORIZE}#`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(api.internal("silent-check").map((c) => c.body)).toEqual([
      { client: "academy" },
    ]);
    const set = setCookies(res);
    expect(set.join()).not.toContain("__Host-ds_session");
    expect(set.some((c) => c.startsWith("__Host-ds_check=1;"))).toBe(true);
    const tx = set.filter((c) => c.startsWith(`${OIDC_TX_COOKIE}=`));
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatch(
      new RegExp(
        `^${OIDC_TX_COOKIE}=${SILENT_TX_ID}\\.[A-Za-z0-9_-]+; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax$`,
      ),
    );
  });

  it("003 EARS-62: a redeem refusal without a live transaction, with the check guard present, answers 303 / as a guest with the marker set", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          { message: "redeem refused", returnPath: null, door: null },
          { status: 401 },
        ),
    });
    const res = await storefrontCallback(
      withTx(
        "/auth/callback?code=c&state=s",
        `${OIDC_TX_COOKIE}=${TX_ID}; __Host-ds_check=1`,
      ),
      ACADEMY,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.headers.get("location")).toBe("/#");
    expect(api.internal("silent-check")).toEqual([]);
    expect(
      setCookies(res).some((c) =>
        /^__Host-ds_guest=\d+\.[A-Za-z0-9_-]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/.test(
          c,
        ),
      ),
    ).toBe(true);
  });

  const carrying = (
    opts: { event?: number; registration?: number | "throw" } = {},
  ) =>
    fakeApi({
      ...opts,
      redeem: () =>
        new Response(
          JSON.stringify({
            sub: "u1",
            roles: ["doctor_guest"],
            mfa: false,
            returnPath: "/events/live-1",
            door: "login",
            kind: "interactive",
            completeRegistration: "live-1",
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
  const registrations = (api: ReturnType<typeof fakeApi>) =>
    api.calls.filter((c) => c.url.endsWith("/registration"));

  it("005 EARS-2: after a successful redeem the callback registers the carried эфир with the fresh session, server-side, before it lands on the event page", async () => {
    const api = carrying({ event: 503 });
    const res = await storefrontCallback(
      withTx(
        "/auth/callback?code=c&state=s",
        `${OIDC_TX_COOKIE}=${TX_ID}; __Host-ds_session=old`,
      ),
      DOCTOR,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.headers.get("location")).toBe("/events/live-1#");
    const [call] = registrations(api);
    expect(call?.url).toBe("http://api:3000/v1/events/live-1/registration");
    expect(call?.init?.method).toBe("POST");
    const headers = call?.init?.headers as Record<string, string>;
    // The minted session, never the one the browser presented; the browser's
    // fingerprint and client chain; never the internal credential.
    expect(headers.cookie).toBe("__Host-ds_session=fresh-sid");
    expect(headers).toMatchObject(BROWSER);
    expect(headers).not.toHaveProperty("authorization");
    // The redeem came first; the registration before the answer.
    const order = api.calls.map((c) => c.url);
    expect(
      order.indexOf("http://api:3000/v1/internal/oidc/redeem"),
    ).toBeLessThan(order.indexOf(call!.url));
  });

  it("005 EARS-2: a refused registration (409, 403) or a failed call still lands on the event page, signed in", async () => {
    for (const registration of [409, 403, 500, "throw"] as const) {
      const api = carrying({ event: 503, registration });
      const res = await storefrontCallback(
        withTx("/auth/callback?code=c&state=s"),
        DOCTOR,
        { fetchImpl: api.fetchImpl, env: ENV },
      );
      expect(res.headers.get("location"), String(registration)).toBe(
        "/events/live-1#",
      );
      expect(setCookies(res).join()).toContain("__Host-ds_session=fresh-sid");
      expect(registrations(api)).toHaveLength(1);
    }
  });

  it("005 EARS-2: an эфир gone by the time the sign-in succeeds registers nothing and lands by the landing rules", async () => {
    const api = carrying({ event: 404 });
    const res = await storefrontCallback(
      withTx("/auth/callback?code=c&state=s"),
      DOCTOR,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.headers.get("location")).not.toBe("/events/live-1#");
    expect(registrations(api)).toHaveLength(0);
  });

  it("005 EARS-2: a refused or aborted sign-in registers nothing", async () => {
    const api = fakeApi({
      redeem: () =>
        Response.json(
          {
            message: "redeem refused",
            returnPath: "/events/live-1",
            door: "login",
          },
          { status: 401 },
        ),
    });
    const res = await storefrontCallback(
      withTx("/auth/callback?error=access_denied&state=s"),
      DOCTOR,
      { fetchImpl: api.fetchImpl, env: ENV },
    );
    expect(res.headers.get("location")).toBe("/events/live-1#");
    expect(registrations(api)).toHaveLength(0);
  });
});
