import { describe, expect, it, vi } from "vitest";

import { fetchEventsFeed, fetchEventsLive } from "./events-feed";

const page = { cards: [], horizon: { from: "a", to: "b", nextTo: null, nextFrom: null }, remaining: 0 };
const contentSet = {
  feedPath: "/v1/storefront/doctor/events",
  tenseParam: "tense" as const,
  relayCookie: "ds_specialty",
  livePath: "/v1/storefront/doctor/events/live",
  myEventsPath: "/v1/storefront/doctor/me/events",
  adapt: vi.fn(() => page),
};

describe("fetchEventsFeed", () => {
  it("reads the host's feed path with the tense under its read param and forwards only the relay cookie", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await fetchEventsFeed(
      contentSet,
      { tense: "past", from: "2026-09-01" },
      { cookie: "__Host-ds_session=s; ds_specialty=cardio", forwardedFor: "1.2.3.4" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true, value: page });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/storefront\/doctor\/events\?from=2026-09-01&tense=past$/);
    expect((init.headers as Record<string, string>).cookie).toBe("ds_specialty=cardio");
    expect((init.headers as Record<string, string>)["x-forwarded-for"]).toBe("1.2.3.4");
    expect(contentSet.adapt).toHaveBeenCalledWith({}, { tense: "past" });
  });

  it("a failed read is a block error, never a thrown page", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    expect(
      await fetchEventsFeed(contentSet, {}, { cookie: "", forwardedFor: "" }, fetchImpl as unknown as typeof fetch),
    ).toEqual({ ok: false });
  });
});

describe("fetchEventsLive", () => {
  it("parses the live LIST and degrades a failure to a block error", async () => {
    const ok = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(
      await fetchEventsLive("/v1/public/events/live", { cookie: "", userAgent: "", acceptLanguage: "", forwardedFor: "" }, ok as unknown as typeof fetch),
    ).toEqual({ ok: true, value: [] });
    const bad = vi.fn(async () => { throw new Error("down"); });
    expect(
      await fetchEventsLive("/v1/public/events/live", { cookie: "", userAgent: "", acceptLanguage: "", forwardedFor: "" }, bad as unknown as typeof fetch),
    ).toEqual({ ok: false });
  });
});
