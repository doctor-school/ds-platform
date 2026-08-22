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
    });
  });

  it("1440.4: returns null with no session cookie — no upstream read is issued", () => {
    expect(forwardedSessionFrom(new Headers({ cookie: "other=1" }))).toBeNull();
    expect(forwardedSessionFrom(new Headers())).toBeNull();
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
