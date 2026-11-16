import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { FeedSource } from "@ds/db";
import { FeedSourcesRepository } from "../feed-sources.repository.js";
import {
  TELEGRAM_BOT_API,
  TelegramBotApiError,
  type ChatInfo,
  type TelegramBotApi,
  type TelegramChatRef,
} from "./telegram-bot-api.types.js";
import { TELEGRAM_CONFIG, type TelegramConfig } from "./telegram-config.js";

// 048 EARS-31 (#3994) — the source check (048-design «Source check
// (EARS-31)»): hourly for every switched-on Telegram source, and at once on
// add / address edit / switch-on (EARS-21, run by `FeedSourcesService` after
// its transaction commits). It reads the webhook state (`getWebhookInfo`),
// the channel (`getChat` — by the bound id, else `@<address>`) and the bot's
// membership (`getChatMember(chat, getMe().id)`), and writes «Работает» or
// «Ошибка» with ONE reason, in the table's order, plus the check time. While
// the source has no bound Telegram id, a channel whose `username` equals the
// address ignoring case binds its id in the same write as the status, so a
// newly added source is bound before any import (EARS-30). A check changes
// no entry. Telegram's own error text goes to the log line (method and
// outcome only — EARS-36), never to the admin.

/** The fixed failing reasons of EARS-31 — the admin reads them verbatim. */
export const SOURCE_CHECK_REASONS = {
  notConfigured: "Telegram не подключён на сервере",
  channelNotFound: "Канал не найден или бот не добавлен в канал",
  notAMember: "Бот не состоит в канале",
  webhookNotRegistered: "Вебхук Telegram не зарегистрирован",
  cannotDeliver: "Telegram не может доставить новые посты",
  unreachable: "Telegram недоступен",
} as const;

/** «Адрес канала изменился на t.me/<имя>». */
export function addressChangedReason(username: string): string {
  return `Адрес канала изменился на t.me/${username}`;
}

/** The membership statuses that receive channel posts (Lead decision 5). */
const MEMBER_STATUSES = new Set(["administrator", "member"]);

/** «within the last hour» of `getWebhookInfo.last_error_date`. */
const DELIVERY_ERROR_WINDOW_MS = 60 * 60 * 1000;

export interface SourceCheckVerdict {
  status: "ok" | "failing";
  statusReason: string | null;
  bindChatId: number | null;
}

/** A Bot API failure that means Telegram could not be reached. */
function unreachable(error: unknown): boolean {
  if (!(error instanceof TelegramBotApiError)) return false;
  return (
    error.outcome === "timeout" ||
    error.outcome === "network_error" ||
    error.outcome === "invalid_response" ||
    (error.outcome === "http_error" &&
      (error.httpStatus === null || error.httpStatus >= 500))
  );
}

/** Telegram answered «no» to the call (not a transport failure). */
function refused(error: unknown): boolean {
  return error instanceof TelegramBotApiError && !unreachable(error);
}

const failing = (
  statusReason: string,
  bindChatId: number | null = null,
): SourceCheckVerdict => ({ status: "failing", statusReason, bindChatId });

@Injectable()
export class TelegramSourceCheck {
  private readonly logger = new Logger("TelegramSourceCheck");

