import { describe, expect, it, vi } from "vitest";

import { fetchRoomConfig } from "./room-config";
import type { RoomSession } from "./session";

/**
 * 006 EARS-1 (consumed) / EARS-2 — the parameterised server-side grant read.
 *
 * The Academy's copy of this read took its API base from a module-scope
 * `process.env.API_PROXY_TARGET`. A shared unit may not: the base is a HOST fact
 * (the doctor storefront's server process has its own), and an env read inside a
 * package is invisible on one host until it renders wrong on the other. It is now
 * an injected option, which is also what makes the four refusal branches testable
 * without a network.
 */

const session: RoomSession = {
  cookie: "__Host-ds_session=abc",
  userAgent: "Mozilla/5.0 (probe)",
  acceptLanguage: "ru-RU,ru;q=0.9",
};

function fetchReturning(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("006 EARS-1: the room grant read", () => {
  it("006 EARS-1: a granted room read returns the RoomConfig", async () => {
    const config = { presenceCount: 7, heartbeatIntervalSeconds: 30 };
    const fetchImpl = fetchReturning(200, config);
    const access = await fetchRoomConfig("kardio-2026", session, {
      apiBase: "http://api.internal:3000/",
      fetchImpl,
    });

    expect(access).toEqual({ kind: "granted", config });
    // The injected base is used verbatim (trailing slash normalised), the slug is
    // escaped, and the fingerprint surface (ADR-0001 §6) is forwarded — without it
    // the api re-derives a different fingerprint and 401s a valid session.
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.internal:3000/v1/events/kardio-2026/room");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({
      cookie: session.cookie,
      "user-agent": session.userAgent,
      "accept-language": session.acceptLanguage,
    });
  });

  it("006 EARS-6.1: a 401 is the auth branch", async () => {
    await expect(
      fetchRoomConfig("s", session, { apiBase: "http://api", fetchImpl: fetchReturning(401) }),
    ).resolves.toEqual({ kind: "auth" });
  });

  it("006 EARS-6.2: a 403 is the register branch", async () => {
    await expect(
      fetchRoomConfig("s", session, { apiBase: "http://api", fetchImpl: fetchReturning(403) }),
    ).resolves.toEqual({ kind: "register" });
  });

  it("006 EARS-6.3: a 409 is the not-live branch", async () => {
    await expect(
      fetchRoomConfig("s", session, { apiBase: "http://api", fetchImpl: fetchReturning(409) }),
    ).resolves.toEqual({ kind: "not-live" });
  });

  it("006 EARS-6.4: a 404 is the not-found branch", async () => {
    await expect(
      fetchRoomConfig("s", session, { apiBase: "http://api", fetchImpl: fetchReturning(404) }),
    ).resolves.toEqual({ kind: "not-found" });
  });

  it("006 EARS-1: a session with no cookie short-circuits to auth without issuing the read", async () => {
    const fetchImpl = fetchReturning(200, {});
    await expect(
      fetchRoomConfig("s", { ...session, cookie: "" }, { apiBase: "http://api", fetchImpl }),
    ).resolves.toEqual({ kind: "auth" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("006 EARS-1: any other non-ok status is a real error, never a silent refusal", async () => {
    await expect(
      fetchRoomConfig("s", session, { apiBase: "http://api", fetchImpl: fetchReturning(500) }),
    ).rejects.toThrow(/500/);
  });
});
