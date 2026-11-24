import { z } from "zod";

// 048 slice 3 (ADR-0011 §2.2 channel #11 «VK API») — the typed surface of the
// VK API the platform uses: exactly `wall.get` and `groups.getById`, plus the
// VK objects the Callback delivers (`wall_post_new`, `video_new`).
// `vk-api.client.ts` is its only real implementation (the only code that calls
// `api.vk.com`); `vk-api.fake.ts` is the test double. The object schemas keep
// only card fields — `created_by`, `signer_id`, `from_id`, counters and the
// player URL are stripped at the parse, so no code past it can store them
// (EARS-51).

/** DI token of the {@link VkApi}. */
export const VK_API = Symbol("VK_API");

/**
 * The pinned API version (048-design «Callback»): set to the same value in the
 * community's Callback settings, so Callback and `wall.get` objects validate
 * against one schema.
 */
export const VK_API_VERSION = "5.199";

/** EARS-45 — the reconcile and import page size of `wall.get`. */
export const VK_WALL_PAGE = 100;

// ── Parameters (built from server config and the source list only) ──────────

export const VkGroupIdSchema = z.number().int().positive().max(2 ** 53 - 1);

/** `groups.getById` — a bound community id, or the stored screen name. */
export const VkGroupRefSchema = z.union([
  VkGroupIdSchema,
  z.string().regex(/^[a-z0-9_.]{2,32}$/),
]);
export type VkGroupRef = z.infer<typeof VkGroupRefSchema>;

/** `wall.get` (EARS-45, EARS-46): the community's own posts, one page. */
export const WallGetParamsSchema = z.strictObject({
  owner_id: z.number().int().negative(),
  filter: z.literal("owner"),
  count: z.number().int().min(1).max(VK_WALL_PAGE),
  offset: z.number().int().min(0).optional(),
});
export type WallGetParams = z.infer<typeof WallGetParamsSchema>;

// ── VK objects (validated; unknown fields stripped) ─────────────────────────

const VkFlagSchema = z
  .union([z.boolean(), z.number().int()])
  .transform((v) => v === true || v === 1);

export const VkImageSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative().optional(),
});
export type VkImage = z.infer<typeof VkImageSchema>;

/** A photo attachment's `photo` — only its sizes are read (EARS-41). */
export const VkPhotoSchema = z.object({
  id: z.number().int(),
  owner_id: z.number().int(),
  sizes: z.array(VkImageSchema).default([]),
});

/**
 * A VK video — the `video_new` object and a video attachment of a post. Only
 * the card fields are kept (EARS-42); the player URL is never read.
 */
export const VkVideoSchema = z.object({
  id: z.number().int().positive(),
  owner_id: z.number().int(),
  title: z.string().default(""),
  date: z.number().int().nonnegative().optional(),
  duration: z.number().int().nonnegative().optional(),
  image: z.array(VkImageSchema).default([]),
  type: z.string().optional(),
  live: VkFlagSchema.optional(),
});
export type VkVideo = z.infer<typeof VkVideoSchema>;

/** One attachment; types other than photo and video are kept as their type only. */
export const VkAttachmentSchema = z.union([
  z.object({ type: z.literal("photo"), photo: VkPhotoSchema }),
  z.object({ type: z.literal("video"), video: VkVideoSchema }),
  z.object({ type: z.string() }).transform((a) => ({ type: a.type })),
]);
export type VkAttachment = z.infer<typeof VkAttachmentSchema>;

/**
 * A wall post as `wall_post_new` and `wall.get` deliver it. `created_by`,
 * `signer_id` and `from_id` are not in the schema, so the parse strips them
 * (EARS-51).
 */
export const VkWallPostSchema = z.object({
  id: z.number().int().positive(),
  owner_id: z.number().int(),
  date: z.number().int().nonnegative(),
  text: z.string().default(""),
  post_type: z.string().default("post"),
  copy_history: z.array(z.unknown()).default([]),
  attachments: z.array(VkAttachmentSchema).default([]),
  is_pinned: VkFlagSchema.optional(),
});
export type VkWallPost = z.infer<typeof VkWallPostSchema>;

/** `wall.get` → `{ count, items }`; an item that does not validate is reported, not fatal. */
export const WallGetResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(z.unknown()),
});
export interface WallPage {
  count: number;
  items: unknown[];
}

/** One community of `groups.getById`. */
export const VkGroupSchema = z.object({
  id: z.number().int().positive(),
  screen_name: z.string().optional(),
  deactivated: z.string().optional(),
});
export type VkGroup = z.infer<typeof VkGroupSchema>;

/** `groups.getById` answers `{ groups: [...] }` from 5.194 and a bare list before. */
export const GroupsGetByIdResponseSchema = z
  .union([
    z.object({ groups: z.array(VkGroupSchema) }),
    z.array(VkGroupSchema),
  ])
  .transform((r) => (Array.isArray(r) ? r : r.groups));

/** How one VK API call ended — the `outcome` of its log line (EARS-51). */
export type VkCallOutcome =
  | "ok"
  | "api_error"
  | "http_error"
  | "timeout"
  | "network_error"
  | "invalid_response";

/**
 * A failed VK API call. Carries the method, the HTTP status, the outcome and
 * VK's numeric error code — never a URL, a body or VK's error text, so never
 * the service key (EARS-51).
 */
export class VkApiError extends Error {
  constructor(
    readonly method: string,
    readonly outcome: Exclude<VkCallOutcome, "ok">,
    readonly httpStatus: number | null,
    readonly errorCode: number | null,
  ) {
    super(
      `VK ${method} failed: ${outcome}${errorCode === null ? "" : ` (error ${errorCode})`}`,
    );
    this.name = "VkApiError";
  }
}

/** The connector is off: a VK secret is not configured (the kill switch). */
export class VkNotConfiguredError extends Error {
  constructor() {
    super("VK connector is not configured");
    this.name = "VkNotConfiguredError";
  }
}

/** VK's error codes that mean «VK could not serve the call now». */
const VK_TRANSIENT_ERROR_CODES = new Set([1, 6, 9, 10, 29]);

/** A VK API failure that means VK could not be reached or serve now. */
export function vkUnreachable(error: unknown): boolean {
  if (!(error instanceof VkApiError)) return false;
  if (error.outcome === "api_error") {
    return (
      error.errorCode !== null && VK_TRANSIENT_ERROR_CODES.has(error.errorCode)
    );
  }
  return (
    error.outcome !== "http_error" ||
    error.httpStatus === null ||
    error.httpStatus >= 500
  );
}

/** VK's «authorization failed» — the service key is not accepted. */
export const VK_AUTH_FAILED = 5;

export interface VkApi {
  wallGet(params: WallGetParams): Promise<WallPage>;
  groupsGetById(group: VkGroupRef): Promise<VkGroup[]>;
}

/** The monthly call counter the client increments before each call (EARS-44). */
export interface VkCallCounter {
  count(): Promise<void>;
}
