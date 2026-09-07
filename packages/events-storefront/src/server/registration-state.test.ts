import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchEventRegistrationState } from "./registration-state";

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
