import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type pg from "pg";
import { DRIZZLE_POOL } from "../../database/database.tokens.js";
import { TelegramFeedSource } from "./telegram.feed-source.js";
import {
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_BOT_API,
  TelegramBotApiError,
  type RawUpdate,
  type TelegramBotApi,
} from "./telegram-bot-api.types.js";
import { TELEGRAM_CONFIG, type TelegramConfig } from "./telegram-config.js";
import { TelegramPreviewService } from "./telegram-preview.service.js";
import { TelegramUpdateCursorRepository } from "./telegram-update-cursor.repository.js";

// 048 EARS-24, EARS-25 (#4165) — Telegram ingress by long polling (ADR-0011
// §2.2 channel #10: egress only, no inbound route). The hosting cannot be
// reached by Telegram, so the API asks for updates instead of receiving them:
//
//  - WHILE the bot token is configured, one loop per process long-polls
//    `getUpdates` for channel posts and their edits. Only the process holding
//    a session-level Postgres advisory lock polls, so one API instance at a
//    time does; the others wait and retry the lock.
//  - Before its first poll the poller deletes any webhook (`getUpdates` and
//    a webhook are mutually exclusive), keeping the pending updates; a 409
//    from `getUpdates` deletes it again.
//  - Each update goes through `TelegramFeedSource.receive` (its own
//    transaction), then the stored offset moves past it, then a pending
//    preview gets its one copy attempt (EARS-29). A processing failure stops
//    the batch WITHOUT moving the offset, so the next poll fetches the update
//    again; every write is idempotent, so a refetch changes nothing.
//  - A failed or timed-out call is retried after a capped exponential
//    backoff. WHILE the token is unset no loop runs and nothing is called.
// Log lines carry ids, stages and error names only — never a payload or the
// token (EARS-36).

/** Telegram's long-poll wait per `getUpdates`, seconds (its maximum is 50). */
export const TELEGRAM_POLL_TIMEOUT_S = 50;
/** The HTTP timeout of one long poll — longer than Telegram's own wait. */
export const TELEGRAM_POLL_HTTP_TIMEOUT_MS = (TELEGRAM_POLL_TIMEOUT_S + 15) * 1000;
/** Updates per `getUpdates` answer (the Bot API maximum). */
export const TELEGRAM_POLL_LIMIT = 100;
/** How long a process that does not hold the poller lock waits to retry it. */
export const TELEGRAM_POLL_LOCK_RETRY_MS = 30_000;
const LOCK_KEY = "telegram-update-poller";

/** EARS-24 — the wait after the n-th failure in a row: 1 s doubling to 60 s. */
export function telegramPollBackoffMs(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures - 1), 60_000);
}

export type TelegramPollOutcome =
  /** No bot token: the connector is off, nothing was called. */
  | { kind: "off" }
  /** Another process holds the poller lock; nothing was called. */
  | { kind: "not_leader" }
  /** The poller is stopping; the long poll was cut short. */
  | { kind: "stopped" }
  | { kind: "polled"; processed: number }
  | { kind: "failed"; stage: "telegram" | "processing"; processed: number };

