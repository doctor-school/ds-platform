import { describe, expect, it, vi } from "vitest";

import {
  fetchEventKindTitles,
  fetchEventsFeed,
  fetchEventsLive,
  fetchMonthCounts,
  fetchMonthEntries,
  fetchSpecialtyFeedEvents,
  readRequestFrom,
} from "./events-feed";

import type { EventsStorefrontHostConfig } from "../host-config";

type ContentSet = EventsStorefrontHostConfig["contentSet"];

const page = {
  today: "2026-10-08",
  cards: [],
  horizon: { from: "a", to: "b", nextCount: null, nextFrom: null },
  remaining: 0,
  nextBatch: 0,
  facetOptions: {},
  matching: 0,
};
const GUEST_REQUEST = {
  cookie: "",
  userAgent: "",
  acceptLanguage: "",
  forwardedFor: "",
};
const contentSet = {
  feedPath: "/v1/storefront/doctor/events",
  tenseParam: "tense" as const,
  relayCookie: "ds_specialty",
  livePath: "/v1/storefront/doctor/events/live",
  myEventsPath: "/v1/storefront/doctor/me/events",
  monthPath: "/v1/storefront/doctor/events/month",
  countsPath: "/v1/storefront/doctor/events/month-counts",
  adapt: vi.fn(() => page),
};

describe("fetchEventsFeed", () => {
  it("reads the host's feed path with the tense under its read param and a guest forwards only the relay cookie", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await fetchEventsFeed(
      { contentSet, filterSet: "doctor" },
      { tense: "past", from: "2026-09-01" },
      {
        cookie: "other=1; ds_specialty=cardio",
        userAgent: "ua",
        acceptLanguage: "ru",
        forwardedFor: "1.2.3.4",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true, value: page });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(
      /\/v1\/storefront\/doctor\/events\?from=2026-09-01&tense=past$/,
    );
    // The guest path is byte-identical to before #2885: no fingerprint headers.
    expect(init.headers).toEqual({
      accept: "application/json",
      cookie: "ds_specialty=cardio",
      "x-forwarded-for": "1.2.3.4",
    });
    expect(init.cache).toBe("no-store");
    expect(contentSet.adapt).toHaveBeenCalledWith({}, { tense: "past" });
  });

  it("NEW: Academy host — the bare `/webinars` and `?tense=past` reads state no cursor page, so the api answers the default horizon with «Показать ещё» (D2, row 32)", async () => {
    const academy = {
      ...contentSet,
      feedPath: "/v1/public/events",
      tenseParam: "timeframe" as const,
    };
    for (const [raw, tense] of [
      [{}, "upcoming"],
      [{ tense: "past" }, "past"],
    ] as const) {
      const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
      await fetchEventsFeed(
        { contentSet: academy, filterSet: "academy" },
        raw,
        GUEST_REQUEST,
        fetchImpl as unknown as typeof fetch,
      );
      const [url] = fetchImpl.mock.calls[0] as unknown as [string];
      // Neither `limit` nor `cursor`: a cursor page carries no next bound.
      expect(url.endsWith(`/v1/public/events?timeframe=${tense}`)).toBe(true);
    }
  });

  it("a failed read is a block error, never a thrown page", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    expect(
      await fetchEventsFeed(
        { contentSet, filterSet: "doctor" },
        {},
        GUEST_REQUEST,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false });
  });
});

describe("fetchEventsLive", () => {
  const GUEST = {
    cookie: "",
    userAgent: "ua",
    acceptLanguage: "ru",
    forwardedFor: "1.2.3.4",
  };
  it("parses the live LIST and degrades a failure to a block error", async () => {
    const ok = vi.fn(async () => new Response("[]", { status: 200 }));
    expect(
      await fetchEventsLive(
        "/v1/public/events/live",
        { contentSet },
        GUEST,
        GUEST_REQUEST,
        ok as unknown as typeof fetch,
      ),
    ).toEqual({ ok: true, value: [] });
    const bad = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      await fetchEventsLive(
        "/v1/public/events/live",
        { contentSet },
        GUEST,
        GUEST_REQUEST,
        bad as unknown as typeof fetch,
      ),
    ).toEqual({ ok: false });
  });

  it("019 EARS-6: a guest's live read carries the remembered specialty cookie like the feed read, and the applied scope (#2907)", async () => {
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 }));
    await fetchEventsLive(
      "/v1/storefront/doctor/events/live?specialty=all",
      { contentSet },
      GUEST,
      {
        ...GUEST_REQUEST,
        cookie: "other=1; ds_specialty=cardio",
        forwardedFor: "1.2.3.4",
      },
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(
      /\/v1\/storefront\/doctor\/events\/live\?specialty=all$/,
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.cookie).toBe("ds_specialty=cardio");
    expect(headers["x-forwarded-for"]).toBe("1.2.3.4");
  });

  it("019 EARS-6: a signed-in viewer's live read forwards the whole session surface unchanged", async () => {
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 }));
    const session = {
      cookie: "__Host-ds_session=s; ds_specialty=cardio",
      userAgent: "ua",
      acceptLanguage: "ru",
      forwardedFor: "",
    };
    await fetchEventsLive(
      "/v1/storefront/doctor/events/live",
      { contentSet },
      session,
      { ...session },
      fetchImpl as unknown as typeof fetch,
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.headers).toMatchObject({
      cookie: session.cookie,
      "user-agent": "ua",
      "accept-language": "ru",
    });
  });
});

