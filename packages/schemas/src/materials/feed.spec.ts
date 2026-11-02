import { describe, expect, it } from "vitest";
import { expertShortName } from "../taxonomy/taxonomy.schema.js";
import {
  FEED_PAGE_SIZE_DEFAULT,
  FEED_PAGE_SIZE_MAX,
  FeedCardSchema,
  PublicFeedPageSchema,
  PublicFeedQuerySchema,
} from "./feed.js";
import { PublicMaterialSchema } from "./public-material.js";

// 048 (#3513) — the public read contracts: the feed card and page (EARS-9,
// EARS-10, EARS-19), the material read (EARS-11) and the column source line
// «Фамилия И. О.» (Lead decision 21).

const news = {
  id: "8d9c4b8e-1d2a-4f6b-9a3e-1b2c3d4e5f60",
  kind: "news",
  title: "Грипп: сезон 2026",
  publishedAt: "2026-10-30T10:00:00.000Z",
  image: null,
  source: { platform: "academy", name: "Академия" },
  partner: null,
  href: "/materials/gripp-sezon-2026",
};

describe("048 public read contracts", () => {
  it("048 EARS-9: expertShortName builds «Фамилия И. О.» from the 012 name parts, the patronymic initial only when present", () => {
    expect(
      expertShortName({
        familyName: "Страхов",
        givenName: "Михаил",
        patronymic: "Андреевич",
      }),
    ).toBe("Страхов М. А.");
    expect(
      expertShortName({
        familyName: "Smith",
        givenName: "john",
        patronymic: null,
      }),
    ).toBe("Smith J.");
    expect(
      expertShortName({
        familyName: null,
        givenName: "Михаил",
        patronymic: null,
      }),
    ).toBeNull();
  });

  it("048 EARS-9: the feed query takes a limit of 1–24, default 12, and refuses anything else", () => {
    expect(FEED_PAGE_SIZE_DEFAULT).toBe(12);
    expect(FEED_PAGE_SIZE_MAX).toBe(24);
    expect(PublicFeedQuerySchema.parse({}).limit).toBe(12);
    expect(PublicFeedQuerySchema.parse({ limit: "24" }).limit).toBe(24);
    expect(PublicFeedQuerySchema.safeParse({ limit: "25" }).success).toBe(
      false,
    );
    expect(PublicFeedQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(PublicFeedQuerySchema.safeParse({ cursor: "" }).success).toBe(false);
    expect(PublicFeedQuerySchema.safeParse({ offset: "3" }).success).toBe(
      false,
    );
  });

  it("048 EARS-9: a feed page is cards of the common shape with no body, and nextCursor null after the last", () => {
    const column = {
      ...news,
      kind: "column",
      source: { platform: "academy", name: "Страхов М. А." },
      partner: { name: "Партнёр" },
      image: { url: "https://cdn.example/cover.webp" },
    };
    const page = PublicFeedPageSchema.parse({
      data: [news, column],
      nextCursor: null,
    });
    expect(page.data).toHaveLength(2);
    expect(FeedCardSchema.safeParse({ ...news, body: {} }).success).toBe(false);
    expect(FeedCardSchema.safeParse({ ...news, kind: "post" }).success).toBe(
      false,
    );
  });

  it("048 EARS-10: no member of the card union carries a field specific to the own-materials source", () => {
    const common = [
      "href",
      "id",
      "image",
      "kind",
      "partner",
      "publishedAt",
      "source",
      "title",
    ];
    for (const member of FeedCardSchema.options) {
      expect(Object.keys(member.shape).sort()).toEqual(common);
    }
    // A card never addresses the materials table: no slug, no material id, no author id.
    expect(FeedCardSchema.safeParse({ ...news, slug: "x" }).success).toBe(
      false,
    );
    expect(
      FeedCardSchema.safeParse({ ...news, materialId: news.id }).success,
    ).toBe(false);
  });

  it("048 EARS-11: the material read carries slug, kind, title, publishedAt, cover, author, partner and body — no expert slug or link", () => {
    const material = {
      slug: "gripp-sezon-2026",
      kind: "column",
      title: "Грипп",
      publishedAt: "2026-10-30T10:00:00.000Z",
      cover: null,
      author: { name: "Страхов Михаил Андреевич" },
      partner: null,
      body: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Т" }] },
        ],
      },
    };
    expect(PublicMaterialSchema.parse(material)).toEqual(material);
    expect(
      PublicMaterialSchema.safeParse({
        ...material,
        author: { name: "X", slug: "strakhov" },
      }).success,
    ).toBe(false);
  });

  it("048 EARS-19: partner is { name } or null on both the card and the material", () => {
    expect(
      FeedCardSchema.safeParse({ ...news, partner: { name: "" } }).success,
    ).toBe(false);
    expect(
      FeedCardSchema.safeParse({ ...news, partner: { name: "П", logo: "x" } })
        .success,
    ).toBe(false);
  });
});
