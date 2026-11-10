import { describe, expect, it } from "vitest";

import {
  FEED_VALUE_ITEM_COUNT,
  FeedBlockSchema,
  FeedValueBlockSchema,
  specialtyFeedBlocks,
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
  freeStatement: "Всё бесплатно для врача",
};

describe("018 EARS-7: the «Зачем это мне» value block of the feed envelope", () => {
  it("EARS-7: the value block is editorial copy carried by the envelope — four items and the free statement, no read", () => {
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

  it("EARS-7: no payer, marking or attribution can travel beside the statement — the block and its items are strict", () => {
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
        freeStatement: "x",
      }).success,
    ).toBe(false);
  });

  it("EARS-7: the envelope lists events then value, and mints no /value read", () => {
    const blocks = specialtyFeedBlocks("01.02", { value });
    expect(blocks.map((block) => block.kind)).toEqual(["events", "value"]);
    expect(blocks[0]).toEqual({
      kind: "events",
      read: "/v1/storefront/feed/01.02/events",
    });
    expect(blocks[1]).toEqual(value);
    expect(JSON.stringify(blocks)).not.toContain("/value");
  });
});
