import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger, VersioningType } from "@nestjs/common";
import sharp from "sharp";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  FeedEntriesRepository,
  PREVIEW_MAX_ATTEMPTS,
} from "../../src/materials/feed-entries.repository.js";
import { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import {
  TELEGRAM_BOT_API,
  TELEGRAM_FILE_MAX_BYTES,
} from "../../src/materials/telegram/telegram-bot-api.types.js";
import {
  TELEGRAM_CONFIG,
  type TelegramConfig,
} from "../../src/materials/telegram/telegram-config.js";
import { TelegramPreviewService } from "../../src/materials/telegram/telegram-preview.service.js";
import {
  addressChangedReason,
  SOURCE_CHECK_REASONS,
  TelegramSourceCheck,
} from "../../src/materials/telegram/telegram-source-check.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/storage/index.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-16, V-19 (#3994) — the preview copy and the source check over the
// REAL stack (Fastify + Postgres + the 012 normalizer + object storage)
// against the Telegram double. V-16: the chosen photo size and the video
// thumbnail are copied into storage under a server key; a file over 20 MB is
// refused; a failed fetch leaves the card imageless and the scheduled retry
// sets it; the last attempt leaves it `failed`; the source status is never
// touched (EARS-29). V-19: each failing reason of EARS-31 from the double's
// answers, «Telegram недоступен» on an outage, «Работает» with the id bound
// otherwise; nothing logged carries the token or the secret (EARS-36).
//
// The scheduled jobs are driven through their units (`duePreviewIds` +
// `copy`, `check`) so this suite never touches rows of a parallel suite.
describe.skipIf(!process.env.DATABASE_URL)(
  "048 Telegram preview copy and source check (e2e)",
  () => {
    const TOKEN = "123456:E2E-preview_token-value";
    const SECRET = "e2e_preview-secret_0123";
    const HOOK = "https://api.example.test/v1/integrations/telegram/webhook";
    const config: TelegramConfig = {
      botToken: TOKEN,
      webhookSecret: SECRET,
      webhookUrl: HOOK,
    };
    const telegram = new FakeTelegramBotApi();
    let app: NestFastifyApplication;
    let offApp: NestFastifyApplication;
    let pool: pg.Pool;
    let previews: TelegramPreviewService;
    let check: TelegramSourceCheck;
    let feed: FeedEntriesRepository;
    let storage: ObjectStorage;
    let jpeg: Buffer;
    const sourceIds: string[] = [];
    const logged: string[] = [];
    let updateSeq = 950_000_000 + Math.floor(Math.random() * 1_000_000);
    const base = Math.floor(Date.now() / 1000) - 3600;

    async function boot(cfg: TelegramConfig | null) {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(TELEGRAM_CONFIG)
        .useValue(cfg)
        .overrideProvider(TELEGRAM_BOT_API)
        .useValue(telegram)
        .compile();
      const a = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      a.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await a.init();
      await a.getHttpAdapter().getInstance().ready();
      return a;
    }

    const username = () =>
      `p${Math.random().toString(36).slice(2, 8)}${Math.random()
        .toString(36)
        .slice(2, 7)}`.padEnd(12, "x");
    const chatId = () => -1_000_000_000_000 - Math.floor(Math.random() * 1e9);

    async function source(opts: { enabled?: boolean } = {}) {
      const address = username();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_sources (platform, address, enabled)
           VALUES ('telegram', $1, $2) RETURNING id`,
        [address, opts.enabled ?? true],
      );
      sourceIds.push(rows[0]!.id);
      return { id: rows[0]!.id, address, chatId: chatId() };
    }
    type Src = Awaited<ReturnType<typeof source>>;

    function deliver(src: Src, messageId: number, extra: object) {
      return app.inject({
        method: "POST",
        url: "/v1/integrations/telegram/webhook",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        payload: JSON.stringify({
          update_id: ++updateSeq,
          channel_post: {
            message_id: messageId,
            date: base + messageId,
            chat: { id: src.chatId, type: "channel", username: src.address },
            ...extra,
          },
        }),
      });
    }

    const sizes = (id: string, widths: number[]) =>
      widths.map((w) => ({
        file_id: `${id}-${w}`,
        file_unique_id: `u-${id}-${w}`,
        width: w,
        height: w,
      }));

    /** Make a file known to the double: `getFile` answers it, the link serves `body`. */
    function serve(fileId: string, body: Buffer, fileSize = body.length) {
      const path = `photos/${fileId}.jpg`;
      telegram.files.set(fileId, {
        file_id: fileId,
        file_unique_id: `u-${fileId}`,
        file_size: fileSize,
        file_path: path,
      });
      telegram.downloads.set(path, body);
    }

    interface Row {
      id: string;
      image_ref: string | null;
      image_url: string | null;
      preview_state: string | null;
      preview_attempts: number;
      preview_file_id: string | null;
    }
    async function entryOf(src: Src): Promise<Row> {
      const { rows } = await pool.query<Row>(
        "SELECT * FROM feed_entries WHERE feed_source_id = $1",
        [src.id],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }
    async function sourceRow(src: Src) {
      const { rows } = await pool.query<{
        status: string;
        status_reason: string | null;
        checked_at: Date | null;
        telegram_chat_id: string | null;
        version: number;
      }>(
        "SELECT status, status_reason, checked_at, telegram_chat_id, version FROM feed_sources WHERE id = $1",
        [src.id],
      );
      return rows[0]!;
    }
    const methods = () => telegram.calls.map((c) => c.method);

    beforeAll(async () => {
      app = await boot(config);
      offApp = await boot(null);
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      previews = app.get(TelegramPreviewService);
      check = app.get(TelegramSourceCheck);
      feed = app.get(FeedEntriesRepository);
      storage = app.get<ObjectStorage>(OBJECT_STORAGE);
      jpeg = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#3a6" },
      })
        .jpeg()
        .toBuffer();
    });

    beforeEach(() => {
      logged.length = 0;
      telegram.reset();
      for (const level of [
        "log",
        "warn",
        "error",
        "debug",
        "verbose",
      ] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (...args: unknown[]) => {
            logged.push(
              args
                .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
                .join(" "),
            );
          },
        );
      }
    });

    afterEach(async () => {
      // EARS-36 — no log line carries the token or the secret.
      const all = logged.join("\n");
      expect(all).not.toContain(TOKEN);
      expect(all).not.toContain(SECRET);
      expect(all).not.toContain("api.telegram.org");
      vi.restoreAllMocks();
      for (const id of sourceIds.splice(0)) {
        await pool.query(
          "DELETE FROM feed_entry_messages WHERE feed_source_id = $1",
          [id],
        );
        await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await offApp?.close();
      await app?.close();
    });

    // ── V-16: the preview copy (EARS-29) ─────────────────────────────────

    it("048 EARS-29: when a photo post is written, the system shall copy the largest size at most 1280 px wide through getFile into storage under a server key and set the card image, leaving the source status untouched", async () => {
      const src = await source();
      serve("p1-1280", jpeg);
      const res = await deliver(src, 10, {
        caption: "Фото",
        photo: sizes("p1", [90, 800, 1280, 2560]),
      });
      expect(res.statusCode).toBe(200);
      const row = await entryOf(src);
      expect(row.preview_state).toBe("done");
      expect(row.image_url).toBeNull();
      expect(row.image_ref).toMatch(
        new RegExp(`^feed-previews/${row.id}/[0-9a-f]{64}\\.webp$`),
      );
      // The stored object is our normalized WebP, not the Telegram bytes.
      const stored = await storage.getBytes(row.image_ref!);
      expect(stored?.subarray(8, 12).toString("latin1")).toBe("WEBP");
      expect(telegram.calls).toEqual([
        { method: "getFile", args: ["p1-1280"] },
        {
          method: "downloadFile",
          args: ["photos/p1-1280.jpg", TELEGRAM_FILE_MAX_BYTES],
        },
      ]);
      // A preview is a per-post matter: the source is not judged by it.
      expect(await sourceRow(src)).toMatchObject({
        status: "unchecked",
        status_reason: null,
      });
      // The public read signs the stored key, like an own cover.
      expect(await storage.urlFor(row.image_ref!)).not.toContain(
        "telegram.org",
      );
    });

    it("048 EARS-29: when no photo size is at most 1280 px wide, the system shall copy the smallest one; of a video it shall copy only the thumbnail, never the video file", async () => {
      const wide = await source();
      serve("w1-1600", jpeg);
      await deliver(wide, 20, {
        caption: "Широкое",
        photo: sizes("w1", [2560, 1600]),
      });
      expect((await entryOf(wide)).preview_state).toBe("done");
      expect(telegram.calls[0]).toEqual({
        method: "getFile",
        args: ["w1-1600"],
      });

      telegram.reset();
      const vid = await source();
      serve("thumb-21", jpeg);
      await deliver(vid, 21, {
        caption: "Видео",
        video: {
          file_id: "video-21",
          file_unique_id: "u-video-21",
          width: 1280,
          height: 720,
          duration: 30,
          thumbnail: {
            file_id: "thumb-21",
            file_unique_id: "u-thumb-21",
            width: 320,
            height: 180,
          },
        },
      });
      expect((await entryOf(vid)).preview_state).toBe("done");
      expect(telegram.calls.map((c) => c.args[0])).toEqual([
        "thumb-21",
        "photos/thumb-21.jpg",
      ]);
    });

    it("048 EARS-29: when the file is over 20 MB, the system shall refuse it without downloading it and keep the card without an image", async () => {
      const src = await source();
      serve("big-1280", jpeg, TELEGRAM_FILE_MAX_BYTES + 1);
      const res = await deliver(src, 30, {
        caption: "Большое",
        photo: sizes("big", [1280]),
      });
      expect(res.statusCode).toBe(200);
      expect(methods()).toEqual(["getFile"]);
      expect(await entryOf(src)).toMatchObject({
        image_ref: null,
        preview_state: "pending",
        preview_attempts: 1,
      });
    });

    it("048 EARS-29: when the fetch fails, the system shall keep the entry without an image and answer 200; the scheduled retry sets the image on its first success", async () => {
      const src = await source();
      const res = await deliver(src, 40, {
        caption: "Позже",
        photo: sizes("late", [800]),
      });
      expect(res.statusCode).toBe(200);
      const first = await entryOf(src);
      expect(first).toMatchObject({
        image_ref: null,
        preview_state: "pending",
        preview_attempts: 1,
      });
      // The next attempt waits its backoff (10 minutes after the first).
      expect(await feed.duePreviewIds(10_000)).not.toContain(first.id);
      await pool.query(
        "UPDATE feed_entries SET updated_at = now() - interval '11 minutes' WHERE id = $1",
        [first.id],
      );
      expect(await feed.duePreviewIds(10_000)).toContain(first.id);
      // A fresh getFile each attempt: the file is now served.
      serve("late-800", jpeg);
      telegram.calls.length = 0;
      expect(await previews.copy(first.id)).toBe("done");
      expect(methods()).toEqual(["getFile", "downloadFile"]);
      const after = await entryOf(src);
      expect(after.preview_state).toBe("done");
      expect(after.image_ref).toMatch(/^feed-previews\//);
      expect(await feed.duePreviewIds(10_000)).not.toContain(first.id);
      expect((await sourceRow(src)).status).toBe("unchecked");
    });

    it("048 EARS-29: after the last scheduled attempt fails, the system shall leave the card in its no-image layout and the source status untouched", async () => {
      const src = await source();
      await deliver(src, 50, {
        caption: "Никогда",
        photo: sizes("never", [800]),
      });
      const row = await entryOf(src);
      await pool.query(
        "UPDATE feed_entries SET preview_attempts = $2, updated_at = now() - interval '1 day' WHERE id = $1",
        [row.id, PREVIEW_MAX_ATTEMPTS - 1],
      );
      expect(await feed.duePreviewIds(10_000)).toContain(row.id);
      expect(await previews.copy(row.id)).toBe("failed");
      expect(await entryOf(src)).toMatchObject({
        image_ref: null,
        preview_state: "failed",
        preview_attempts: PREVIEW_MAX_ATTEMPTS,
      });
      expect(await feed.duePreviewIds(10_000)).not.toContain(row.id);
      expect(await sourceRow(src)).toMatchObject({
        status: "unchecked",
        status_reason: null,
      });
    });

    it("048 EARS-29: when an edit replaces the medium, the new copy replaces the old one and the old object becomes a 012 cleanup obligation", async () => {
      const src = await source();
      serve("one-800", jpeg);
      await deliver(src, 60, { caption: "Раз", photo: sizes("one", [800]) });
      const old = (await entryOf(src)).image_ref!;
      const other = await sharp({
        create: { width: 40, height: 40, channels: 3, background: "#a36" },
      })
        .jpeg()
        .toBuffer();
      serve("two-800", other);
      const res = await app.inject({
        method: "POST",
        url: "/v1/integrations/telegram/webhook",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        payload: JSON.stringify({
          update_id: ++updateSeq,
          edited_channel_post: {
            message_id: 60,
            date: base + 60,
            chat: { id: src.chatId, type: "channel", username: src.address },
            caption: "Раз",
            photo: sizes("two", [800]),
          },
        }),
      });
      expect(res.statusCode).toBe(200);
      const row = await entryOf(src);
      expect(row.preview_state).toBe("done");
      expect(row.image_ref).not.toBe(old);
      const { rows: jobs } = await pool.query<{
        entity_kind: string;
        cleanup_kind: string;
      }>(
        "SELECT entity_kind, cleanup_kind FROM media_cleanup_jobs WHERE object_key = $1",
        [old],
      );
      expect(jobs).toEqual([
        { entity_kind: "feed_entry", cleanup_kind: "replace" },
      ]);
      await pool.query("DELETE FROM media_cleanup_jobs WHERE entity_id = $1", [
        row.id,
      ]);
    });

    // ── V-19: the source check (EARS-31) ─────────────────────────────────

    /** A channel the bot sees, as the double answers it by name and by id. */
    function channel(
      src: Src,
      opts: { username?: string; status?: string } = {},
    ) {
      const info = {
        id: src.chatId,
        type: "channel",
        username: opts.username ?? src.address.toUpperCase(),
      };
      telegram.chats.set(`@${src.address}`, info);
      telegram.chats.set(String(src.chatId), info);
      telegram.members.set(`${src.chatId}:${telegram.me.id}`, {
        status: opts.status ?? "administrator",
      });
      telegram.webhook = { url: HOOK, pending_update_count: 0 };
    }

    it("048 EARS-31: when the check finds the channel, the bot a member and the webhook registered, the system shall set «Работает» with the time and bind the id of a channel whose username equals the address ignoring case", async () => {
      for (const status of ["administrator", "member"]) {
        telegram.reset();
        const src = await source();
        channel(src, { status });
        const before = await sourceRow(src);
        const row = await check.check(src.id);
        expect(row).toBeDefined();
        const after = await sourceRow(src);
        expect(after).toMatchObject({
          status: "ok",
          status_reason: null,
          telegram_chat_id: String(src.chatId),
          // Not an administrator edit: the admin ETag is unchanged.
          version: before.version,
        });
        expect(after.checked_at).not.toBeNull();
        expect(telegram.calls[0]).toEqual({
          method: "getWebhookInfo",
          args: [],
        });
        expect(telegram.calls[1]).toEqual({
          method: "getChat",
          args: [`@${src.address}`],
        });
        // Once bound, the id decides.
        telegram.calls.length = 0;
        await check.check(src.id);
        expect(telegram.calls[1]).toEqual({
          method: "getChat",
          args: [src.chatId],
        });
      }
    });

    it("048 EARS-31: the system shall set «Ошибка» with exactly one reason for each failing check", async () => {
      const cases: Array<[string, (src: Src) => void | Promise<void>]> = [
        [
          SOURCE_CHECK_REASONS.webhookNotRegistered,
          (src) => {
            channel(src);
            telegram.webhook = { url: "", pending_update_count: 0 };
          },
        ],
        [
          SOURCE_CHECK_REASONS.channelNotFound,
          () => {
            telegram.webhook = { url: HOOK, pending_update_count: 0 };
          },
        ],
        [
          SOURCE_CHECK_REASONS.notAMember,
          (src) => channel(src, { status: "left" }),
        ],
        [
          SOURCE_CHECK_REASONS.notAMember,
          (src) => {
            channel(src);
            telegram.members.clear();
          },
        ],
        [
          SOURCE_CHECK_REASONS.cannotDeliver,
          (src) => {
            channel(src);
            telegram.webhook = {
              url: HOOK,
              pending_update_count: 3,
              last_error_date: Math.floor(Date.now() / 1000) - 600,
              last_error_message: "Wrong response from the webhook: 502",
            };
          },
        ],
      ];
      for (const [reason, arrange] of cases) {
        telegram.reset();
        const src = await source();
        await arrange(src);
        await check.check(src.id);
        expect(await sourceRow(src), reason).toMatchObject({
          status: "failing",
          status_reason: reason,
        });
        // Telegram's own error text goes nowhere near the admin.
        expect(JSON.stringify(await sourceRow(src))).not.toContain(
          "Wrong response",
        );
      }
    });

    it("048 EARS-31: when the bound channel's username changed, the system shall set «Адрес канала изменился на t.me/<имя>»", async () => {
      const src = await source();
      await pool.query(
        "UPDATE feed_sources SET telegram_chat_id = $2 WHERE id = $1",
        [src.id, String(src.chatId)],
      );
      channel(src, { username: "BBM_Renamed" });
      await check.check(src.id);
      expect(await sourceRow(src)).toMatchObject({
        status: "failing",
        status_reason: addressChangedReason("bbm_renamed"),
      });
    });

    it("048 EARS-31: when Telegram is unreachable during a check, the system shall set «Ошибка» with «Telegram недоступен» and change no entry", async () => {
      const src = await source();
      channel(src);
      await deliver(src, 70, { text: "Пост" });
      const { id } = await entryOf(src);
      const snapshot = async () =>
        (await pool.query("SELECT * FROM feed_entries WHERE id = $1", [id]))
          .rows[0];
      const before = await snapshot();
      for (const outage of ["timeout", "network_error"] as const) {
        telegram.outage = outage;
        await check.check(src.id);
        expect(await sourceRow(src)).toMatchObject({
          status: "failing",
          status_reason: SOURCE_CHECK_REASONS.unreachable,
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it("048 EARS-31: while the bot token or the webhook secret is not configured, the check shall set «Telegram не подключён на сервере» calling nothing; a switched-off source is not checked", async () => {
      const src = await source();
      await offApp.get(TelegramSourceCheck).check(src.id);
      expect(await sourceRow(src)).toMatchObject({
        status: "failing",
        status_reason: SOURCE_CHECK_REASONS.notConfigured,
      });
      expect(telegram.calls).toEqual([]);

      const off = await source({ enabled: false });
      channel(off);
      telegram.calls.length = 0;
      expect(await check.check(off.id)).toBeUndefined();
      expect(telegram.calls).toEqual([]);
      expect(await sourceRow(off)).toMatchObject({
        status: "unchecked",
        checked_at: null,
      });
    });
  },
);