describe("019 EARS-3 (#2885): the feed, month and month-counts reads forward the viewer's session", () => {
  const SIGNED_IN = {
    cookie: "__Host-ds_session=s; ds_specialty=cardio",
    userAgent: "Mozilla/5.0 (probe)",
    acceptLanguage: "ru-RU",
    forwardedFor: "1.2.3.4",
  };
  const ok = (body: string) =>
    vi.fn(async () => new Response(body, { status: 200 }));
  const reads = {
    feed: (
      request: typeof SIGNED_IN,
      set: ContentSet = contentSet,
      f = ok("{}"),
    ) =>
      fetchEventsFeed(
        { contentSet: set, filterSet: "doctor" },
        {},
        request,
        f as unknown as typeof fetch,
      ).then(() => f),
    month: (
      request: typeof SIGNED_IN,
      set: ContentSet = contentSet,
      f = ok("[]"),
    ) =>
      fetchMonthEntries(
        { contentSet: set, filterSet: "doctor" },
        {},
        "2026-11",
        request,
        f as unknown as typeof fetch,
      ).then(() => f),
    counts: (
      request: typeof SIGNED_IN,
      set: ContentSet = contentSet,
      f = ok("[]"),
    ) =>
      fetchMonthCounts(
        { contentSet: set, filterSet: "doctor" },
        {},
        "2026",
        request,
        f as unknown as typeof fetch,
      ).then(() => f),
  };
  const sent = (f: ReturnType<typeof ok>) =>
    (f.mock.calls[0] as unknown as [string, RequestInit])[1];

  for (const [name, read] of Object.entries(reads)) {
    it(`${name}: a signed-in viewer's read carries the whole session surface, uncached`, async () => {
      const init = sent(await read(SIGNED_IN));
      expect(init.headers).toEqual({
        accept: "application/json",
        cookie: SIGNED_IN.cookie,
        "user-agent": SIGNED_IN.userAgent,
        "accept-language": SIGNED_IN.acceptLanguage,
        "x-forwarded-for": SIGNED_IN.forwardedFor,
      });
      // A session-dependent read never enters the Next data cache.
      expect(init.cache).toBe("no-store");
      expect(init).not.toHaveProperty("next");
    });

    it(`${name}: a guest's read stays the relay cookie and client address only`, async () => {
      const init = sent(
        await read({
          ...GUEST_REQUEST,
          userAgent: "ua",
          acceptLanguage: "ru",
          cookie: "x=1; ds_specialty=cardio",
          forwardedFor: "1.2.3.4",
        }),
      );
      expect(init.headers).toEqual({
        accept: "application/json",
        cookie: "ds_specialty=cardio",
        "x-forwarded-for": "1.2.3.4",
      });
      expect(init.cache).toBe("no-store");
    });

    it(`${name}: the Academy host (no relay cookie) sends nothing new for a signed-in viewer`, async () => {
      const { relayCookie: _relay, ...academy } = contentSet;
      const init = sent(await read(SIGNED_IN, academy));
      expect(init.headers).toEqual({
        accept: "application/json",
        "x-forwarded-for": SIGNED_IN.forwardedFor,
      });
      expect(init.cache).toBe("no-store");
    });
  }

  it("readRequestFrom takes the fingerprint surface the session needs from the incoming request", () => {
    expect(
      readRequestFrom(
        new Headers({
          cookie: SIGNED_IN.cookie,
          "user-agent": SIGNED_IN.userAgent,
          "accept-language": SIGNED_IN.acceptLanguage,
          "x-forwarded-for": SIGNED_IN.forwardedFor,
        }),
      ),
    ).toEqual(SIGNED_IN);
  });
});

describe("fetchEventKindTitles", () => {
  it("EARS-7: reads the public kind dictionary (published and retired kinds) as slug → title", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: "00460046-0000-4000-8000-000000000005",
            slug: "master-klass",
            title: "Мастер-класс",
          },
        ],
      }),
    );
    expect(
      await fetchEventKindTitles(fetchImpl as unknown as typeof fetch),
    ).toEqual([{ slug: "master-klass", title: "Мастер-класс" }]);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/v1\/public\/event-kinds$/);
  });

  it("EARS-7: a failed dictionary read is reported as unknown (null), never a thrown page and never an empty dictionary", async () => {
    const failed = vi.fn(async () => new Response("", { status: 503 }));
    expect(
      await fetchEventKindTitles(failed as unknown as typeof fetch),
    ).toBeNull();
    const thrown = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(
      await fetchEventKindTitles(thrown as unknown as typeof fetch),
    ).toBeNull();
  });
});

describe("fetchSpecialtyFeedEvents", () => {
  it("EARS-4: reads the specialty's events block path minted from the code, forwarding only the client address — never the viewer's cookie", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [],
            allEventsHref: "/events?specialty=cardiology",
          }),
          {
            status: 200,
          },
        ),
    );
    const result = await fetchSpecialtyFeedEvents(
      "cardiology",
      {
        cookie: "__Host-ds_session=s; ds_specialty=neuro",
        userAgent: "",
        acceptLanguage: "",
        forwardedFor: "1.2.3.4",
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({
      ok: true,
      value: { cards: [], allEventsHref: "/events?specialty=cardiology" },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toMatch(/\/v1\/storefront\/feed\/cardiology\/events$/);
    const sent = init.headers as Record<string, string>;
    expect(sent.cookie).toBeUndefined();
    expect(sent["x-forwarded-for"]).toBe("1.2.3.4");
  });

  it("EARS-4: a failed or malformed read is a block error, never a thrown page", async () => {
    for (const res of [
      new Response("", { status: 503 }),
      new Response('{"items":"x"}', { status: 200 }),
    ]) {
      const fetchImpl = vi.fn(async () => res);
      expect(
        await fetchSpecialtyFeedEvents(
          "cardiology",
          GUEST_REQUEST,
          fetchImpl as unknown as typeof fetch,
        ),
      ).toEqual({ ok: false });
    }
  });
});
