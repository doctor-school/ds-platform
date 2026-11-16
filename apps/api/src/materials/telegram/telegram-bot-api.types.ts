import { z } from "zod";

// 048 slice 2 (ADR-0011 §2.2 channel #10) — the typed surface of the Telegram
// Bot API the platform uses: exactly the six methods of the channel row plus
// the file download. `telegram-bot-api.client.ts` is its only real
// implementation (the only code that calls `api.telegram.org`);
// `telegram-bot-api.fake.ts` is the test double.

/** DI token of the {@link TelegramBotApi}. */
export const TELEGRAM_BOT_API = Symbol("TELEGRAM_BOT_API");

/** The update types the webhook is registered for (EARS-24). */
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

export const SetWebhookParamsSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }),
  secret_token: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  allowed_updates: z.array(z.enum(TELEGRAM_ALLOWED_UPDATES)).min(1),
  drop_pending_updates: z.boolean(),
});
export type SetWebhookParams = z.infer<typeof SetWebhookParamsSchema>;

export const FileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);

/** A `file_path` as `getFile` returns it — never a traversal. */
export const FilePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_\-./]+$/)
  .refine((p) => !p.split("/").includes(".."), "no traversal");

// ── Responses (validated; unknown fields stripped) ──────────────────────────

export const WebhookInfoSchema = z.object({
  url: z.string(),
  pending_update_count: z.number().int().nonnegative(),
  last_error_date: z.number().int().optional(),
  last_error_message: z.string().optional(),
  allowed_updates: z.array(z.string()).optional(),
});
export type WebhookInfo = z.infer<typeof WebhookInfoSchema>;

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

/** The connector is off: no token or secret is configured (the kill switch). */
export class TelegramNotConfiguredError extends Error {
  constructor() {
    super("Telegram connector is not configured");
    this.name = "TelegramNotConfiguredError";
  }
}

export interface TelegramBotApi {
  setWebhook(params: SetWebhookParams): Promise<void>;
  getWebhookInfo(): Promise<WebhookInfo>;
  getMe(): Promise<BotUser>;
  getChat(chat: TelegramChatRef): Promise<ChatInfo>;
  getChatMember(chat: TelegramChatRef, userId: number): Promise<ChatMemberInfo>;
  getFile(fileId: string): Promise<TelegramFile>;
  /** Download a `getFile` path, refusing a body over `maxBytes`. */
  downloadFile(filePath: string, maxBytes?: number): Promise<Buffer>;
}
