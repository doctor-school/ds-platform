import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchEventRegistrationState,
  forwardedHeaders,
  forwardedSessionFrom,
} from "./registration-state";

/**
 * 005 EARS-4 — the per-user registration read both storefronts compose onto the
 * shared event page. What belongs to THIS module is the read contract: never
 * issue an authed request without a session, forward the fingerprint surface the
 * BFF bound at login (ADR-0001 §6), and collapse every "no per-user state to
 * compose" answer to `null` so the page falls back to the public 004 render
 * instead of erroring on a public URL.
 */
const SESSION = {
  cookie: "__Host-ds_session=abc",
  userAgent: "Mozilla/5.0 (probe)",
  acceptLanguage: "ru-RU,ru;q=0.9",
  forwardedFor: "203.0.113.7, 172.18.0.4",
};

const fetchImpl = vi.fn();

beforeEach(() => {
  fetchImpl.mockReset();
});

describe("005 EARS-4 per-user event registration state", () => {
  it("005 EARS-4: a guest (no session cookie) resolves to null WITHOUT issuing the authenticated read", async () => {
    await expect(
      fetchEventRegistrationState("ahilles-042", { ...SESSION, cookie: "" }, fetchImpl),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("005 EARS-4: the read forwards the session cookie AND the fingerprint surface, uncached", async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ registered: true, registeredAt: "2026-07-08T10:00:00+00:00" }),
    });

    await expect(
      fetchEventRegistrationState("ahilles-042", SESSION, fetchImpl),
    ).resolves.toEqual({
      registered: true,
      registeredAt: "2026-07-08T10:00:00+00:00",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/v1/events/ahilles-042/registration")).toBe(true);
    const sent = init.headers as Record<string, string>;
    expect(sent.cookie).toBe(SESSION.cookie);
    expect(sent["user-agent"]).toBe(SESSION.userAgent);
    expect(sent["accept-language"]).toBe(SESSION.acceptLanguage);
    // Per-user ⇒ never shared-cached (design §5).
    expect(init.cache).toBe("no-store");
  });

  it("005 EARS-4: a 401 (lapsed session / fingerprint mismatch) and a 404 (unknown event) both collapse to null", async () => {
    for (const status of [401, 404]) {
      fetchImpl.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });
      await expect(
        fetchEventRegistrationState("ahilles-042", SESSION, fetchImpl),
      ).resolves.toBeNull();
    }
  });

  it("005 EARS-4: any OTHER upstream failure throws — a broken api is not silently rendered as an unregistered doctor", async () => {
    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      fetchEventRegistrationState("ahilles-042", SESSION, fetchImpl),
    ).rejects.toThrow("registration state fetch failed (503)");
  });
});

/**
 * #2054 — the fourth fingerprint input. Since #1655 the api derives `request.ip`
 * from `x-forwarded-for` when the peer is trusted, so the client `/24` bound at
 * login is the BROWSER's, not the Next container's. An SSR hop that presents
 * cookie + user-agent + accept-language but drops the forwarded chain therefore
 * re-derives a different fingerprint and 401s a valid session.
 */
describe("#2054 forwarded client address on the SSR hop", () => {
  it("2054.1: forwardedSessionFrom carries the incoming x-forwarded-for verbatim", () => {
    expect(
      forwardedSessionFrom(
        new Headers({
          cookie: "__Host-ds_session=abc",
          "user-agent": "Mozilla/5.0 (probe)",
          "accept-language": "ru-RU",
          "x-forwarded-for": "203.0.113.7, 172.18.0.4",
        }),
      ),
    ).toEqual({
      cookie: "__Host-ds_session=abc",
      userAgent: "Mozilla/5.0 (probe)",
      acceptLanguage: "ru-RU",
      forwardedFor: "203.0.113.7, 172.18.0.4",
    });
  });

  it("2054.2: a request with no session cookie yields an empty cookie and issues no authed headers", () => {
    const anonymous = forwardedSessionFrom(
      new Headers({ cookie: "other=1", "x-forwarded-for": "203.0.113.7" }),
    );
    expect(anonymous.cookie).toBe("");
    // The public reads still fire; they carry no session surface, but they DO
    // carry the client chain (request.ip also keys the api's rate-limit windows).
    expect(forwardedHeaders(anonymous)).toEqual({
      accept: "application/json",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("2054.3: forwardedHeaders omits x-forwarded-for entirely when the incoming request carried none", () => {
    const sent = forwardedHeaders({ ...SESSION, forwardedFor: "" });
    expect("x-forwarded-for" in sent).toBe(false);
    // Local dev has no proxy: without the header the api falls back to the socket
    // peer, which IS the same loopback the browser's login rode through.
    expect(sent.cookie).toBe(SESSION.cookie);
  });

  it("2054.4: the registration read forwards the client chain so the api re-derives the login fingerprint", async () => {
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ registered: true }),
    });

    await fetchEventRegistrationState("ahilles-042", SESSION, fetchImpl);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sent = init.headers as Record<string, string>;
    expect(sent["x-forwarded-for"]).toBe("203.0.113.7, 172.18.0.4");
  });
});
