import { z } from "zod";

// 048 (#3513) — the public feed contract (048-design §«Public reads»; EARS-9,
// EARS-10, EARS-19). The card is the common shape every source renders from:
// a discriminated union on `kind`, slice 1 defining `news` and `column`. No
// field is specific to the own-materials source (EARS-10) — a network slice
// adds its own member (`post`, `video`) with its own fields and leaves these
// two unchanged.

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

/** One card of the feed (EARS-9) — renders from the card alone (EARS-10). */
export const FeedCardSchema = z.discriminatedUnion("kind", [
  FeedNewsCardSchema,
  FeedColumnCardSchema,
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
