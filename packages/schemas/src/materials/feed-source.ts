import { z } from "zod";

import { TaxonomyIdSchema } from "../taxonomy/taxonomy.schema.js";

// 048 (#3993) — the feed source contract, slice 2 (048-design §Data model
// (slice 2), §Endpoints (slice 2); EARS-20…EARS-23). A source is one official
// account of a connected network the feed takes posts from; slice 2 connects
// Telegram only. Its address is stored as the lowercase public username
// (EARS-21); the source check that binds the channel id and sets the status
// (EARS-31) is the Telegram connector's, so a new source starts «Не проверен».

/** The connected networks a source may name: «Telegram» (slice 2), «VK» (slice 3). */
export const FeedSourceNetworkSchema = z.enum(["telegram", "vk"]);
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

// ── 048 slice 3 (#4004) — the VK address rule (EARS-38) ──────────────────

/**
 * EARS-38 — a VK community screen name: 2–32 Latin letters, digits, dots and
 * underscores; `club<id>` / `public<id>` are the screen names of a community
 * without a short name, so they match too.
 */
export const FEED_VK_SOURCE_ADDRESS_PATTERN = "^[a-z0-9_.]{2,32}$";
const VK_SCREEN_NAME = new RegExp(FEED_VK_SOURCE_ADDRESS_PATTERN);
/** A user page (`id<digits>`) is no community (EARS-38). */
const VK_USER_PAGE = /^id[0-9]+$/;
const VK_PREFIXES = ["https://vk.com/", "vk.com/", "https://vk.ru/", "vk.ru/"];

/** EARS-38 — the «Адрес сообщества» field error of an address of another form. */
export const FEED_VK_SOURCE_ADDRESS_ERROR =
  "Укажите адрес сообщества в виде vk.com/имя";

/** EARS-38 — the «Адрес сообщества» field error of an address already listed. */
export const FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR =
  "Это сообщество уже есть в списке";

/**
 * EARS-38 — `https://vk.com/<имя>`, `vk.com/<имя>`, `https://vk.ru/<имя>`,
 * `vk.ru/<имя>` or `<имя>` → the lowercase screen name; a wall, post or video
 * link, a user page, another host or a malformed name → `null`.
 */
export function normalizeVkSourceAddress(input: string): string | null {
  const value = input.trim().toLowerCase();
  const prefix = VK_PREFIXES.find((p) => value.startsWith(p));
  const name = prefix ? value.slice(prefix.length) : value;
  if (!VK_SCREEN_NAME.test(name) || VK_USER_PAGE.test(name)) return null;
  return name;
}

/**
 * EARS-38 — the numeric id a `club<id>` / `public<id>` address names, else
 * `null` (the EARS-44 binding accepts such an address for that id).
 */
export function vkAddressGroupId(address: string): number | null {
  const match = /^(?:club|public)([1-9][0-9]{0,14})$/.exec(address);
  return match ? Number(match[1]) : null;
}

/** EARS-41 — the permalink of a VK wall post, built from the bound community id. */
export function vkWallPostHref(groupId: number, postId: number): string {
  return `https://vk.com/wall-${groupId}_${postId}`;
}

/** EARS-42 — the permalink of a VK Видео video, built from the bound community id. */
export function vkVideoHref(groupId: number, videoId: number): string {
  return `https://vk.com/video-${groupId}_${videoId}`;
}

/** The address rule of a platform (EARS-21 Telegram, EARS-38 VK). */
export function normalizeFeedSourceAddressFor(
  platform: FeedSourceNetwork,
  input: string,
): string | null {
  return platform === "vk"
    ? normalizeVkSourceAddress(input)
    : normalizeFeedSourceAddress(input);
}

/** The field error of an address of another form, per platform. */
export function feedSourceAddressError(platform: FeedSourceNetwork): string {
  return platform === "vk"
    ? FEED_VK_SOURCE_ADDRESS_ERROR
    : FEED_SOURCE_ADDRESS_ERROR;
}

/** The field error of an address already listed, per platform. */
export function feedSourceAddressTakenError(
  platform: FeedSourceNetwork,
): string {
  return platform === "vk"
    ? FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR
    : FEED_SOURCE_ADDRESS_TAKEN_ERROR;
}

const addressOf = (platform: FeedSourceNetwork) =>
  z.string().transform((raw, ctx) => {
    const address = normalizeFeedSourceAddressFor(platform, raw);
    if (address === null) {
      ctx.addIssue({
        code: "custom",
        message: feedSourceAddressError(platform),
      });
      return z.NEVER;
    }
    return address;
  });

/**
 * `POST /v1/admin/feed-sources` — a new source is switched on and unchecked;
 * the address follows its platform's rule (EARS-21, EARS-38).
 */
