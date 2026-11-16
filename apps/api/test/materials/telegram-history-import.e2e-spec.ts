import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger, VersioningType } from "@nestjs/common";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { FeedSourcesRepository } from "../../src/materials/feed-sources.repository.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import { TELEGRAM_BOT_API } from "../../src/materials/telegram/telegram-bot-api.types.js";
import {
  TELEGRAM_CONFIG,
  type TelegramConfig,
} from "../../src/materials/telegram/telegram-config.js";
import {
  HistoryImportRefusedError,
  TelegramHistoryImport,
} from "../../src/materials/telegram/telegram-history-import.command.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/storage/index.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 EARS-30 (#3995) — the one-off history import over the REAL stack
// (Postgres + the 012 normalizer + object storage): a Telegram Desktop JSON
// export (hand-made, shaped after the tdesktop JSON writer — no real channel
// content) is validated whole, then mapped under EARS-26 and written through
// `feed_entry_messages`, so a re-run and a post the webhook delivered are
// never duplicated; a foreign or unbound channel is refused with nothing
// written; previews come from the exported files; nothing logged carries a
// post text (EARS-36). The command runs through its unit — the operator
// script (`scripts/telegram-import-history.ts`) only parses arguments and
// prints the report.
describe.skipIf(!process.env.DATABASE_URL)(
  "048 Telegram history import (e2e)",
  () => {
    const SECRET = "e2e_import-secret_0123";
    const config: TelegramConfig = {
      botToken: "123456:E2E-import_token-value",
      webhookSecret: SECRET,
      webhookUrl: "https://api.example.test/v1/integrations/telegram/webhook",
    };
    const telegram = new FakeTelegramBotApi();
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let importer: TelegramHistoryImport;
    let storage: ObjectStorage;
    let jpeg: Buffer;
    let dir: string;
    const sourceIds: string[] = [];
    const logged: string[] = [];
    let updateSeq = 960_000_000 + Math.floor(Math.random() * 1_000_000);
    const base = 1_761_991_200;

    const username = () =>
      `i${Math.random().toString(36).slice(2, 8)}${Math.random()
        .toString(36)
        .slice(2, 7)}`.padEnd(12, "x");
    const bareId = () => 2_000_000_000 + Math.floor(Math.random() * 1e9);

    async function source(opts: { bound?: boolean; enabled?: boolean } = {}) {
      const address = username();
      const bare = bareId();
      const chatId = -1_000_000_000_000 - bare;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_sources (platform, address, enabled, telegram_chat_id)
           VALUES ('telegram', $1, $2, $3) RETURNING id`,
        [address, opts.enabled ?? true, opts.bound === false ? null : chatId],
      );
      sourceIds.push(rows[0]!.id);
      return { id: rows[0]!.id, address, bare, chatId };
    }
    type Src = Awaited<ReturnType<typeof source>>;

    const message = (id: number, extra: Record<string, unknown> = {}) => ({
      id,
      type: "message",
      date: "2025-11-01T10:00:00",
      date_unixtime: String(base + id),
      from: "BBM Academy",
      from_id: "channel1",
      text: "",
      text_entities: [],
      ...extra,
    });

    /** Write `result.json` (and any exported files) into a fresh folder. */
    async function exportOf(
      bare: number,
      messages: object[],
      files: Record<string, Buffer> = {},
    ): Promise<string> {
      const folder = await mkdtemp(join(dir, "export-"));
      for (const [path, body] of Object.entries(files)) {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await writeFile(join(folder, path), body);
      }
      const file = join(folder, "result.json");
      await writeFile(
        file,
        JSON.stringify({
          name: "BBM Academy",
          type: "public_channel",
          id: bare,
          messages,
        }),
      );
      return file;
    }

    function deliver(src: Src, messageId: number, text: string) {
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
            text,
          },
        }),
      });
    }

    interface Row {
      id: string;
      title: string;
      href: string;
      published_at: Date;
      image_ref: string | null;
      preview_state: string | null;
      duration_seconds: number | null;
      source_off: boolean;
      hidden_at: Date | null;
      message_id: string;
    }
    async function entriesOf(src: Src): Promise<Row[]> {
      const { rows } = await pool.query<Row>(
        `SELECT e.*, m.message_id FROM feed_entries e
           JOIN feed_entry_messages m ON m.feed_entry_id = e.id
          WHERE e.feed_source_id = $1 ORDER BY m.message_id`,
        [src.id],
      );
      return rows;
    }

    async function refusal(
      run: Promise<unknown>,
    ): Promise<HistoryImportRefusedError> {
      const error = await run.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(HistoryImportRefusedError);
      return error as HistoryImportRefusedError;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(TELEGRAM_CONFIG)
        .useValue(config)
        .overrideProvider(TELEGRAM_BOT_API)
        .useValue(telegram)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      importer = app.get(TelegramHistoryImport);
      storage = app.get<ObjectStorage>(OBJECT_STORAGE);
      jpeg = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#36a" },
      })
        .jpeg()
        .toBuffer();
      dir = await mkdtemp(join(tmpdir(), "tg-import-"));
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
      // EARS-36 — no log line carries a post text.
      expect(logged.join("\n")).not.toMatch(/Пост|Архив|Фото|Видео|Репост/);
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
      await app?.close();
      if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("048 EARS-30: when an operator imports an export twice, overlapping a post the webhook delivered, the system shall write each earlier post once at its Telegram date and the re-run shall write nothing", async () => {
      const src = await source();
      expect((await deliver(src, 1201, "Пост из вебхука")).statusCode).toBe(
        200,
      );
      const file = await exportOf(src.bare, [
        message(900, { text: "Архив 900" }),
        message(901, { text: ["Архив ", { type: "bold", text: "901" }] }),
        message(902, { type: "service", action: "pin_message", text: "" }),
        message(1201, { text: "Пост из экспорта" }),
      ]);

      const first = await importer.run({
        source: `t.me/${src.address}`,
        exportPath: file,
      });
      expect(first).toEqual({
        read: 4,
        written: 2,
        skippedExisting: 1,
        skippedMediaNoText: 0,
        dropped: { service_message: 1 },
        previewsFailed: 0,
      });
      const rows = await entriesOf(src);
      expect(rows.map((r) => [Number(r.message_id), r.title])).toEqual([
        [900, "Архив 900"],
        [901, "Архив 901"],
        // The webhook's entry is never overwritten by the export.
        [1201, "Пост из вебхука"],
      ]);
      expect(rows[0]!.published_at.getTime()).toBe((base + 900) * 1000);
      expect(rows[0]!.href).toBe(`https://t.me/${src.address}/900`);
      expect(rows[0]!.source_off).toBe(false);
      expect(rows[0]!.hidden_at).toBeNull();

      const again = await importer.run({
        source: src.address,
        exportPath: file,
      });
      expect(again).toMatchObject({ read: 4, written: 0, skippedExisting: 3 });
      expect(await entriesOf(src)).toHaveLength(3);
    });

    it("048 EARS-30: when the export names another channel than the source's bound id, the system shall refuse it and write nothing", async () => {
      const src = await source();
      const file = await exportOf(src.bare + 1, [
        message(900, { text: "Архив 900" }),
      ]);
      const error = await refusal(
        importer.run({ source: src.address, exportPath: file }),
      );
      expect(error.reason).toMatch(/another channel/);
      expect(await entriesOf(src)).toEqual([]);
    });

    it("048 EARS-30: when the source has no bound Telegram id, the system shall refuse the import with its reason and write nothing", async () => {
      const src = await source({ bound: false });
      const file = await exportOf(src.bare, [
        message(900, { text: "Архив 900" }),
        message(901, { text: "Архив 901" }),
      ]);
      const error = await refusal(
        importer.run({ source: src.address, exportPath: file }),
      );
      expect(error.reason).toBe(
        "the source has no bound Telegram id; run the source check (EARS-31)",
      );
      expect(await entriesOf(src)).toEqual([]);
    });

    it("048 EARS-30: when the file does not parse or a message is malformed, the system shall refuse the whole file and write nothing", async () => {
      const src = await source();
      const broken = join(await mkdtemp(join(dir, "broken-")), "result.json");
      await writeFile(broken, "{ not json");
      expect(
        (
          await refusal(
            importer.run({ source: src.address, exportPath: broken }),
          )
        ).reason,
      ).toMatch(/parse/i);
      const partial = await exportOf(src.bare, [
        message(900, { text: "Архив 900" }),
        { id: 901, type: "message" },
      ]);
      await refusal(importer.run({ source: src.address, exportPath: partial }));
      expect(await entriesOf(src)).toEqual([]);
    });

    it("048 EARS-30: when exported messages are forwards, media with no text or other content, the system shall count them by reason and write only the text posts", async () => {
      const src = await source();
      const file = await exportOf(src.bare, [
        message(910, { text: "Репост", forwarded_from: "Другой канал" }),
        message(911, { photo: "photos/p911.jpg" }),
        message(912, {
          media_type: "sticker",
          file: "stickers/s.webp",
          text: "",
        }),
        { id: 913, type: "unsupported" },
        message(914, { text: "Пост 914" }),
      ]);
      const report = await importer.run({
        source: src.address,
        exportPath: file,
      });
      expect(report).toEqual({
        read: 5,
        written: 1,
        skippedExisting: 0,
        skippedMediaNoText: 1,
        dropped: { forward: 1, unsupported_content: 2 },
        previewsFailed: 0,
      });
      expect((await entriesOf(src)).map((r) => Number(r.message_id))).toEqual([
        914,
      ]);
    });

    it("048 EARS-30: when an exported photo or video thumbnail file is present, the system shall store its normalized preview under a server key and keep a failed preview's entry without an image", async () => {
      const src = await source();
      const file = await exportOf(
        src.bare,
        [
          message(920, { text: "Фото 920", photo: "photos/p920.jpg" }),
          message(921, {
            text: "Видео 921",
            file: "video_files/v921.mp4",
            thumbnail: "video_files/v921.mp4_thumb.jpg",
            media_type: "video_file",
            mime_type: "video/mp4",
            duration_seconds: 75,
          }),
          // Not an image: the preview fails, the entry stays without one.
          message(922, { text: "Фото 922", photo: "photos/p922.jpg" }),
          // Not included in the export: no file to make a preview from.
          message(923, {
            text: "Фото 923",
            photo:
              "(File not included. Change data exporting settings to download.)",
          }),
        ],
        {
          "photos/p920.jpg": jpeg,
          "video_files/v921.mp4_thumb.jpg": jpeg,
          "photos/p922.jpg": Buffer.from("not an image"),
        },
      );
      const report = await importer.run({
        source: src.address,
        exportPath: file,
      });
      expect(report).toMatchObject({ written: 4, previewsFailed: 2 });
      const rows = await entriesOf(src);
      const [photo, video, broken, missing] = rows;
      for (const row of [photo!, video!]) {
        expect(row.image_ref).toMatch(
          new RegExp(`^feed-previews/${row.id}/[0-9a-f]{64}\\.webp$`),
        );
        expect(row.preview_state).toBe("done");
        expect(await storage.exists(row.image_ref!)).toBe(true);
      }
      expect(video!.duration_seconds).toBe(75);
      for (const row of [broken!, missing!]) {
        expect(row.image_ref).toBeNull();
      }
      // A Bot API call is never made for an exported file.
      expect(telegram.calls).toEqual([]);
    });

    it("048 EARS-30: when the source is switched off, the system shall write the imported entries off the public feed", async () => {
      const src = await source({ enabled: false });
      const file = await exportOf(src.bare, [
        message(930, { text: "Архив 930" }),
      ]);
      await importer.run({ source: src.address, exportPath: file });
      const [row] = await entriesOf(src);
      expect(row!.source_off).toBe(true);
    });

    it("048 EARS-30: when an exported file path leaves the export folder, the system shall not read it and count the preview as failed", async () => {
      const src = await source();
      const file = await exportOf(src.bare, [
        message(940, { text: "Фото 940", photo: "../outside.jpg" }),
      ]);
      await writeFile(join(dirname(file), "..", "outside.jpg"), jpeg);
      const report = await importer.run({
        source: src.address,
        exportPath: file,
      });
      expect(report).toMatchObject({ written: 1, previewsFailed: 1 });
      expect((await entriesOf(src))[0]!.image_ref).toBeNull();
    });

    it("048 EARS-30: when an exported file path reaches outside the export folder through a link inside it, the system shall not read it and count the preview as failed", async (ctx) => {
      const src = await source();
      const outside = await mkdtemp(join(dir, "outside-"));
      await writeFile(join(outside, "outside.jpg"), jpeg);
      const file = await exportOf(src.bare, [
        message(941, { text: "Фото 941", photo: "photos/outside.jpg" }),
      ]);
      // A directory link: a junction on Windows (no privilege needed), a
      // symlink elsewhere; the run skips only where links are not permitted.
      try {
        await symlink(outside, join(dirname(file), "photos"), "junction");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") ctx.skip();
        throw error;
      }
      const report = await importer.run({
        source: src.address,
        exportPath: file,
      });
      expect(report).toMatchObject({ written: 1, previewsFailed: 1 });
      expect((await entriesOf(src))[0]!.image_ref).toBeNull();
    });

    it("048 EARS-30: when the source is deleted while the import runs, the system shall stop the run with its reason and not count the rest as already held", async () => {
      const src = await source();
      const file = await exportOf(src.bare, [
        message(950, { text: "Архив 950" }),
        message(951, { text: "Архив 951" }),
      ]);
      vi.spyOn(app.get(FeedSourcesRepository), "lockById").mockResolvedValue(
        null,
      );
      await expect(
        importer.run({ source: src.address, exportPath: file }),
      ).rejects.toThrow("the source was deleted during the import");
      expect(await entriesOf(src)).toEqual([]);
    });
  },
);
