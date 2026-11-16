import { Logger } from "@nestjs/common";
import { z } from "zod";
import {
  BotUserSchema,
  ChatInfoSchema,
  ChatMemberSchema,
  FileIdSchema,
  FilePathSchema,
  SetWebhookParamsSchema,
  TELEGRAM_FILE_MAX_BYTES,
  TelegramBotApiError,
  TelegramChatRefSchema,
  TelegramFileSchema,
  TelegramNotConfiguredError,
  WebhookInfoSchema,
  type BotUser,
  type ChatInfo,
  type ChatMemberInfo,
  type SetWebhookParams,
  type TelegramBotApi,
  type TelegramCallOutcome,
  type TelegramChatRef,
  type TelegramFile,
  type WebhookInfo,
} from "./telegram-bot-api.types.js";

// 048 slice 2 — ADR-0011 §2.2 channel #10 «Telegram Bot API». THE ONLY code
// that calls `https://api.telegram.org` (048-design §Egress). Sanitizer: only
// the typed methods below, parameters Zod-checked before any request (built
// from server config and the source list), every response Zod-checked. The
// token rides in the URL path, so no URL is ever logged or thrown: a failure
// surfaces as a `TelegramBotApiError` carrying the method, status and outcome
// only, and a transport error's own message (which may quote the URL) is
// dropped. Audit: one structured line per call — method, HTTP status,
// duration, outcome (EARS-36). Kill switch: no token → no call.

const API_ORIGIN = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

/** The structured log line sink; the Nest logger in production. */
export interface TelegramCallLogger {
  log(line: Record<string, unknown>): void;
  warn(line: Record<string, unknown>): void;
}

export interface TelegramBotApiClientOptions {
  fetchImpl?: FetchLike;
  logger?: TelegramCallLogger;
  timeoutMs?: number;
}

const EnvelopeSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error_code: z.number().int().optional(),
    description: z.string().optional(),
  }),
]);

function nestLogger(): TelegramCallLogger {
  const logger = new Logger("TelegramBotApi");
  return {
    log: (line) => logger.log(JSON.stringify(line)),
    warn: (line) => logger.warn(JSON.stringify(line)),
  };
}

export class TelegramBotApiClient implements TelegramBotApi {
  private readonly fetchImpl: FetchLike;
  private readonly logger: TelegramCallLogger;
  private readonly timeoutMs: number;

  constructor(
    private readonly token: string | null,
    options: TelegramBotApiClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
    this.logger = options.logger ?? nestLogger();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async setWebhook(params: SetWebhookParams): Promise<void> {
    const body = SetWebhookParamsSchema.parse(params);
    await this.call("setWebhook", body, z.literal(true));
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    return this.call("getWebhookInfo", {}, WebhookInfoSchema);
  }

  async getMe(): Promise<BotUser> {
    return this.call("getMe", {}, BotUserSchema);
  }

  async getChat(chat: TelegramChatRef): Promise<ChatInfo> {
    const chat_id = TelegramChatRefSchema.parse(chat);
    return this.call("getChat", { chat_id }, ChatInfoSchema);
  }

  async getChatMember(
    chat: TelegramChatRef,
    userId: number,
  ): Promise<ChatMemberInfo> {
    const chat_id = TelegramChatRefSchema.parse(chat);
    const user_id = z.number().int().positive().parse(userId);
    return this.call("getChatMember", { chat_id, user_id }, ChatMemberSchema);
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    const file_id = FileIdSchema.parse(fileId);
    return this.call("getFile", { file_id }, TelegramFileSchema);
  }

  async downloadFile(
    filePath: string,
    maxBytes: number = TELEGRAM_FILE_MAX_BYTES,
  ): Promise<Buffer> {
    const path = FilePathSchema.parse(filePath);
    const token = this.requireToken();
    const method = "downloadFile";
    const started = Date.now();
    let status: number | null = null;
    try {
      const res = await this.fetchImpl(
        `${API_ORIGIN}/file/bot${token}/${path}`,
        {
          method: "GET",
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      status = res.status;
      if (!res.ok) throw this.fail(method, "http_error", status, null, started);
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) {
        await res.body?.cancel();
        throw this.fail(method, "too_large", status, null, started);
      }
      const bytes = await this.readCapped(res, maxBytes);
      if (bytes === null)
        throw this.fail(method, "too_large", status, null, started);
      this.record(method, status, started, "ok");
      return bytes;
    } catch (error) {
      if (error instanceof TelegramBotApiError) throw error;
      throw this.fail(method, transportOutcome(error), status, null, started);
    }
  }

  private requireToken(): string {
    if (!this.token) throw new TelegramNotConfiguredError();
    return this.token;
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    resultSchema: z.ZodType<T>,
  ): Promise<T> {
    const token = this.requireToken();
    const started = Date.now();
    let status: number | null = null;
    let payload: unknown;
    try {
      const res = await this.fetchImpl(`${API_ORIGIN}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = res.status;
      payload = await res.json().catch(() => undefined);
    } catch (error) {
      throw this.fail(method, transportOutcome(error), status, null, started);
    }
    const envelope = EnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      throw this.fail(
        method,
        status !== null && status >= 400 ? "http_error" : "invalid_response",
        status,
        null,
        started,
      );
    }
    if (!envelope.data.ok) {
      throw this.fail(
        method,
        "api_error",
        status,
        envelope.data.description ?? null,
        started,
      );
    }
    const result = resultSchema.safeParse(envelope.data.result);
    if (!result.success) {
      throw this.fail(method, "invalid_response", status, null, started);
    }
    this.record(method, status, started, "ok");
    return result.data;
  }

  /** Read the body, stopping (null) once it passes `maxBytes`. */
  private async readCapped(
    res: Response,
    maxBytes: number,
  ): Promise<Buffer | null> {
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  private record(
    method: string,
    httpStatus: number | null,
    started: number,
    outcome: TelegramCallOutcome,
  ): void {
    const line = {
      event: "telegram_bot_api_call",
      method,
      httpStatus,
      durationMs: Date.now() - started,
      outcome,
    };
    if (outcome === "ok") this.logger.log(line);
    else this.logger.warn(line);
  }

  private fail(
    method: string,
    outcome: Exclude<TelegramCallOutcome, "ok">,
    httpStatus: number | null,
    description: string | null,
    started: number,
  ): TelegramBotApiError {
    this.record(method, httpStatus, started, outcome);
    return new TelegramBotApiError(
      method,
      outcome,
      httpStatus,
      description === null ? null : redact(description, this.token),
    );
  }
}

function transportOutcome(error: unknown): "timeout" | "network_error" {
  return error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
    ? "timeout"
    : "network_error";
}

/** Belt and braces: a token never survives into a string we keep. */
function redact(text: string, token: string | null): string {
  return token ? text.split(token).join("<redacted>") : text;
}
