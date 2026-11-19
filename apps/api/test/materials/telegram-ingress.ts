import type { INestApplication } from "@nestjs/common";
import type pg from "pg";
import type { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import type { RawUpdate } from "../../src/materials/telegram/telegram-bot-api.types.js";
import {
  TelegramUpdatePoller,
  type TelegramPollOutcome,
} from "../../src/materials/telegram/telegram-update-poller.service.js";

// 048 EARS-24 (#4165) — how the e2e suites deliver a Telegram update: the way
// production receives it. Telegram (the double) holds the update, and one
// poll of the app's real `TelegramUpdatePoller` fetches and processes it.
// A test app runs no polling loop — only the HTTP server entry starts it — so
// a test drives one poll at a time.

/** Telegram receives `update`; one poll of the app fetches and processes it. */
export async function deliverByPoll(
  app: INestApplication,
  telegram: FakeTelegramBotApi,
  update: RawUpdate,
): Promise<TelegramPollOutcome> {
  telegram.push(update);
  return app.get(TelegramUpdatePoller).pollOnce();
}

/**
 * The poller answered a `getUpdates` for the double's bot at `at` — what the
 * EARS-31 source check reads as «delivery works».
 */
export async function markPolled(
  pool: pg.Pool,
  telegram: FakeTelegramBotApi,
  at: Date = new Date(),
): Promise<void> {
  await pool.query(
    `INSERT INTO telegram_update_cursor (bot_id, polled_at, updated_at)
       VALUES ($1, $2, now())
     ON CONFLICT (bot_id) DO UPDATE SET polled_at = $2,
       failing_update_id = NULL, failing_since = NULL, updated_at = now()`,
    [telegram.me.id, at],
  );
}

/**
 * The poller has failed on update `updateId` without a break since `since`
 * while its polls are answered — what the EARS-31 source check reads as a
 * stalled delivery once it lasts over an hour.
 */
export async function markStuck(
  pool: pg.Pool,
  telegram: FakeTelegramBotApi,
  updateId: number,
  since: Date,
): Promise<void> {
  await markPolled(pool, telegram);
  await pool.query(
    `UPDATE telegram_update_cursor
        SET failing_update_id = $2, failing_since = $3, updated_at = now()
      WHERE bot_id = $1`,
    [telegram.me.id, updateId, since],
  );
}

/** Drop the double's bot cursor row at the end of a suite. */
export async function dropCursor(
  pool: pg.Pool | undefined,
  telegram: FakeTelegramBotApi,
): Promise<void> {
  await pool
    ?.query("DELETE FROM telegram_update_cursor WHERE bot_id = $1", [
      telegram.me.id,
    ])
    .catch(() => undefined);
}
