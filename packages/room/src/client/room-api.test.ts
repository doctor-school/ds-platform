import { describe, expect, it, vi } from "vitest";

import { createBrowserRoomApi, RoomApiError } from "./room-api";

/**
 * 006 D6a — `createBrowserRoomApi` is the single home of every browser call the
 * room makes, and it is genuinely new code, so it gets its own contract suite.
 *
 * A wrong path, verb, or a missing `credentials: "include"` here is invisible to
 * every other gate: the app-level rewrite-parity tests assert the HOST rewrite, not
 * the CALLER's URL, and the moved model suites never touch the network. The four
 * endpoints must stay RELATIVE — the `__Host-ds_session` cookie is locked to the
 * origin that set it, so each storefront proxies `/v1/*` under its own origin and a
 * parameterised base would be wrong on at least one host.
 */

const GRANT = {
  eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  heartbeatIntervalSeconds: 60,
  liveAt: "2026-07-17T16:03:00.000Z",
  presenceCount: 1,
  stream: null,
  chat: {
    url: "ws://stand.example/connection/websocket",
    token: "fresh-token-from-the-gate",
    channel: "room:event:3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    selfTag: "A1B2C3D4",
  },
};

function fetchDouble(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function api(fetchImpl: ReturnType<typeof vi.fn>) {
  return createBrowserRoomApi({
    slug: "seed-005-live",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

function callAt(
  fetchImpl: ReturnType<typeof vi.fn>,
  index: number,
): [string, RequestInit] {
  return fetchImpl.mock.calls[index] as [string, RequestInit];
}

describe("006 createBrowserRoomApi — the room's browser transport", () => {
  it("006 EARS-3: a chat post goes to POST /v1/events/:slug/chat with the session cookie", async () => {
    const fetchImpl = fetchDouble(201, {});
    await api(fetchImpl).postChatMessage("Здравствуйте!");
    const [url, init] = callAt(fetchImpl, 0);
    expect(url).toBe("/v1/events/seed-005-live/chat");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ text: "Здравствуйте!" }));
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("006 EARS-4: a heartbeat goes to POST /v1/events/:slug/heartbeat", async () => {
    const fetchImpl = fetchDouble(200, { presenceCount: 4 });
    await expect(api(fetchImpl).sendHeartbeat()).resolves.toEqual({ presenceCount: 4 });
    const [url, init] = callAt(fetchImpl, 0);
    expect(url).toBe("/v1/events/seed-005-live/heartbeat");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    // A beat must survive an unload — it is the signal that keeps the count honest.
    expect(init.keepalive).toBe(true);
  });

  it("006 EARS-2: a chat-token refresh reads GET /v1/events/:slug/room", async () => {
    const fetchImpl = fetchDouble(200, GRANT);
    await expect(api(fetchImpl).refreshChatToken()).resolves.toBe(
      "fresh-token-from-the-gate",
    );
    const [url, init] = callAt(fetchImpl, 0);
    expect(url).toBe("/v1/events/seed-005-live/room");
    // No `method` = GET; the gate re-issues the whole grant, not a weaker token.
    expect(init.method).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("006 EARS-14: a display-name save PUTs /v1/me/display-name", async () => {
    const fetchImpl = fetchDouble(204);
    await api(fetchImpl).setDisplayName("Иван Петров");
    const [url, init] = callAt(fetchImpl, 0);
    // Self-scoped by the session `sub` — never a body user id (EARS-16).
    expect(url).toBe("/v1/me/display-name");
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ displayName: "Иван Петров" }));
  });

  it('006: every room call is relative and sends credentials:"include"', async () => {
    const fetchImpl = fetchDouble(200, GRANT);
    const room = api(fetchImpl);
    await room.postChatMessage("привет");
    await room.sendHeartbeat();
    await room.refreshChatToken();
    await room.setDisplayName("Иван");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const call of fetchImpl.mock.calls as [string, RequestInit][]) {
      const [url, init] = call;
      expect(url.startsWith("/v1/")).toBe(true);
      expect(init.credentials).toBe("include");
    }
  });

  it("006: a non-2xx surfaces the typed error, never a resolved promise", async () => {
    const room = api(fetchDouble(500));
    await expect(room.postChatMessage("x")).rejects.toBeInstanceOf(RoomApiError);
    await expect(room.sendHeartbeat()).rejects.toBeInstanceOf(RoomApiError);
    // The gate-refusal / transient split for the token refresh is the centrifuge
    // `getToken` contract, pinned in room-chat-token.test.ts; here we only pin that
    // a non-2xx never resolves.
    await expect(api(fetchDouble(403)).refreshChatToken()).rejects.toThrow();
    await expect(api(fetchDouble(400)).setDisplayName("x")).rejects.toMatchObject({
      status: 400,
    });
  });
});
