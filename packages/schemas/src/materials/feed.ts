import { z } from "zod";

// 048 (#3513) — the public feed contract (048-design §«Public reads»; EARS-9,
// EARS-10, EARS-19). The card is the common shape every source renders from:
// a discriminated union on `kind`: `news` and `column` from the own materials,
// `post` from Telegram (slice 2, EARS-33) and VK, `video` from VK Видео
// (slice 3, EARS-48). No field of `news` / `column` is
// specific to the own-materials source (EARS-10); a network member carries its
// own fields and leaves those two unchanged.

/** EARS-9 — the first page the rail asks for. */
export const FEED_PAGE_SIZE_DEFAULT = 12;
/** EARS-9 — the largest page a caller may ask for. */
export const FEED_PAGE_SIZE_MAX = 24;

/** `GET /v1/public/feed?cursor=&limit=` — an unknown key is a caller mistake. */
export const PublicFeedQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(FEED_PAGE_SIZE_MAX)
      .default(FEED_PAGE_SIZE_DEFAULT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type PublicFeedQuery = z.infer<typeof PublicFeedQuerySchema>;

/** Where a card comes from: the platform and the name its source line shows. */
export const FeedCardSourceSchema = z
  .object({ platform: z.literal("academy"), name: z.string().min(1) })
  .strict();

/** EARS-19 — the partner mark, present only while the 032 display rule allows it. */
export const FeedPartnerSchema = z.object({ name: z.string().min(1) }).strict();
export type FeedPartner = z.infer<typeof FeedPartnerSchema>;

const cardFields = {
  id: z.uuid(),
  title: z.string().min(1),
  publishedAt: z.iso.datetime(),
  image: z
    .object({ url: z.string().min(1) })
    .strict()
    .nullable(),
  source: FeedCardSourceSchema,
  partner: FeedPartnerSchema.nullable(),
  href: z.string().min(1),
};

export const FeedNewsCardSchema = z
  .object({ kind: z.literal("news"), ...cardFields })
  .strict();
export const FeedColumnCardSchema = z
  .object({ kind: z.literal("column"), ...cardFields })
  .strict();

/** EARS-33 — the source line of every Telegram card. */
export const FEED_TELEGRAM_SOURCE_NAME = "BBM Academy · Telegram";
/** EARS-48 — the source line of every VK post card. */
export const FEED_VK_POST_SOURCE_NAME = "BBM Academy · VK";
/** EARS-48 — the source line of every VK Видео card. */
export const FEED_VK_VIDEO_SOURCE_NAME = "BBM Academy · VK Видео";

/** The permalink each network platform's post opens (EARS-33, EARS-48). */
const FEED_POST_HREF = {
  telegram: /^https:\/\/t\.me\/\S+$/,
  vk: /^https:\/\/vk\.com\/wall-[1-9][0-9]*_[1-9][0-9]*$/,
} as const;

/**
 * EARS-33, EARS-48 — a network post: the post text, the preview (Telegram's
 * copied one signed at the read, VK's referenced URL as stored) or `null`
 * while there is none, a video's duration in seconds, never a partner, and
 * the absolute permalink on its own platform it always opens in a new tab.
 */
export const FeedPostCardSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("post"),
    /** The post text as stored (EARS-26, EARS-41); empty for a post with only media. */
    text: z.string(),
    publishedAt: z.iso.datetime(),
    image: z
      .object({ url: z.string().min(1) })
      .strict()
      .nullable(),
    duration: z.number().int().min(0).nullable(),
    source: z.discriminatedUnion("platform", [
      z
        .object({
          platform: z.literal("telegram"),
          name: z.literal(FEED_TELEGRAM_SOURCE_NAME),
        })
        .strict(),
      z
        .object({
          platform: z.literal("vk"),
          name: z.literal(FEED_VK_POST_SOURCE_NAME),
        })
        .strict(),
    ]),
    partner: z.null(),
    href: z.string().regex(/^https:\/\/(?:t\.me|vk\.com)\/\S+$/),
    external: z.literal(true),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (!FEED_POST_HREF[card.source.platform].test(card.href)) {
      ctx.addIssue({
        code: "custom",
        path: ["href"],
        message: `a ${card.source.platform} post opens its permalink on ${card.source.platform}`,
      });
    }
  });
export type FeedPostCard = z.infer<typeof FeedPostCardSchema>;

/**
 * EARS-48 — a VK Видео video: its title, the referenced VK cover or `null`,
 * its duration in seconds, never a partner, and the absolute `vk.com/video`
 * permalink it always opens in a new tab — nothing plays inside the Academy.
 */
export const FeedVideoCardSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal("video"),
    title: z.string().min(1),
    publishedAt: z.iso.datetime(),
    image: z
      .object({ url: z.string().min(1) })
      .strict()
      .nullable(),
    duration: z.number().int().min(0),
    source: z
      .object({
        platform: z.literal("vk"),
        name: z.literal(FEED_VK_VIDEO_SOURCE_NAME),
      })
      .strict(),
    partner: z.null(),
    href: z
      .string()
      .regex(/^https:\/\/vk\.com\/video-[1-9][0-9]*_[1-9][0-9]*$/),
    external: z.literal(true),
  })
  .strict();
export type FeedVideoCard = z.infer<typeof FeedVideoCardSchema>;

/** One card of the feed (EARS-9) — renders from the card alone (EARS-10). */
export const FeedCardSchema = z.discriminatedUnion("kind", [
  FeedNewsCardSchema,
  FeedColumnCardSchema,
  FeedPostCardSchema,
  FeedVideoCardSchema,
]);
export type FeedCard = z.infer<typeof FeedCardSchema>;

/** A feed page — newest first, ties by id; `nextCursor` is `null` after the last entry. */
export const PublicFeedPageSchema = z
  .object({
    data: z.array(FeedCardSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type PublicFeedPage = z.infer<typeof PublicFeedPageSchema>;
