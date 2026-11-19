import { z } from "zod";

// 048 slice 2 (ADR-0011 §2.2 channel #10) — the typed surface of the Telegram
// Bot API the platform uses: exactly the six methods of the channel row plus
// the file download. `telegram-bot-api.client.ts` is its only real
// implementation (the only code that calls `api.telegram.org`);
// `telegram-bot-api.fake.ts` is the test double.

/** DI token of the {@link TelegramBotApi}. */
export const TELEGRAM_BOT_API = Symbol("TELEGRAM_BOT_API");

/** The update types the poller asks `getUpdates` for (EARS-24). */
export const TELEGRAM_ALLOWED_UPDATES = [
  "channel_post",
  "edited_channel_post",
] as const;

/** `getFile` serves files up to 20 MB (Lead decision 4, EARS-29). */
export const TELEGRAM_FILE_MAX_BYTES = 20 * 1024 * 1024;

// ── Parameters (built from server config and the source list only) ──────────

export const TelegramChatRefSchema = z.union([
  z.number().int(),
  z.string().regex(/^@[A-Za-z][A-Za-z0-9_]{4,31}$/),
]);
export type TelegramChatRef = z.infer<typeof TelegramChatRefSchema>;

/**
 * `getUpdates` (EARS-24): the long poll. `timeout` is Telegram's long-poll
 * wait in seconds (at most 50 here); the HTTP timeout of the call exceeds it.
 */
export const GetUpdatesParamsSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  timeout: z.number().int().min(0).max(50),
  allowed_updates: z.array(z.enum(TELEGRAM_ALLOWED_UPDATES)).min(1),
});
export type GetUpdatesParams = z.infer<typeof GetUpdatesParamsSchema>;

/** `deleteWebhook` (EARS-24): pending updates are always kept. */
export const DeleteWebhookParamsSchema = z.strictObject({
  drop_pending_updates: z.literal(false),
});

export const FileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);

/** A `file_path` as `getFile` returns it — never a traversal. */
export const FilePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_\-./]+$/)
  .refine((p) => !p.split("/").includes(".."), "no traversal");

// ── Responses (validated; unknown fields stripped) ──────────────────────────

/**
 * One `Update` as `getUpdates` returns it: only its `update_id` is checked
 * here — the offset needs it; the rest is the feed source's own validation
 * (`telegram-update.schema.ts`, EARS-25), so a malformed body is dropped
 * there and still confirmed.
 */
export const RawUpdateSchema = z
  .object({ update_id: z.number().int().nonnegative() })
  .passthrough();
export type RawUpdate = z.infer<typeof RawUpdateSchema>;

export const BotUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.literal(true),
  username: z.string().optional(),
});
export type BotUser = z.infer<typeof BotUserSchema>;

export const ChatInfoSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  username: z.string().optional(),
});
export type ChatInfo = z.infer<typeof ChatInfoSchema>;

export const ChatMemberSchema = z.object({
  status: z.string(),
});
export type ChatMemberInfo = z.infer<typeof ChatMemberSchema>;

export const TelegramFileSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  file_size: z.number().int().nonnegative().optional(),
  file_path: z.string().optional(),
});
export type TelegramFile = z.infer<typeof TelegramFileSchema>;

/** How one Bot API call ended — the `outcome` of its log line (EARS-36). */
export type TelegramCallOutcome =
  | "ok"
  | "api_error"
  | "http_error"
  | "timeout"
  /** The caller's own signal cut the call short (the poller stopping). */
  | "aborted"
  | "network_error"
  | "invalid_response"
  | "too_large";

/**
 * A failed Bot API call. Carries the method, the HTTP status, the outcome and
 * Telegram's own `description` — never a URL, so never the token (EARS-36).
 */
export class TelegramBotApiError extends Error {
  constructor(
    readonly method: string,
    readonly outcome: Exclude<TelegramCallOutcome, "ok">,
    readonly httpStatus: number | null,
    readonly description: string | null,
  ) {
    super(
      `Telegram ${method} failed: ${outcome}${httpStatus === null ? "" : ` (HTTP ${httpStatus})`}`,
    );
    this.name = "TelegramBotApiError";
  }
}

/** The connector is off: no bot token is configured (the kill switch). */
export class TelegramNotConfiguredError extends Error {
  constructor() {
    super("Telegram connector is not configured");
    this.name = "TelegramNotConfiguredError";
  }
}

/** Per-call options of the long poll: its HTTP timeout and a stop signal. */
export interface TelegramCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface TelegramBotApi {
  getUpdates(
    params: GetUpdatesParams,
    options?: TelegramCallOptions,
  ): Promise<RawUpdate[]>;
  deleteWebhook(): Promise<void>;
  getMe(): Promise<BotUser>;
  getChat(chat: TelegramChatRef): Promise<ChatInfo>;
  getChatMember(chat: TelegramChatRef, userId: number): Promise<ChatMemberInfo>;
  getFile(fileId: string): Promise<TelegramFile>;
  /** Download a `getFile` path, refusing a body over `maxBytes`. */
  downloadFile(filePath: string, maxBytes?: number): Promise<Buffer>;
}
