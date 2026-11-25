import { describe, expect, it } from "vitest";
import { VkApiClient, type VkCallLogger } from "./vk-api.client.js";
import {
  VK_API_VERSION,
  VkApiError,
  VkNotConfiguredError,
  vkUnreachable,
} from "./vk-api.types.js";

// 048 ADR-0011 §2.2 channel #11 (#4004) — the only caller of api.vk.com:
// `wall.get` and `groups.getById` only, Zod-checked parameters and
// responses, the service key never in a URL, log line or thrown error, one
// structured log line per call and the monthly counter (EARS-44, EARS-51).

const KEY = "vk1.a.SERVICE-key_value-0123456789";

function harness(
  respond: (url: string) => Response | Promise<Response>,
  key: string | null = KEY,
) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const lines: Record<string, unknown>[] = [];
  let counted = 0;
  const logger: VkCallLogger = {
    log: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };
  const client = new VkApiClient(
    key,
    { count: async () => void (counted += 1) },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, body: new URLSearchParams(init?.body ?? "") });
        return respond(url);
      },
      logger,
    },
  );
  return { client, calls, lines, counted: () => counted };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("048 VK API client", () => {
  it("048 EARS-51: when it calls VK, the system shall send the key in the POST body only, with the pinned version, count the call and log method, status, error code, duration and outcome only", async () => {
    const h = harness(() =>
      json({ response: { groups: [{ id: 5, screen_name: "bbm" }] } }),
    );
    expect(await h.client.groupsGetById("bbm")).toEqual([
      { id: 5, screen_name: "bbm" },
    ]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe("https://api.vk.com/method/groups.getById");
    expect(h.calls[0]!.url).not.toContain(KEY);
    expect(h.calls[0]!.body.get("access_token")).toBe(KEY);
    expect(h.calls[0]!.body.get("v")).toBe(VK_API_VERSION);
    expect(h.calls[0]!.body.get("group_id")).toBe("bbm");
    expect(h.counted()).toBe(1);
    expect(h.lines).toHaveLength(1);
    expect(Object.keys(h.lines[0]!).sort()).toEqual(
      [
        "durationMs",
        "errorCode",
        "event",
        "httpStatus",
        "method",
        "outcome",
      ].sort(),
    );
    expect(h.lines[0]).toMatchObject({
      method: "groups.getById",
      outcome: "ok",
      httpStatus: 200,
    });
  });

  it("048 EARS-45: when the reconcile reads the wall, the system shall call wall.get with owner_id, filter owner and count", async () => {
    const h = harness(() =>
      json({ response: { count: 1, items: [{ id: 1 }] } }),
    );
    const page = await h.client.wallGet({
      owner_id: -5,
      filter: "owner",
      count: 100,
    });
    expect(page).toEqual({ count: 1, items: [{ id: 1 }] });
    expect(h.calls[0]!.url).toBe("https://api.vk.com/method/wall.get");
    expect(Object.fromEntries(h.calls[0]!.body)).toMatchObject({
      owner_id: "-5",
      filter: "owner",
      count: "100",
    });
  });

  it("048 EARS-51: when VK answers an error, an HTTP failure, an invalid body or the network fails, the system shall throw a VkApiError carrying no key or VK text", async () => {
    const cases: Array<
      [() => Response | Promise<Response>, string, number | null]
    > = [
      [
        () =>
          json({ error: { error_code: 5, error_msg: `VK-TEXT-MARK ${KEY}` } }),
        "api_error",
        5,
      ],
      [() => json({ oops: true }, 502), "http_error", null],
      [() => json({ response: { groups: "x" } }), "invalid_response", null],
      [
        () => Promise.reject(new TypeError(`fetch failed ${KEY}`)),
        "network_error",
        null,
      ],
    ];
    for (const [respond, outcome, code] of cases) {
      const h = harness(respond);
      const error = await h.client.groupsGetById(7).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VkApiError);
      expect(error).toMatchObject({ outcome, errorCode: code });
      expect(String((error as Error).message)).not.toContain(KEY);
      expect(JSON.stringify(h.lines)).not.toContain(KEY);
      expect(JSON.stringify(h.lines)).not.toContain("VK-TEXT-MARK");
      expect(h.counted()).toBe(1);
    }
    expect(
      vkUnreachable(new VkApiError("wall.get", "timeout", null, null)),
    ).toBe(true);
    expect(vkUnreachable(new VkApiError("wall.get", "api_error", 200, 6))).toBe(
      true,
    );
    expect(
      vkUnreachable(new VkApiError("wall.get", "api_error", 200, 100)),
    ).toBe(false);
  });

  it("048 EARS-51: when no service key is configured, the system shall call nothing", async () => {
    const h = harness(() => json({}), null);
    await expect(h.client.groupsGetById("bbm")).rejects.toBeInstanceOf(
      VkNotConfiguredError,
    );
    expect(h.calls).toHaveLength(0);
    expect(h.counted()).toBe(0);
  });

  it("048 EARS-51: when a parameter is not of the typed surface, the system shall refuse it before any request", async () => {
    const h = harness(() => json({}));
    await expect(h.client.groupsGetById("bad name/../x")).rejects.toThrow();
    await expect(
      h.client.wallGet({ owner_id: 5, filter: "owner", count: 100 }),
    ).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
});
