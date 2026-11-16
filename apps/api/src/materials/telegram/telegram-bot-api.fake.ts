import {
  TelegramBotApiError,
  type BotUser,
  type TelegramCallOutcome,
  type ChatInfo,
  type ChatMemberInfo,
  type SetWebhookParams,
  type TelegramBotApi,
  type TelegramChatRef,
  type TelegramFile,
  type WebhookInfo,
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
  me: BotUser = { id: 7_000_000_001, is_bot: true, username: "ds_test_bot" };
  webhook: WebhookInfo = { url: "", pending_update_count: 0 };
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
    this.webhook = { url: "", pending_update_count: 0 };
  }

  async setWebhook(params: SetWebhookParams): Promise<void> {
    this.calls.push({ method: "setWebhook", args: [params] });
    this.down("setWebhook");
    this.webhook = {
      url: params.url,
      pending_update_count: 0,
      allowed_updates: [...params.allowed_updates],
    };
  }

  async getWebhookInfo(): Promise<WebhookInfo> {
    this.calls.push({ method: "getWebhookInfo", args: [] });
    this.down("getWebhookInfo");
    return this.webhook;
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
