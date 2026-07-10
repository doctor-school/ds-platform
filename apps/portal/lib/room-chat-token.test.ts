import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "centrifuge";

import { fetchFreshChatToken } from "./room-chat-token";

/**
 * 006 EARS-3 — the chat connection-token refresh (`getToken`) read. The token the
 * grant carries has a finite TTL (`CHAT_TOKEN_TTL_SECONDS`); a webinar longer than
 * one TTL survives because centrifuge-js invokes this callback on token expiry and
 * the chat connection refreshes transparently. The refresh MUST ride the SAME
 * admission gate as the original grant (re-fetching `RoomConfig` — no dedicated,
 * weaker refresh path), return the fresh gate-scoped subscribe-only token, and
 * follow the SDK's error contract: a gate refusal is TERMINAL (`UnauthorizedError`
 * — stop reconnecting), a transient failure is RETRYABLE (plain error — backoff).
 */

const GRANT = {
  eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  heartbeatIntervalSeconds: 60,
  // #690 grant additions (required keys — the refresh re-parses the FULL grant):
  // the actual go-live instant + the live room-presence count.
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

function mockFetch(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("006 EARS-3 fetchFreshChatToken — the getToken refresh rides the same admission gate", () => {
  it("EARS-3: when the token refresh is invoked, the system shall re-fetch the gated RoomConfig grant and return the fresh gate-scoped token", async () => {
    const mock = mockFetch(200, GRANT);
    await expect(fetchFreshChatToken("seed-005-live")).resolves.toBe(
      "fresh-token-from-the-gate",
    );
    // The refresh is the SAME gated read (`GET /v1/events/:slug/room`, session
    // cookie riding same-origin) — no dedicated weaker refresh endpoint.
    expect(mock).toHaveBeenCalledWith(
      "/v1/events/seed-005-live/room",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("EARS-3: the room slug is URI-escaped into the refresh path", async () => {
    const mock = mockFetch(200, GRANT);
    await fetchFreshChatToken("a/b c");
    expect(mock).toHaveBeenCalledWith(
      "/v1/events/a%2Fb%20c/room",
      expect.anything(),
    );
  });

  it.each([401, 403, 404, 409])(
    "EARS-3/8: when the admission gate refuses the refresh (%i), the system shall stop reconnecting (UnauthorizedError), never retry into a room it is not admitted to",
    async (status) => {
      mockFetch(status);
      await expect(fetchFreshChatToken("seed-005-live")).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    },
  );

  it("EARS-3: a transient server failure (5xx) is retryable — a plain error, NOT UnauthorizedError, so the SDK retries with backoff", async () => {
    mockFetch(503);
    const err = await fetchFreshChatToken("seed-005-live").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
  });

  it("EARS-3: a network blip is retryable — a plain error, NOT UnauthorizedError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down")),
    );
    const err = await fetchFreshChatToken("seed-005-live").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
  });

  it("EARS-3: a grant with no chat credential (Centrifugo unconfigured) is terminal — there is no token to refresh to", async () => {
    mockFetch(200, { ...GRANT, chat: null });
    await expect(fetchFreshChatToken("seed-005-live")).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
