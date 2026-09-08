/**
 * kind: engineering-task (#1440) — the `apps/doctor` scaffold has no feature spec
 * and therefore no EARS handlers, so these titles carry the Issue number instead
 * of an `EARS-N` prefix (AGENTS.md §3.8 / §6 TDD numbering applies to spec'd
 * features). What is asserted here is exactly the pair of invariants ADR-0015 §4
 * and ADR-0001 §6 place on a SECOND storefront origin: the host-only session
 * cookie must be recognised by NAME BOUNDARY (never a substring), and the
 * server-side BFF read must replay the fingerprint headers or the api 401s a
 * valid session.
 */
import { describe, it, expect } from "vitest";

import {
  SESSION_COOKIE_NAME,
  fetchSessionClaims,
  forwardedSessionFrom,
  hasSessionCookie,
} from "./session";

describe("#1440 doctor storefront session helpers", () => {
  it("1440.1: the session cookie is the __Host- origin-locked name (ADR-0015 §4)", () => {
    // The `__Host-` prefix is what makes doctor.school and academy.doctor.school
    // hold SEPARATE cookies — a rename to a `Domain`-scoped cookie would silently
    // turn the two hosts into one session scope.
    expect(SESSION_COOKIE_NAME).toBe("__Host-ds_session");
  });

  it("1440.2: recognises the session cookie only on a NAME boundary", () => {
    expect(hasSessionCookie(`${SESSION_COOKIE_NAME}=abc`)).toBe(true);
    expect(hasSessionCookie(`other=1; ${SESSION_COOKIE_NAME}=abc; x=2`)).toBe(
      true,
    );
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
    // A different cookie whose name merely ENDS with ours.
    expect(hasSessionCookie(`x${SESSION_COOKIE_NAME}=abc`)).toBe(false);
    // A different cookie whose VALUE contains the name.
    expect(hasSessionCookie(`decoy=${SESSION_COOKIE_NAME}=abc`)).toBe(false);
  });

  it("1440.3: forwards the cookie plus the ADR-0001 §6 fingerprint headers", () => {
    const headers = new Headers({
      cookie: `${SESSION_COOKIE_NAME}=abc`,
      "user-agent": "Mozilla/5.0 (probe)",
      "accept-language": "ru-RU,ru;q=0.9",
    });
    expect(forwardedSessionFrom(headers)).toEqual({
      cookie: `${SESSION_COOKIE_NAME}=abc`,
      userAgent: "Mozilla/5.0 (probe)",
      acceptLanguage: "ru-RU,ru;q=0.9",
      forwardedFor: "",
    });
  });

  it("1440.4: yields an EMPTY cookie with no session cookie — no upstream authed read is issued", () => {
    expect(forwardedSessionFrom(new Headers({ cookie: "other=1" })).cookie).toBe(
      "",
    );
    expect(forwardedSessionFrom(new Headers()).cookie).toBe("");
  });

  it("1440.5: the BFF read replays cookie + fingerprint headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ sub: "u-1", roles: ["doctor"], mfa: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const claims = await fetchSessionClaims(
      {
        cookie: `${SESSION_COOKIE_NAME}=abc`,
        userAgent: "Mozilla/5.0 (probe)",
        acceptLanguage: "ru-RU",
        forwardedFor: "",
      },
      fetchImpl,
    );

    expect(claims).toEqual({ sub: "u-1", roles: ["doctor"], mfa: false });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    const sent = init.headers as Record<string, string>;
    expect(url).toMatch(/\/v1\/auth\/session$/);
    expect(sent.cookie).toBe(`${SESSION_COOKIE_NAME}=abc`);
    expect(sent["user-agent"]).toBe("Mozilla/5.0 (probe)");
    expect(sent["accept-language"]).toBe("ru-RU");
    expect(init.cache).toBe("no-store");
  });

  it("1440.6: 401 resolves to null; any other non-2xx throws", async () => {
    const session = {
      cookie: `${SESSION_COOKIE_NAME}=abc`,
      userAgent: "ua",
      acceptLanguage: "ru",
      forwardedFor: "",
    };
    const unauthorized = (async () =>
      new Response("", { status: 401 })) as unknown as typeof fetch;
    await expect(fetchSessionClaims(session, unauthorized)).resolves.toBeNull();

    const broken = (async () =>
      new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchSessionClaims(session, broken)).rejects.toThrow(
      /session fetch failed \(503\)/,
    );
  });
});

/**
 * #2054 — the doctor host runs the same SSR hop as the Academy: since #1655 the
 * api resolves `request.ip` from `x-forwarded-for` when the peer is trusted, so
 * the session fingerprint is bound to the BROWSER's `/24`. Dropping the chain on
 * the container→api hop 401s a valid session and bounces the doctor to login.
 */
describe("#2054 the doctor BFF read forwards the client chain", () => {
  it("2054.6: forwardedSessionFrom carries x-forwarded-for and the session read replays it", async () => {
    const headers = new Headers({
      cookie: `${SESSION_COOKIE_NAME}=abc`,
      "user-agent": "Mozilla/5.0 (probe)",
      "accept-language": "ru-RU",
      "x-forwarded-for": "203.0.113.7, 172.18.0.4",
    });
    const session = forwardedSessionFrom(headers);
    expect(session.forwardedFor).toBe("203.0.113.7, 172.18.0.4");

    const calls: RequestInit[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({ sub: "u-1", roles: ["doctor"], mfa: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await fetchSessionClaims(session, fetchImpl);
    const sent = calls[0]!.headers as Record<string, string>;
    expect(sent["x-forwarded-for"]).toBe("203.0.113.7, 172.18.0.4");
  });
});
