import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMyEvents } from "./my-events";

// 005 EARS-6 / EARS-10 — the authenticated «Мои события» read. Its row→card
// projection stays on the Academy host (`apps/portal/lib/my-events.ts`) until
// wave-2 PR 2.3 (entry gate §2.1 row 15).

/**
 * #2054 — the «Мои события» read is the surface the bug was reported on: an
 * authenticated doctor was bounced to /account because this server-to-server hop
 * presented the Next container's address to a fingerprint bound to the browser's
 * `/24` (api `request.ip` follows `x-forwarded-for` since #1655).
 */
describe("#2054 the authenticated /v1/me/events read forwards the client chain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("2054.5: the read sends the incoming x-forwarded-for alongside the cookie and fingerprint headers", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return {
          ok: true,
          status: 200,
          json: async () => ({ tab: "upcoming", data: [], counts: { upcoming: 0, past: 0 } }),
        } as unknown as Response;
      }),
    );

    await fetchMyEvents({
      cookie: "__Host-ds_session=abc",
      userAgent: "Mozilla/5.0 (probe)",
      acceptLanguage: "ru-RU",
      forwardedFor: "203.0.113.7, 172.18.0.4",
    });

    const sent = calls[0]!.headers as Record<string, string>;
    expect(sent["x-forwarded-for"]).toBe("203.0.113.7, 172.18.0.4");
    expect(sent.cookie).toBe("__Host-ds_session=abc");
  });
});
