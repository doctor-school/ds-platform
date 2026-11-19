import { describe, expect, it } from "vitest";
import {
  TelegramBotApiClient,
  type TelegramCallLogger,
} from "./telegram-bot-api.client.js";
import {
  TelegramBotApiError,
  TelegramNotConfiguredError,
} from "./telegram-bot-api.types.js";

// 048 ADR-0011 §2.2 channel #10 (#3994) — the only caller of api.telegram.org:
// typed methods, Zod-checked parameters and responses, the token never in a
// logged or thrown string, one structured log line per call (EARS-36).

const TOKEN = "123456:AAH-secret_token-value";

interface Captured {
  url: string;
  body: unknown;
}

function harness(
  respond: (url: string) => Response | Promise<Response>,
  token: string | null = TOKEN,
) {
  const calls: Captured[] = [];
  const lines: Record<string, unknown>[] = [];
  const logger: TelegramCallLogger = {
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };
  const client = new TelegramBotApiClient(token, {
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return respond(url);
    },
    logger,
    timeoutMs: 1000,
  });
  return { client, calls, lines };
}

const ok = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("048 Telegram Bot API client", () => {
  it("048 EARS-36: when the client calls the Bot API, the system shall log the method, HTTP status, duration and outcome only, never the token", async () => {
    const { client, calls, lines } = harness(() =>
      ok({ id: -1001, type: "channel", username: "bbmacademy", title: "t" }),
    );
    const chat = await client.getChat("@bbmacademy");
    expect(chat).toEqual({
      id: -1001,
      type: "channel",
      username: "bbmacademy",
    });
    expect(calls).toEqual([
      {
        url: `https://api.telegram.org/bot${TOKEN}/getChat`,
        body: { chat_id: "@bbmacademy" },
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]!).sort()).toEqual(
      ["durationMs", "event", "httpStatus", "method", "outcome"].sort(),
    );
    expect(lines[0]).toMatchObject({
      method: "getChat",
      httpStatus: 200,
      outcome: "ok",
    });
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });

  it("048 EARS-36: when a call fails, the system shall throw and log without the token", async () => {
    const failures: Array<() => Response | Promise<Response>> = [
      () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: "chat not found",
          }),
          { status: 400 },
        ),
      () => {
        throw new TypeError(
          `fetch failed for https://api.telegram.org/bot${TOKEN}/getMe`,
        );
      },
      () => ok({ unexpected: true }),
    ];
    for (const fail of failures) {
      const { client, lines } = harness(fail);
      const error = await client.getMe().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(TelegramBotApiError);
      const text = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
      expect(text).not.toContain(TOKEN);
      expect(JSON.stringify(lines)).not.toContain(TOKEN);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.outcome).not.toBe("ok");
    }
  });

  it("048 EARS-24: when the poller stops and cuts its long poll short, the system shall log the call as aborted at info level, not as a timeout warning", async () => {
    const infos: Record<string, unknown>[] = [];
    const warnings: Record<string, unknown>[] = [];
    const stop = new AbortController();
    const client = new TelegramBotApiClient(TOKEN, {
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        }),
      logger: {
        log: (line) => infos.push(line),
        warn: (line) => warnings.push(line),
      },
      timeoutMs: 1000,
    });
    const polling = client
      .getUpdates(
        {
          offset: 0,
          limit: 100,
          timeout: 50,
          allowed_updates: ["channel_post", "edited_channel_post"],
        },
        { timeoutMs: 65_000, signal: stop.signal },
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    stop.abort();
    const error = await polling;
    expect(error).toBeInstanceOf(TelegramBotApiError);
    expect((error as TelegramBotApiError).outcome).toBe("aborted");
    expect(warnings).toEqual([]);
    expect(infos).toEqual([
      expect.objectContaining({ method: "getUpdates", outcome: "aborted" }),
    ]);
  });

  it("048 EARS-36: when parameters are not of the typed shape, the system shall refuse before calling", async () => {
    const { client, calls } = harness(() => ok(true));
    await expect(client.getChat("@x" as never)).rejects.toThrow();
    await expect(client.getFile("../etc")).rejects.toThrow();
    await expect(client.downloadFile("photos/../../x")).rejects.toThrow();
    await expect(
      client.getUpdates({
        offset: 0,
        limit: 100,
        timeout: 51,
        allowed_updates: ["channel_post"],
      }),
    ).rejects.toThrow();
    await expect(
      client.getUpdates({
        offset: 0,
        limit: 100,
        timeout: 50,
        allowed_updates: ["message" as never],
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("048 EARS-24: when the connector is not configured, the system shall call nothing", async () => {
    const { client, calls } = harness(() => ok(true), null);
    await expect(client.getMe()).rejects.toBeInstanceOf(
      TelegramNotConfiguredError,
    );
    expect(calls).toEqual([]);
  });

  it("048 EARS-24: getUpdates long-polls from the offset for the two update types, with an HTTP timeout past Telegram's wait", async () => {
    const { client, calls } = harness(() =>
      ok([{ update_id: 41, channel_post: { message_id: 1 } }]),
    );
    const signal = new AbortController().signal;
    const updates = await client.getUpdates(
      {
        offset: 41,
        limit: 100,
        timeout: 50,
        allowed_updates: ["channel_post", "edited_channel_post"],
      },
      { timeoutMs: 65_000, signal },
    );
    expect(updates).toEqual([
      { update_id: 41, channel_post: { message_id: 1 } },
    ]);
    expect(calls[0]).toEqual({
      url: `https://api.telegram.org/bot${TOKEN}/getUpdates`,
      body: {
        offset: 41,
        limit: 100,
        timeout: 50,
        allowed_updates: ["channel_post", "edited_channel_post"],
      },
    });
  });

  it("048 EARS-24: deleteWebhook always keeps the pending updates", async () => {
    const { client, calls } = harness(() => ok(true));
    await client.deleteWebhook();
    expect(calls[0]).toEqual({
      url: `https://api.telegram.org/bot${TOKEN}/deleteWebhook`,
      body: { drop_pending_updates: false },
    });
  });

  it("048 EARS-24: a getUpdates answer without an update id is refused as an invalid response", async () => {
    const { client } = harness(() => ok([{ channel_post: {} }]));
    await expect(
      client.getUpdates({
        offset: 0,
        limit: 100,
        timeout: 0,
        allowed_updates: ["channel_post"],
      }),
    ).rejects.toMatchObject({ outcome: "invalid_response" });
  });

  it("048 EARS-29: the file download refuses a body over the limit", async () => {
    const { client, calls } = harness(
      () => new Response(new Uint8Array(32), { status: 200 }),
    );
    await expect(
      client.downloadFile("photos/file_1.jpg", 16),
    ).rejects.toMatchObject({
      outcome: "too_large",
    });
    expect(calls[0]!.url).toBe(
      `https://api.telegram.org/file/bot${TOKEN}/photos/file_1.jpg`,
    );
    const small = harness(
      () => new Response(new Uint8Array(8), { status: 200 }),
    );
    expect(
      (await small.client.downloadFile("photos/file_1.jpg", 16)).length,
    ).toBe(8);
  });
});
