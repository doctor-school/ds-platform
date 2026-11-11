import { describe, expect, it } from "vitest";

import {
  AdjacentAreaSchema,
  AdjacentAreasSchema,
  FEED_VALUE_ITEM_COUNT,
  FeedBlockSchema,
  FeedValueBlockSchema,
  specialtyFeedBlocks,
  specialtyFeedPath,
  type AdjacentArea,
  type FeedValueBlock,
} from "./specialty-feed.schema.js";

const value: FeedValueBlock = {
  kind: "value",
  items: [
    { title: "Первая", body: "Тело первой." },
    { title: "Вторая", body: "Тело второй." },
    { title: "Третья", body: "Тело третьей." },
    { title: "Четвёртая", body: "Тело четвёртой." },
  ],
};

describe("018 EARS-7: the «Зачем это мне» value block of the feed envelope", () => {
  it("EARS-7: the value block is editorial copy carried by the envelope — four items, no read", () => {
    expect(FEED_VALUE_ITEM_COUNT).toBe(4);
    const parsed = FeedBlockSchema.parse(value);
    expect(parsed).toEqual(value);
    expect(FeedBlockSchema.safeParse({ ...value, read: "/v1/x" }).success).toBe(
      false,
    );
  });

  it("EARS-7: the block carries exactly four items — three or five are refused", () => {
    expect(
      FeedValueBlockSchema.safeParse({
        ...value,
        items: value.items.slice(0, 3),
      }).success,
    ).toBe(false);
    expect(
      FeedValueBlockSchema.safeParse({
        ...value,
        items: [...value.items, { title: "Пятая", body: "Тело пятой." }],
      }).success,
    ).toBe(false);
  });

  it("EARS-7: no payer, marking or attribution can travel beside the items — the block and its items are strict", () => {
    for (const extra of ["payer", "partner", "marking", "sponsor"]) {
      expect(
        FeedValueBlockSchema.safeParse({ ...value, [extra]: "x" }).success,
      ).toBe(false);
    }
    expect(
      FeedValueBlockSchema.safeParse({
        ...value,
        items: value.items.map((item) => ({ ...item, payer: "x" })),
      }).success,
    ).toBe(false);
  });

  it("EARS-7: a read-backed kind still needs its read and cannot carry value copy", () => {
    expect(FeedBlockSchema.safeParse({ kind: "events" }).success).toBe(false);
    expect(
      FeedBlockSchema.safeParse({
        kind: "events",
        read: "/v1/storefront/feed/x/events",
        items: value.items,
      }).success,
    ).toBe(false);
  });

  it("EARS-7: the envelope lists events then value, and mints no /value read", () => {
    const blocks = specialtyFeedBlocks("01.02", { value });
    expect(blocks.map((block) => block.kind)).toEqual([
      "events",
      "value",
      "adjacent",
    ]);
    expect(blocks[0]).toEqual({
      kind: "events",
      read: "/v1/storefront/feed/01.02/events",
    });
    expect(blocks[1]).toEqual(value);
    expect(JSON.stringify(blocks)).not.toContain("/value");
  });
});

const area: AdjacentArea = {
  specialty: {
    id: "8f0b3c1e-2a4d-4b6e-9c8f-1a2b3c4d5e6f",
    code: "terapiya",
    name: "Терапия",
    isOther: false,
  },
  direction: {
    id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    slug: "terapiya",
    title: "Терапия",
  },
  feedHref: specialtyFeedPath("terapiya"),
};

describe("018 EARS-8: the adjacent areas block of the feed envelope", () => {
  it("EARS-8: the envelope lists the adjacent block last, read-backed by its own read", () => {
    const blocks = specialtyFeedBlocks("01.02", { value });
    expect(blocks.at(-1)).toEqual({
      kind: "adjacent",
      read: "/v1/storefront/feed/01.02/adjacent",
    });
    expect(FeedBlockSchema.safeParse({ kind: "adjacent" }).success).toBe(false);
  });

  it("EARS-8: an entry names the adjacent specialty, the direction it was reached through, and that specialty's feed", () => {
    expect(AdjacentAreasSchema.parse({ items: [area] })).toEqual({
      items: [area],
    });
    expect(area.feedHref).toBe("/feed/terapiya");
    expect(AdjacentAreasSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it("EARS-8: no score, similarity or unlabelled field can travel beside an entry — every object is strict", () => {
    for (const extra of ["score", "similarity", "rank", "weight"]) {
      expect(AdjacentAreaSchema.safeParse({ ...area, [extra]: 1 }).success).toBe(
        false,
      );
      expect(
        AdjacentAreasSchema.safeParse({ items: [area], [extra]: 1 }).success,
      ).toBe(false);
    }
    expect(
      AdjacentAreaSchema.safeParse({
        ...area,
        direction: { ...area.direction, weight: 1 },
      }).success,
    ).toBe(false);
    const { direction: _direction, ...unlabelled } = area;
    expect(AdjacentAreaSchema.safeParse(unlabelled).success).toBe(false);
  });
});
