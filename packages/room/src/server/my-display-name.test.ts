import { describe, expect, it, vi } from "vitest";

import { fetchMyDisplayName } from "./my-display-name";
import type { RoomSession } from "./session";

/**
 * 006 EARS-14 / EARS-16 — the self-only display-name read, parameterised for the
 * same reason as the grant read: the API base is a host fact, not a package one.
 */

const session: RoomSession = {
  cookie: "__Host-ds_session=abc",
  userAgent: "Mozilla/5.0 (probe)",
  acceptLanguage: "ru-RU",
};

describe("006 EARS-14: the self display-name read", () => {
  it("006 EARS-14: a saved name is returned and the fingerprint surface is forwarded", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ displayName: "Иван Петров" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchMyDisplayName(session, { apiBase: "http://api:3000/", fetchImpl }),
    ).resolves.toBe("Иван Петров");

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("http://api:3000/v1/me/display-name");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({
      cookie: session.cookie,
      "user-agent": session.userAgent,
      "accept-language": session.acceptLanguage,
    });
  });

  it("006 EARS-14: an unset name reads as null — the caller prompts once", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ displayName: null }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchMyDisplayName(session, { apiBase: "http://api", fetchImpl }),
    ).resolves.toBeNull();
  });

  it("006 EARS-16: a non-ok read throws — the caller already holds a granted room session", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchMyDisplayName(session, { apiBase: "http://api", fetchImpl }),
    ).rejects.toThrow(/401/);
  });
});
