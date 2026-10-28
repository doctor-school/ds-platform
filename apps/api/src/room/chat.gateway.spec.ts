import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomChatMessage } from "@ds/schemas";
import { CentrifugoChatGateway, type RoomChatConfig } from "./chat.gateway.js";

/**
 * 006 EARS-19 — the server-enforced realtime boundary of the presence count
 * (design amendment 2026-10-28). The audience picks the Centrifugo channel the
 * count is published to — the shared room channel when the event shows the count
 * to viewers, the staff-only channel when it hides it — and every count
 * publication carries `skip_history`, because the `room` namespace allows client
 * history reads and a hidden count must never be stored where a viewer's
 * connection could read it back. This pins the real HTTP publish body against a
 * stubbed `fetch` — no Centrifugo.
 */

const EVENT = "6f9b2f1e-8f1a-4b7e-9c3d-2a1b3c4d5e6f";

const CONFIG: RoomChatConfig = {
  wsUrl: "ws://centrifugo.test/connection/websocket",
  apiBase: "http://centrifugo.test",
  apiKey: "test-api-key",
  hmacSecret: "test-hmac-secret",
  tokenTtlSeconds: 600,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ result: {} }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The single publish request the gateway sent: URL, headers and parsed body. */
function sentPublish(): {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
} {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    init,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

describe("CentrifugoChatGateway.publishPresenceCount (006 EARS-19)", () => {
  it("006 EARS-19: publishes the count to the shared room channel with skip_history when the event shows it", async () => {
    const gateway = new CentrifugoChatGateway(CONFIG);

    await gateway.publishPresenceCount(EVENT, 7, "everyone");

    const { url, init, body } = sentPublish();
    expect(url).toBe("http://centrifugo.test/api/publish");
    expect(init.method).toBe("POST");
    expect(body.channel).toBe(`room:event:${EVENT}`);
    expect(body.skip_history).toBe(true);
    expect(body.data).toMatchObject({ type: "presence-count", count: 7 });
  });

  it("006 EARS-19: publishes the count to the staff-only channel with skip_history when the event hides it", async () => {
    const gateway = new CentrifugoChatGateway(CONFIG);

    await gateway.publishPresenceCount(EVENT, 3, "staff");

    const { body } = sentPublish();
    expect(body.channel).toBe(`room:staff:${EVENT}`);
    expect(body.channel).not.toBe(`room:event:${EVENT}`);
    expect(body.skip_history).toBe(true);
    expect(body.data).toMatchObject({ type: "presence-count", count: 3 });
  });

  it("006 EARS-19: a chat post still rides the room channel without skip_history", async () => {
    const gateway = new CentrifugoChatGateway(CONFIG);
    const message = {
      id: "m-1",
      text: "Здравствуйте",
    } as unknown as RoomChatMessage;

    await gateway.publish(EVENT, message);

    const { body } = sentPublish();
    expect(body.channel).toBe(`room:event:${EVENT}`);
    expect(body).not.toHaveProperty("skip_history");
  });
});
