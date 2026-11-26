import { describe, expect, it } from "vitest";
import { expertShortName } from "../taxonomy/taxonomy.schema.js";
import {
  FEED_PAGE_SIZE_DEFAULT,
  FEED_PAGE_SIZE_MAX,
  FEED_TELEGRAM_SOURCE_NAME,
  FEED_VK_POST_SOURCE_NAME,
  FEED_VK_VIDEO_SOURCE_NAME,
  FeedCardSchema,
  FeedColumnCardSchema,
  FeedNewsCardSchema,
  FeedPostCardSchema,
  FeedVideoCardSchema,
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
    // A `post` is its own member: an own card's shape under `kind: "post"` is no card.
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
    for (const member of [FeedNewsCardSchema, FeedColumnCardSchema]) {
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

  // ── slice 2 — the Telegram post card (EARS-33, V-13) ─────────────────

  const post = {
    id: "5b0e9d2a-7c1f-4e3b-8a6d-2f4e6a8c0b13",
    kind: "post",
    text: "Новый выпуск: разбор клинического случая",
    publishedAt: "2026-11-16T08:30:00.000Z",
    image: { url: "https://cdn.example/feed/preview.webp" },
    duration: 754,
    source: { platform: "telegram", name: "BBM Academy · Telegram" },
    partner: null,
    href: "https://t.me/bbm_academy/1201",
    external: true,
  };

  it("048 EARS-33: a post card carries id, kind, text, publishedAt, image, duration, the Telegram source, partner null, the t.me href and external true", () => {
    expect(Object.keys(FeedPostCardSchema.shape).sort()).toEqual([
      "duration",
      "external",
      "href",
      "id",
      "image",
      "kind",
      "partner",
      "publishedAt",
      "source",
      "text",
    ]);
    expect(FeedCardSchema.parse(post)).toEqual(post);
    expect(FEED_TELEGRAM_SOURCE_NAME).toBe("BBM Academy · Telegram");
    // No image and no video: the no-image layout; an empty text (a bare photo) is a post.
    expect(
      FeedCardSchema.safeParse({
        ...post,
        image: null,
        duration: null,
        text: "",
      }).success,
    ).toBe(true);
    expect(
      PublicFeedPageSchema.parse({ data: [news, post], nextCursor: null }).data,
    ).toHaveLength(2);
  });

  it("048 EARS-33: a post card refuses a partner, another source, a relative or non-t.me href, a non-integer or negative duration, external false and a title", () => {
    const refused: Record<string, unknown>[] = [
      { partner: { name: "Партнёр" } },
      { source: { platform: "academy", name: "BBM Academy · Telegram" } },
      { source: { platform: "telegram", name: "Академия" } },
      { href: "/materials/x" },
      { href: "http://t.me/bbm_academy/1" },
      { href: "https://example.com/bbm_academy/1" },
      { duration: -1 },
      { duration: 1.5 },
      { external: false },
      { title: "Заголовок" },
    ];
    for (const patch of refused) {
      expect(
        FeedCardSchema.safeParse({ ...post, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
    const { external: _external, ...withoutExternal } = post;
    expect(FeedCardSchema.safeParse(withoutExternal).success).toBe(false);
  });

  it("048 EARS-33: the news and column members stay as slice 1 left them — academy source, no text, duration or external", () => {
    for (const member of [FeedNewsCardSchema, FeedColumnCardSchema]) {
      expect(member.shape).not.toHaveProperty("text");
      expect(member.shape).not.toHaveProperty("duration");
      expect(member.shape).not.toHaveProperty("external");
    }
    expect(
      FeedCardSchema.safeParse({
        ...news,
        source: { platform: "telegram", name: "BBM Academy · Telegram" },
      }).success,
    ).toBe(false);
    expect(FeedCardSchema.safeParse({ ...news, external: true }).success).toBe(
      false,
    );
  });

  const vkPost = {
    id: "2f0b5c1e-7a4d-4c3b-8e2f-6a7b8c9d0e1f",
    kind: "post",
    text: "Разбор клинического случая",
    publishedAt: "2026-11-20T09:00:00.000Z",
    image: { url: "https://sun9-1.userapi.com/impg/preview.jpg" },
    duration: null,
    source: { platform: "vk", name: "BBM Academy · VK" },
    partner: null,
    href: "https://vk.com/wall-123456_789",
    external: true,
  };
  const vkVideo = {
    id: "3a1c6d2f-8b5e-4d4c-9f30-7b8c9d0e1f2a",
    kind: "video",
    title: "Вебинар: антибиотики в практике",
    publishedAt: "2026-11-19T09:00:00.000Z",
    image: { url: "https://sun9-2.userapi.com/impg/cover.jpg" },
    duration: 3725,
    source: { platform: "vk", name: "BBM Academy · VK Видео" },
    partner: null,
    href: "https://vk.com/video-123456_456239017",
    external: true,
  };

  it("048 EARS-48: a VK post is a post card with the VK source, the referenced VK image and the vk.com/wall permalink", () => {
    expect(FEED_VK_POST_SOURCE_NAME).toBe("BBM Academy · VK");
    expect(FeedCardSchema.parse(vkPost)).toEqual(vkPost);
    expect(
      FeedCardSchema.safeParse({ ...vkPost, image: null, duration: 95 })
        .success,
    ).toBe(true);
    const refused: Record<string, unknown>[] = [
      { source: { platform: "vk", name: "BBM Academy · Telegram" } },
      { source: { platform: "vk", name: "BBM Academy · VK Видео" } },
      { source: { platform: "telegram", name: "BBM Academy · VK" } },
      // A post's href belongs to its own platform.
      { href: "https://t.me/bbm_academy/1201" },
      { href: "https://vk.com/video-123456_789" },
      { href: "http://vk.com/wall-123456_789" },
      { href: "https://vk.com/wall123456_789" },
      { partner: { name: "Партнёр" } },
      { external: false },
    ];
    for (const patch of refused) {
      expect(
        FeedCardSchema.safeParse({ ...vkPost, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
    // And a Telegram post never takes a VK permalink.
    expect(
      FeedCardSchema.safeParse({ ...post, href: "https://vk.com/wall-1_2" })
        .success,
    ).toBe(false);
  });

  it("048 EARS-48: a video card carries id, kind, title, publishedAt, image, duration, the VK Видео source, partner null, the vk.com/video href and external true", () => {
    expect(Object.keys(FeedVideoCardSchema.shape).sort()).toEqual([
      "duration",
      "external",
      "href",
      "id",
      "image",
      "kind",
      "partner",
      "publishedAt",
      "source",
      "title",
    ]);
    expect(FEED_VK_VIDEO_SOURCE_NAME).toBe("BBM Academy · VK Видео");
    expect(FeedCardSchema.parse(vkVideo)).toEqual(vkVideo);
    expect(FeedCardSchema.safeParse({ ...vkVideo, image: null }).success).toBe(
      true,
    );
    expect(
      PublicFeedPageSchema.parse({
        data: [news, post, vkPost, vkVideo],
        nextCursor: null,
      }).data,
    ).toHaveLength(4);
    const refused: Record<string, unknown>[] = [
      { duration: null },
      { duration: -1 },
      { duration: 1.5 },
      { title: "" },
      { text: "Текст" },
      { source: { platform: "vk", name: "BBM Academy · VK" } },
      { source: { platform: "telegram", name: "BBM Academy · VK Видео" } },
      { href: "https://vk.com/wall-123456_789" },
      { href: "/materials/x" },
      { partner: { name: "Партнёр" } },
      { external: false },
    ];
    for (const patch of refused) {
      expect(
        FeedCardSchema.safeParse({ ...vkVideo, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });

  it("048 EARS-48: the news, column and Telegram post members stay as they were", () => {
    expect(FeedCardSchema.parse(post)).toEqual(post);
    for (const card of [news, { ...news, kind: "column" }]) {
      expect(FeedCardSchema.parse(card)).toEqual(card);
      expect(
        FeedCardSchema.safeParse({
          ...card,
          source: { platform: "vk", name: "BBM Academy · VK" },
        }).success,
      ).toBe(false);
    }
  });
});
