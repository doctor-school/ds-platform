import { afterEach, describe, expect, it, vi } from "vitest";

import { loadFeedPage } from "./materials-feed-loader";

const card = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "news",
  title: "Открыт набор центров в исследование PRP",
  publishedAt: "2026-10-27T09:00:00.000Z",
  image: null,
  source: { platform: "academy", name: "Академия" },
  partner: null,
  href: "/materials/otkryt-nabor-centrov",
};

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("048 materials feed loader", () => {
  it("048 EARS-14: reads the first page from the relative public feed path without a cursor", async () => {
    const fetchMock = respond(200, { data: [], nextCursor: null });

    await expect(loadFeedPage({ cursor: null, limit: 12 })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/public/feed?limit=12",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("048 EARS-15: passes the cursor of the next page", async () => {
    const fetchMock = respond(200, { data: [], nextCursor: null });

    await loadFeedPage({ cursor: "abc=", limit: 8 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/public/feed?limit=8&cursor=abc%3D",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("048 EARS-16: a non-2xx answer rejects so the rail shows its error state", async () => {
    respond(503, {});

    await expect(loadFeedPage({ cursor: null, limit: 12 })).rejects.toThrow(
      /503/,
    );
  });

  it("048 EARS-14: a well-formed page is returned as parsed", async () => {
    respond(200, { data: [card], nextCursor: "next" });

    await expect(loadFeedPage({ cursor: null, limit: 12 })).resolves.toEqual({
      data: [card],
      nextCursor: "next",
    });
  });

  it("048 EARS-16: a malformed body rejects", async () => {
    respond(200, { data: [{ ...card, title: 42 }], nextCursor: null });

    await expect(loadFeedPage({ cursor: null, limit: 12 })).rejects.toThrow();
  });
});
