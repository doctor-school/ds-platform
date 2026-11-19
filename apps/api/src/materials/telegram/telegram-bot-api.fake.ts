import {
  TelegramBotApiError,
  type BotUser,
  type TelegramCallOutcome,
  type ChatInfo,
  type ChatMemberInfo,
  type GetUpdatesParams,
  type RawUpdate,
  type TelegramBotApi,
  type TelegramCallOptions,
  type TelegramChatRef,
  type TelegramFile,
} from "./telegram-bot-api.types.js";

/**
 * In-memory {@link TelegramBotApi} — the test double of ADR-0011 channel #10
 * (048 V-15, V-16, V-19). Records every call by method so a suite can assert
 * exactly what reached "Telegram" (or that nothing did), and answers from
 * the tables a suite fills. Contract parity: an unknown chat, member or file
 * fails with the same {@link TelegramBotApiError} the real client throws.
 */
export class FakeTelegramBotApi implements TelegramBotApi {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly chats = new Map<string, ChatInfo>();
  readonly members = new Map<string, ChatMemberInfo>();
  readonly files = new Map<string, TelegramFile>();
  readonly downloads = new Map<string, Buffer>();
  /**
   * A bot id of its own per double, so the poller's stored offset of one
   * suite (keyed by the bot id) never hides another suite's updates.
   */
  me: BotUser = {
    id: 7_000_000_000 + Math.floor(Math.random() * 999_999_999),
    is_bot: true,
    username: "ds_test_bot",
  };
  /**
   * The updates Telegram holds for the bot (kept until a `getUpdates` with a
   * higher `offset` confirms them), as a suite queues them with {@link push}.
   */
  readonly pending: RawUpdate[] = [];
  /** A webhook is set: `getUpdates` answers 409 until `deleteWebhook`. */
  webhookUrl = "";
  private wake: (() => void) | null = null;
  /**
   * While set, every call fails with this transport outcome after being
   * recorded — "Telegram is unreachable" (EARS-31).
   */
  outage: Extract<TelegramCallOutcome, "timeout" | "network_error"> | null =
    null;

  reset(): void {
    this.outage = null;
    this.calls.length = 0;
    this.chats.clear();
    this.members.clear();
    this.files.clear();
    this.downloads.clear();
    this.pending.length = 0;
    this.webhookUrl = "";
  }

  /** Telegram receives new updates for the bot. */
  push(...updates: RawUpdate[]): void {
    this.pending.push(...updates);
    this.wake?.();
  }

  /**
   * Telegram's long poll: confirms every held update below `offset`, then
   * answers the rest at once, or — none held — waits until one arrives or the
   * call is stopped (an empty answer), as the real long poll does.
   */
  async getUpdates(
    params: GetUpdatesParams,
    options: TelegramCallOptions = {},
  ): Promise<RawUpdate[]> {
    this.calls.push({ method: "getUpdates", args: [params] });
    this.down("getUpdates");
    if (this.webhookUrl !== "") {
      throw new TelegramBotApiError(
        "getUpdates",
        "api_error",
        409,
        "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
      );
    }
    const kept = this.pending.filter((u) => u.update_id >= params.offset);
    this.pending.splice(0, this.pending.length, ...kept);
    if (this.pending.length === 0 && params.timeout > 0 && options.signal) {
      const signal = options.signal;
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        this.wake = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      this.wake = null;
    }
    return this.pending.slice(0, params.limit);
  }

  async deleteWebhook(): Promise<void> {
    this.calls.push({ method: "deleteWebhook", args: [] });
    this.down("deleteWebhook");
    this.webhookUrl = "";
  }

  async getMe(): Promise<BotUser> {
    this.calls.push({ method: "getMe", args: [] });
    this.down("getMe");
    return this.me;
  }

  async getChat(chat: TelegramChatRef): Promise<ChatInfo> {
    this.calls.push({ method: "getChat", args: [chat] });
    this.down("getChat");
    const found = this.chats.get(String(chat));
    if (!found) {
      throw new TelegramBotApiError(
        "getChat",
        "api_error",
        400,
        "chat not found",
      );
    }
    return found;
  }

  async getChatMember(
    chat: TelegramChatRef,
    userId: number,
  ): Promise<ChatMemberInfo> {
    this.calls.push({ method: "getChatMember", args: [chat, userId] });
    this.down("getChatMember");
    const found = this.members.get(`${String(chat)}:${userId}`);
    if (!found) {
      throw new TelegramBotApiError(
        "getChatMember",
        "api_error",
        400,
        "member not found",
      );
    }
    return found;
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    this.calls.push({ method: "getFile", args: [fileId] });
    this.down("getFile");
    const found = this.files.get(fileId);
    if (!found) {
      throw new TelegramBotApiError(
        "getFile",
        "api_error",
        400,
        "file not found",
      );
    }
    return found;
  }

  async downloadFile(filePath: string, maxBytes?: number): Promise<Buffer> {
    this.calls.push({ method: "downloadFile", args: [filePath, maxBytes] });
    this.down("downloadFile");
    const found = this.downloads.get(filePath);
    if (!found) {
      throw new TelegramBotApiError("downloadFile", "http_error", 404, null);
    }
    if (maxBytes !== undefined && found.length > maxBytes) {
      throw new TelegramBotApiError("downloadFile", "too_large", 200, null);
    }
    return found;
  }

  private down(method: string): void {
    if (this.outage) {
      throw new TelegramBotApiError(method, this.outage, null, null);
    }
  }
}
