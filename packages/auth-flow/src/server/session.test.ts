import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE_NAME,
  fetchSessionClaims,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  resolveServerAuth,
  serverApiBase,
} from "./session";

/**
 * The ONE server-side session read of the shared auth flow (wave-1 gate rows
 * 22-25, #2027 PR 1.4).
 *
 * These cases are MOVED here, not re-invented: `1440.1`-`1440.6` and `2054.6`
 * came from `apps/doctor/lib/session.test.ts` (the cookie name, the name-boundary
 * check, the fingerprint surface and its `x-forwarded-for` half) and
 * `017 EARS-1.1`-`1.5` from `apps/doctor/lib/shell-auth.test.ts` (the guest
 * short-circuit, the doctor branch, the 401 and the degrade-to-guest rule). The
 * twins are deleted in the host rewire; the behaviour they pin is this module's
 * from here on.
 */

const ORIGINAL_API_TARGET = process.env.API_PROXY_TARGET;

function headersOf(init: Record<string, string>): Headers {
  return new Headers(init);
}

function claimsResponse(): Response {
  return new Response(
    JSON.stringify({ sub: "doctor-1", roles: ["doctor"], mfa: false }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("003 EARS-1 shared server session read", () => {
  beforeEach(() => {
    process.env.API_PROXY_TARGET = "http://api.internal:3000/";
  });

  afterEach(() => {
    if (ORIGINAL_API_TARGET === undefined) delete process.env.API_PROXY_TARGET;
    else process.env.API_PROXY_TARGET = ORIGINAL_API_TARGET;
    vi.restoreAllMocks();
  });

  it("1440.1: the session cookie is the __Host- origin-locked name (ADR-0015 S4)", () => {
    expect(SESSION_COOKIE_NAME).toBe("__Host-ds_session");
  });

  it("1440.2: recognises the session cookie only on a NAME boundary", () => {
    expect(hasSessionCookie(`${SESSION_COOKIE_NAME}=abc`)).toBe(true);
    expect(hasSessionCookie(`other=1; ${SESSION_COOKIE_NAME}=abc`)).toBe(true);
    expect(hasSessionCookie(`x${SESSION_COOKIE_NAME}=abc`)).toBe(false);
    expect(hasSessionCookie(`decoy=${SESSION_COOKIE_NAME}=abc`)).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });

  it("1440.3: forwards the cookie plus the ADR-0001 S6 fingerprint headers", () => {
    const session = forwardedSessionFrom(
      headersOf({
        cookie: `${SESSION_COOKIE_NAME}=abc`,
        "user-agent": "UA/1",
        "accept-language": "ru-RU",
      }),
    );
    expect(forwardedHeaders(session)).toEqual({
      accept: "application/json",
      cookie: `${SESSION_COOKIE_NAME}=abc`,
      "user-agent": "UA/1",
      "accept-language": "ru-RU",
    });
  });

  it("1440.4: yields an EMPTY cookie with no session cookie - no upstream authed read is issued", () => {
    const session = forwardedSessionFrom(headersOf({ cookie: "unrelated=1" }));
    expect(session.cookie).toBe("");
    expect(forwardedHeaders(session)).toEqual({ accept: "application/json" });
  });

  it("1440.5: the BFF read replays cookie + fingerprint headers against the configured upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => claimsResponse());
    const session = forwardedSessionFrom(
      headersOf({
        cookie: `${SESSION_COOKIE_NAME}=abc`,
        "user-agent": "UA/1",
        "accept-language": "ru-RU",
      }),
    );
    const claims = await fetchSessionClaims(
      session,
      fetchImpl,
    );
    expect(claims).toEqual({ sub: "doctor-1", roles: ["doctor"], mfa: false });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://api.internal:3000/v1/auth/session",
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toMatchObject({
      cookie: `${SESSION_COOKIE_NAME}=abc`,
    });
  });

  it("1440.6: 401 resolves to null; any other non-2xx throws", async () => {
    const unauthorized = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    await expect(
      fetchSessionClaims(
        forwardedSessionFrom(
          headersOf({ cookie: `${SESSION_COOKIE_NAME}=abc` }),
        ),
        unauthorized,
      ),
    ).resolves.toBeNull();

    const broken = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    await expect(
      fetchSessionClaims(
        forwardedSessionFrom(
          headersOf({ cookie: `${SESSION_COOKIE_NAME}=abc` }),
        ),
        broken,
      ),
    ).rejects.toThrow(/503/);
  });

  it("2054.6: forwardedSessionFrom carries x-forwarded-for and the session read replays it", async () => {
    const session = forwardedSessionFrom(
      headersOf({
        cookie: `${SESSION_COOKIE_NAME}=abc`,
        "user-agent": "UA/1",
        "accept-language": "ru-RU",
        "x-forwarded-for": "203.0.113.7, 172.18.0.4",
      }),
    );
    expect(session.forwardedFor).toBe("203.0.113.7, 172.18.0.4");
    const fetchImpl = vi.fn<typeof fetch>(async () => claimsResponse());
    await fetchSessionClaims(session, fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      "x-forwarded-for": "203.0.113.7, 172.18.0.4",
    });
  });

  it("2054.6: the client chain rides a GUEST hop too - it also keys the api rate-limit window", () => {
    const session = forwardedSessionFrom(
      headersOf({ "x-forwarded-for": "203.0.113.7" }),
    );
    expect(forwardedHeaders(session)).toEqual({
      accept: "application/json",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("1440.5: serverApiBase reads the upstream at CALL time, so a host that sets it later is honoured", () => {
    expect(serverApiBase()).toBe("http://api.internal:3000");
    process.env.API_PROXY_TARGET = "http://other:4000";
    expect(serverApiBase()).toBe("http://other:4000");
    delete process.env.API_PROXY_TARGET;
    expect(serverApiBase()).toBe("http://localhost:3000");
  });

  it("017 EARS-1.1: resolves guest with no session cookie and issues no upstream read", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => claimsResponse());
    await expect(
      resolveServerAuth(headersOf({}), fetchImpl),
    ).resolves.toEqual({ status: "guest" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("017 EARS-1.2: resolves doctor when the session read returns claims", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => claimsResponse());
    await expect(
      resolveServerAuth(
        headersOf({ cookie: `${SESSION_COOKIE_NAME}=abc` }),
        fetchImpl,
      ),
    ).resolves.toEqual({
      status: "doctor",
      claims: { sub: "doctor-1", roles: ["doctor"], mfa: false },
    });
  });

  it("017 EARS-1.3: resolves guest on a 401 (expired or invalid session)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    await expect(
      resolveServerAuth(
        headersOf({ cookie: `${SESSION_COOKIE_NAME}=abc` }),
        fetchImpl,
      ),
    ).resolves.toEqual({ status: "guest" });
  });

  it("017 EARS-1.4: degrades to guest on an upstream failure instead of taking the shell down", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      resolveServerAuth(
        headersOf({ cookie: `${SESSION_COOKIE_NAME}=abc` }),
        fetchImpl,
      ),
    ).resolves.toEqual({ status: "guest" });
  });

  it("017 EARS-1.5: forwards the fingerprint surface the session is bound to", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => claimsResponse());
    await resolveServerAuth(
      headersOf({
        cookie: `${SESSION_COOKIE_NAME}=abc`,
        "user-agent": "UA/1",
        "accept-language": "ru-RU",
        "x-forwarded-for": "203.0.113.7",
      }),
      fetchImpl,
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      cookie: `${SESSION_COOKIE_NAME}=abc`,
      "user-agent": "UA/1",
      "accept-language": "ru-RU",
      "x-forwarded-for": "203.0.113.7",
    });
  });
});
