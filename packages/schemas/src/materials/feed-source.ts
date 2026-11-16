import { z } from "zod";

import { TaxonomyIdSchema } from "../taxonomy/taxonomy.schema.js";

// 048 (#3993) — the feed source contract, slice 2 (048-design §Data model
// (slice 2), §Endpoints (slice 2); EARS-20…EARS-23). A source is one official
// account of a connected network the feed takes posts from; slice 2 connects
// Telegram only. Its address is stored as the lowercase public username
// (EARS-21); the source check that binds the channel id and sets the status
// (EARS-31) is the Telegram connector's, so a new source starts «Не проверен».

/** The connected networks a source may name (only «Telegram» in slice 2). */
export const FeedSourceNetworkSchema = z.enum(["telegram"]);
export type FeedSourceNetwork = z.infer<typeof FeedSourceNetworkSchema>;

/** EARS-31 — «Не проверен» / «Работает» / «Ошибка». */
export const FeedSourceStatusSchema = z.enum(["unchecked", "ok", "failing"]);
export type FeedSourceStatus = z.infer<typeof FeedSourceStatusSchema>;

/** EARS-21 — a public username: 5–32 Latin letters, digits, underscores, a letter first. */
export const FEED_SOURCE_USERNAME_PATTERN = "^[a-z][a-z0-9_]{4,31}$";
const USERNAME = new RegExp(FEED_SOURCE_USERNAME_PATTERN);

/** EARS-21 — the «Адрес канала» field error of an address of another form. */
export const FEED_SOURCE_ADDRESS_ERROR =
  "Укажите адрес публичного канала в виде t.me/имя";

/** EARS-21 — the «Адрес канала» field error of an address already listed. */
export const FEED_SOURCE_ADDRESS_TAKEN_ERROR = "Этот канал уже есть в списке";

/**
 * EARS-21 — `https://t.me/<имя>`, `t.me/<имя>`, `@<имя>` or `<имя>` → the
 * lowercase username; anything else (an invite link `t.me/+…` or
 * `t.me/joinchat/…`, a post link, another host, a malformed name) → `null`.
 */
export function normalizeFeedSourceAddress(input: string): string | null {
  const value = input.trim().toLowerCase();
  const name = value.startsWith("https://t.me/")
    ? value.slice("https://t.me/".length)
    : value.startsWith("t.me/")
      ? value.slice("t.me/".length)
      : value.startsWith("@")
        ? value.slice(1)
        : value;
  return USERNAME.test(name) ? name : null;
}

/** The permalink of a Telegram post — the `href` of its entry. */
export function telegramPostHref(address: string, messageId: number): string {
  return `https://t.me/${address}/${messageId}`;
}

const FeedSourceAddressSchema = z.string().transform((raw, ctx) => {
  const address = normalizeFeedSourceAddress(raw);
  if (address === null) {
    ctx.addIssue({ code: "custom", message: FEED_SOURCE_ADDRESS_ERROR });
    return z.NEVER;
  }
  return address;
});

/** `POST /v1/admin/feed-sources` — a new source is switched on and unchecked. */
export const CreateFeedSourceRequestSchema = z
  .object({
    platform: FeedSourceNetworkSchema,
    address: FeedSourceAddressSchema,
  })
  .strict();
export type CreateFeedSourceRequest = z.infer<
  typeof CreateFeedSourceRequestSchema
>;

/** `PATCH /v1/admin/feed-sources/{id}` — «Изменить адрес». */
export const UpdateFeedSourceRequestSchema = z
  .object({ address: FeedSourceAddressSchema })
  .strict();
export type UpdateFeedSourceRequest = z.infer<
  typeof UpdateFeedSourceRequestSchema
>;

/** EARS-20 — one row of «Источники»; `version` is the ETag of its writes. */
export const FeedSourceAdminSchema = z.object({
  id: TaxonomyIdSchema,
  platform: FeedSourceNetworkSchema,
  /** The lowercase username; the page shows it as `t.me/<имя>`. */
  address: z.string(),
  /** «Включён» / «Выключен». */
  enabled: z.boolean(),
  status: FeedSourceStatusSchema,
  /** One of the EARS-31 reasons while `failing`, else `null`. */
  statusReason: z.string().nullable(),
  /** The time of the last source check; `null` while unchecked. */
  checkedAt: z.string().nullable(),
  /** The number of its posts in the feed. */
  entryCount: z.number().int().min(0),
  version: z.number().int().min(1),
  updatedAt: z.string(),
});
export type FeedSourceAdmin = z.infer<typeof FeedSourceAdminSchema>;

/** `GET /v1/admin/feed-sources` — every source; an empty list is «Источников пока нет.». */
export const FeedSourceAdminListSchema = z.object({
  data: z.array(FeedSourceAdminSchema),
});
export type FeedSourceAdminList = z.infer<typeof FeedSourceAdminListSchema>;