@Injectable()
export class TelegramUpdatePoller
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("TelegramUpdatePoller");
  private lockClient: pg.PoolClient | null = null;
  private botId: number | null = null;
  private abort = new AbortController();
  private loop: Promise<void> | null = null;
  private stopping = false;

  // Explicit @Inject tokens — the root-level authz gate boots this graph
  // under `tsx`, which emits no `design:paramtypes`.
  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: TelegramConfig | null,
    @Inject(TELEGRAM_BOT_API) private readonly telegram: TelegramBotApi,
    @Inject(TelegramFeedSource) private readonly feed: TelegramFeedSource,
    @Inject(TelegramPreviewService)
    private readonly previews: TelegramPreviewService,
    @Inject(TelegramUpdateCursorRepository)
    private readonly cursor: TelegramUpdateCursorRepository,
    @Inject(DRIZZLE_POOL) private readonly pool: pg.Pool,
  ) {}

  onApplicationBootstrap(): void {
    this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** Whether the polling loop runs in this process. */
  get running(): boolean {
    return this.loop !== null;
  }

  /** Start the loop — a no-op while the token is unset or it already runs. */
  start(): void {
    if (!this.config || this.loop) return;
    this.stopping = false;
    this.loop = this.run();
  }

  /** Stop the loop, cutting the long poll short, and release the lock. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.abort.abort();
    await this.loop;
    this.loop = null;
    this.abort = new AbortController();
    await this.releaseLock();
  }

  /**
   * One poll: take (or keep) the lock, fetch what Telegram holds from the
   * stored offset and process it in order. The loop calls it; it never throws.
   */
  async pollOnce(): Promise<TelegramPollOutcome> {
    if (!this.config) return { kind: "off" };
    const signal = this.abort.signal;
    let botId: number;
    let updates: RawUpdate[];
    try {
      if (!(await this.holdLock())) return { kind: "not_leader" };
      if (this.botId === null) {
        const me = await this.telegram.getMe();
        await this.telegram.deleteWebhook();
        this.botId = me.id;
      }
      botId = this.botId;
      const offset = await this.cursor.nextOffset(botId);
      updates = await this.telegram.getUpdates(
        {
          offset,
          limit: TELEGRAM_POLL_LIMIT,
          timeout: TELEGRAM_POLL_TIMEOUT_S,
          allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
        },
        { timeoutMs: TELEGRAM_POLL_HTTP_TIMEOUT_MS, signal },
      );
      if (signal.aborted) return { kind: "stopped" };
      await this.cursor.markPolled(botId, new Date());
    } catch (error) {
      if (signal.aborted) return { kind: "stopped" };
      this.fail("telegram", error);
      if (error instanceof TelegramBotApiError && error.httpStatus === 409) {
        // A webhook was set again (or another poller cut in): clear it.
        await this.telegram.deleteWebhook().catch(() => undefined);
      }
      return { kind: "failed", stage: "telegram", processed: 0 };
    }

    let processed = 0;
    for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
      let entryToCopy: string | null = null;
      try {
        const outcome = await this.feed.receive(update);
        await this.cursor.advance(botId, update.update_id + 1);
        if (outcome.kind === "written" && outcome.previewPending) {
          entryToCopy = outcome.entryId;
        }
      } catch (error) {
        this.fail("processing", error, update.update_id);
        return { kind: "failed", stage: "processing", processed };
      }
      processed += 1;
      // After the commit and the offset (EARS-29); never throws — a failed
      // copy is retried by the schedule.
      if (entryToCopy !== null) await this.previews.copy(entryToCopy);
    }
    return { kind: "polled", processed };
  }

  private async run(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      const outcome = await this.pollOnce();
      if (this.stopping) break;
      if (outcome.kind === "failed") {
        failures += 1;
        await this.sleep(telegramPollBackoffMs(failures));
      } else if (outcome.kind === "not_leader") {
        failures = 0;
        await this.sleep(TELEGRAM_POLL_LOCK_RETRY_MS);
      } else {
        failures = 0;
      }
    }
  }

  /**
   * Take the single-poller lock on a dedicated pool connection, or confirm
   * the one held is still alive (a lost connection loses the lock with it).
   */
  private async holdLock(): Promise<boolean> {
    if (this.lockClient) {
      try {
        await this.lockClient.query("select 1");
        return true;
      } catch {
        this.lockClient.release(true);
        this.lockClient = null;
        this.botId = null;
      }
    }
    const client = await this.pool.connect();
    client.on("error", () => {
      // The connection dropped; the next `holdLock` notices and re-takes it.
    });
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
        [LOCK_KEY],
      );
      if (rows[0]?.locked !== true) {
        client.release();
        return false;
      }
    } catch (error) {
      client.release(true);
      throw error;
    }
    this.lockClient = client;
    return true;
  }

  private async releaseLock(): Promise<void> {
    const client = this.lockClient;
    if (!client) return;
    this.lockClient = null;
    this.botId = null;
    try {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
        LOCK_KEY,
      ]);
      client.release();
    } catch {
      client.release(true);
    }
  }

  private sleep(ms: number): Promise<void> {
    const signal = this.abort.signal;
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  private fail(
    stage: "telegram" | "processing",
    error: unknown,
    updateId?: number,
  ): void {
    this.logger.error(
      JSON.stringify({
        event: stage === "processing" ? "telegram_update_failed" : "telegram_poll_failed",
        ...(updateId === undefined ? {} : { updateId }),
        error: error instanceof Error ? error.name : "unknown",
        ...(error instanceof TelegramBotApiError
          ? { method: error.method, outcome: error.outcome }
          : {}),
      }),
    );
  }
}