export const CreateFeedSourceRequestSchema = z.discriminatedUnion("platform", [
  z
    .object({ platform: z.literal("telegram"), address: addressOf("telegram") })
    .strict(),
  z.object({ platform: z.literal("vk"), address: addressOf("vk") }).strict(),
]);
export type CreateFeedSourceRequest = z.infer<
  typeof CreateFeedSourceRequestSchema
>;

/**
 * `PATCH /v1/admin/feed-sources/{id}` — «Изменить адрес». The address rule is
 * the stored source's platform's, so the server normalizes it with
 * {@link normalizeFeedSourceAddressFor} once it has read the source; the
 * contract checks only its presence and length.
 */
export const UpdateFeedSourceRequestSchema = z
  .object({ address: z.string().trim().min(1).max(256) })
  .strict();
export type UpdateFeedSourceRequest = z.infer<
  typeof UpdateFeedSourceRequestSchema
>;

/**
 * EARS-44 — VK API calls per calendar month (Moscow time) of the VK ID
 * account: the unverified cap, and the count at which the check warns and the
 * import stops.
 */
export const FEED_VK_MONTHLY_CALL_CAP = 10_000;
export const FEED_VK_MONTHLY_CALL_WARN = 8_000;

/** EARS-20 — one row of «Источники»; `version` is the ETag of its writes. */
export const FeedSourceAdminSchema = z.object({
  id: TaxonomyIdSchema,
  platform: FeedSourceNetworkSchema,
  /**
   * The lowercase Telegram username (shown as `t.me/<имя>`) or VK screen
   * name (shown as `vk.com/<имя>`).
   */
  address: z.string(),
  /** «Включён» / «Выключен». */
  enabled: z.boolean(),
  status: FeedSourceStatusSchema,
  /** One of the EARS-31 (Telegram) / EARS-44 (VK) reasons while `failing`, else `null`. */
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
  /**
   * EARS-44 — the VK API calls of the current calendar month (Moscow time),
   * shown beside the VK sources («Вызовов VK в этом месяце: N из 10 000»).
   */
  vkCallsThisMonth: z.number().int().min(0),
});
export type FeedSourceAdminList = z.infer<typeof FeedSourceAdminListSchema>;

// ── EARS-32 — «Публикации»: one source's posts, hide and return ───────────

/** The admin page size of «Публикации». */
export const FEED_SOURCE_ENTRIES_PAGE_DEFAULT = 50;
export const FEED_SOURCE_ENTRIES_PAGE_MAX = 100;

/** `GET /v1/admin/feed-sources/{id}/entries?cursor=&limit=` — newest first. */
export const FeedSourceEntriesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(FEED_SOURCE_ENTRIES_PAGE_MAX)
      .default(FEED_SOURCE_ENTRIES_PAGE_DEFAULT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();
export type FeedSourceEntriesQuery = z.infer<
  typeof FeedSourceEntriesQuerySchema
>;

/**
 * EARS-32 — «В ленте» / «Скрыт» / «Источник выключен»; EARS-47 adds «Удалён
 * в VK» (`removed`). A hidden entry reads «Скрыт» whatever else holds (the
 * hide outlives a switch-on and a return to the wall); a removed entry of a
 * switched-off source reads «Удалён в VK».
 */
export const FeedEntryAdminStateSchema = z.enum([
  "in_feed",
  "hidden",
  "source_off",
  "removed",
]);
export type FeedEntryAdminState = z.infer<typeof FeedEntryAdminStateSchema>;

/** EARS-32 — one row of «Публикации»; `version` is the ETag of its writes. */
export const FeedEntryAdminSchema = z.object({
  id: TaxonomyIdSchema,
  /** EARS-47 — a network `post`, or a VK `video`. */
  kind: z.enum(["post", "video"]),
  /**
   * The post text as the card stores it (EARS-26: whitespace collapsed, so it
   * is one line); the page shows its first line, cut to the row width.
   */
  text: z.string(),
  /** The publication's network date — the card date. */
  publishedAt: z.string(),
  state: FeedEntryAdminStateSchema,
  /** Whether «Скрыть из ленты» (false) or «Вернуть в ленту» (true) applies. */
  hidden: z.boolean(),
  /** The original post, opened in a new tab. */
  href: z.string(),
  /**
   * The row's modification stamp (microseconds since the epoch): any write
   * to the entry — a hide, an edit from the channel — moves it, so a hide
   * issued against what the administrator saw is refused once the row moved.
   */
  version: z.number().int().min(1),
});
export type FeedEntryAdmin = z.infer<typeof FeedEntryAdminSchema>;

/**
 * `GET /v1/admin/feed-sources/{id}/entries` — one page of «Публикации», with
 * the source it lists (its `entryCount` is the number of rows over all pages).
 */
export const FeedEntryAdminListSchema = z.object({
  source: FeedSourceAdminSchema,
  data: z.array(FeedEntryAdminSchema),
  nextCursor: z.string().nullable(),
});
export type FeedEntryAdminList = z.infer<typeof FeedEntryAdminListSchema>;