  // Explicit @Inject tokens — the endpoint-authz gate boots this graph under
  // `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig | null,
    @Inject(TELEGRAM_BOT_API) private readonly telegram: TelegramBotApi,
    @Inject(FeedSourcesRepository)
    private readonly sources: FeedSourcesRepository,
  ) {}

  /** EARS-31 — the hourly check of every switched-on Telegram source. */
  @Cron(CronExpression.EVERY_HOUR)
  async checkAll(): Promise<void> {
    try {
      const ids = await this.sources.enabledTelegramSourceIds();
      for (const id of ids) await this.check(id);
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "telegram_source_check_run_failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }

  /**
   * EARS-21 / EARS-31 — check one source and write the verdict. Returns the
   * written row, or undefined when the source is not a switched-on Telegram
   * source (or changed while it was checked). Never throws.
   */
  async check(id: string): Promise<FeedSource | undefined> {
    try {
      const source = await this.sources.findById(id);
      if (!source || source.platform !== "telegram" || !source.enabled) {
        return undefined;
      }
      const verdict = await this.judge(source);
      const row = await this.sources.transaction((tx) =>
        this.sources.writeCheck(tx, source.id, source.address, {
          ...verdict,
          checkedAt: new Date(),
        }),
      );
      this.logger.log(
        JSON.stringify({
          event: "telegram_source_checked",
          sourceId: source.id,
          status: verdict.status,
          bound: verdict.bindChatId !== null,
          applied: row !== undefined,
        }),
      );
      return row;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: "telegram_source_check_failed",
          sourceId: id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      return undefined;
    }
  }

  /** The verdict of the check table, first failing row wins. */
  private async judge(source: FeedSource): Promise<SourceCheckVerdict> {
    const config = this.config;
    if (config === null) return failing(SOURCE_CHECK_REASONS.notConfigured);
    try {
      const webhook = await this.telegram.getWebhookInfo();
      if (config.webhookUrl === null || webhook.url !== config.webhookUrl) {
        return failing(SOURCE_CHECK_REASONS.webhookNotRegistered);
      }
      const bound =
        source.telegramChatId === null ? null : Number(source.telegramChatId);
      const ref: TelegramChatRef = bound ?? `@${source.address}`;
      let chat: ChatInfo;
      try {
        chat = await this.telegram.getChat(ref);
      } catch (error) {
        if (!refused(error)) throw error;
        this.note(source.id, error);
        return failing(SOURCE_CHECK_REASONS.channelNotFound);
      }
      const name = chat.username?.toLowerCase() ?? null;
      // Bind only while unbound, and only a channel answering to the address.
      const bindChatId =
        bound === null && name === source.address ? chat.id : null;
      const me = await this.telegram.getMe();
      let memberStatus: string | null;
      try {
        memberStatus = (await this.telegram.getChatMember(chat.id, me.id))
          .status;
      } catch (error) {
        if (!refused(error)) throw error;
        this.note(source.id, error);
        memberStatus = null;
      }
      if (memberStatus === null || !MEMBER_STATUSES.has(memberStatus)) {
        return failing(SOURCE_CHECK_REASONS.notAMember, bindChatId);
      }
      if (name === null) {
        // The channel lost its public username: no `t.me/<имя>` to name.
        return failing(SOURCE_CHECK_REASONS.channelNotFound, bindChatId);
      }
      if (name !== source.address) {
        return failing(addressChangedReason(name), bindChatId);
      }
      if (
        webhook.last_error_date !== undefined &&
        Date.now() - webhook.last_error_date * 1000 < DELIVERY_ERROR_WINDOW_MS
      ) {
        return failing(SOURCE_CHECK_REASONS.cannotDeliver, bindChatId);
      }
      return { status: "ok", statusReason: null, bindChatId };
    } catch (error) {
      this.note(source.id, error);
      if (unreachable(error)) return failing(SOURCE_CHECK_REASONS.unreachable);
      // `getWebhookInfo` / `getMe` refused: the token is not accepted.
      if (refused(error)) return failing(SOURCE_CHECK_REASONS.notConfigured);
      throw error;
    }
  }

  /** EARS-36 — the Bot API failure: method, HTTP status and outcome only. */
  private note(sourceId: string, error: unknown): void {
    if (!(error instanceof TelegramBotApiError)) return;
    this.logger.warn(
      JSON.stringify({
        event: "telegram_source_check_call_failed",
        sourceId,
        method: error.method,
        httpStatus: error.httpStatus,
        outcome: error.outcome,
      }),
    );
  }
}
