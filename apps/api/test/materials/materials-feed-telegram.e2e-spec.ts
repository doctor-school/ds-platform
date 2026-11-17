import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { PublicFeedPageSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/storage/index.js";
import { FakeTelegramBotApi } from "../../src/materials/telegram/telegram-bot-api.fake.js";
import { TELEGRAM_BOT_API } from "../../src/materials/telegram/telegram-bot-api.types.js";
import {
  TELEGRAM_CONFIG,
  type TelegramConfig,
} from "../../src/materials/telegram/telegram-config.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-18 (#3997) — the feed read serving Telegram entries over the REAL
// stack (Fastify + Postgres): `post` cards in the EARS-9 order and cursor
// among own materials, the preview signed at the read, hidden and
// switched-off entries absent and back once returned (EARS-33), and the read
// served from the stored entries with the Telegram double down, the webhook
// never delivered, the source failing or the connector not configured — the
// read never calls Telegram (EARS-35). Entries are seeded as the connector
// writes them (its write path is the #3994 suite's subject) inside a
// far-future instant window unique to this run, and every page walk starts
// just above that window, so rows other suites write never interleave.

/** The two ways the connector can be absent while the feed is read (EARS-35). */
const outages: {
  name: string;
  config: TelegramConfig | null;
}[] = [
  {
    name: "Telegram unreachable, the webhook never delivered, the source failing",
    config: {
      botToken: "123456:E2E-feed_token",
      webhookSecret: "e2e_feed-secret",
      webhookUrl: null,
    },
  },
  { name: "the connector not configured", config: null },
];

describe.skipIf(!process.env.DATABASE_URL).each(outages)(
  "048 materials feed — Telegram post cards (e2e): $name",
  ({ config }) => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let storage: ObjectStorage;
    /** The Telegram double, down for every call. */
    const telegram = new FakeTelegramBotApi();
    telegram.outage = "network_error";
    const sourceIds: string[] = [];
    const materialIds: string[] = [];
    const windowBase =
      Date.UTC(2910, 0, 1) + Math.floor(Math.random() * 5e6) * 60_000;
    const marker = () => randomUUID().slice(0, 8);

    /** An instant `seconds` into the window, with microseconds Postgres keeps. */
    function at(seconds: number, micros = 123_456): string {
      const iso = new Date(windowBase + seconds * 1000).toISOString();
      return `${iso.slice(0, 19)}.${String(micros).padStart(6, "0")}Z`;
    }

    function windowTop(): string {
      return Buffer.from(
        JSON.stringify({ publishedAt: at(10_000), id: randomUUID() }),
      ).toString("base64url");
    }

    /** A Telegram source as an administrator added it, its check failing. */
    async function source(): Promise<{ id: string; address: string }> {
      const address = `tfeed${marker().replace(/-/g, "")}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_sources (platform, address, status, status_reason, checked_at)
         VALUES ('telegram', $1, 'failing', 'Telegram недоступен', now())
         RETURNING id`,
        [address],
      );
      sourceIds.push(rows[0]!.id);
      return { id: rows[0]!.id, address };
    }

    interface PostSeed {
      messageId: number;
      publishedAt: string;
      text?: string;
      imageRef?: string | null;
      previewState?: "pending" | "done" | "failed" | null;
      durationSeconds?: number | null;
    }

    /** A Telegram `post` entry as the connector writes it (048-design §Data model (slice 2)). */
    async function post(
      s: { id: string; address: string },
      seed: PostSeed,
    ): Promise<{ id: string; href: string; text: string }> {
      const text = seed.text ?? `Пост ${seed.messageId} ${marker()}`;
      const href = `https://t.me/${s.address}/${seed.messageId}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, image_ref, source_name,
            href, published_at, duration_seconds, preview_state)
         VALUES ('telegram', $1, $2, 'post', $3, $4, 'BBM Academy · Telegram', $5,
                 $6::timestamptz, $7, $8::feed_entry_preview_state)
         RETURNING id`,
        [
          `${s.id}:${seed.messageId}`,
          s.id,
          text,
          seed.imageRef ?? null,
          href,
          seed.publishedAt,
          seed.durationSeconds ?? null,
          seed.previewState ?? null,
        ],
      );
      return { id: rows[0]!.id, href, text };
    }

    /** An own material's card in the window, as the own-materials source writes it. */
    async function own(publishedAt: string): Promise<string> {
      const slug = `tg-feed-mat-${marker()}`;
      const material = await pool.query<{ id: string }>(
        `INSERT INTO materials (slug, kind, title, author_line, body, status, first_published_at)
         VALUES ($1, 'news', $2, '', $3::jsonb, 'published', $4::timestamptz)
         RETURNING id`,
        [
          slug,
          `Материал ${slug}`,
          JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: slug }] },
            ],
          }),
          publishedAt,
        ],
      );
      const materialId = material.rows[0]!.id;
      materialIds.push(materialId);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, material_id, kind, title, source_name, href, published_at)
         VALUES ('academy', $1::text, $1::text::uuid, 'news', $2, 'Академия', $3, $4::timestamptz)
         RETURNING id`,
        [materialId, `Материал ${slug}`, `/materials/${slug}`, publishedAt],
      );
      return rows[0]!.id;
    }

    /** Every card of our window, walking pages of `limit` from the window top. */
    async function walk(limit: number) {
      const cards: Record<string, unknown>[] = [];
      let cursor: string | null = windowTop();
      let pages = 0;
      while (cursor && pages < 50) {
        const callsBefore = telegram.calls.length;
        const res = await app.inject({
          method: "GET",
          url: `/v1/public/feed?limit=${limit}&cursor=${cursor}`,
        });
        expect(res.statusCode, res.payload).toBe(200);
        // EARS-35 — the read never calls Telegram.
        expect(telegram.calls.slice(callsBefore)).toEqual([]);
        const page = PublicFeedPageSchema.parse(res.json());
        const ours = page.data.filter(
          (c) => Date.parse(c.publishedAt) >= windowBase,
        );
        cards.push(...ours);
        pages += 1;
        cursor = ours.length === page.data.length ? page.nextCursor : null;
      }
      return cards;
    }

    const ids = async (limit = 24) =>
      (await walk(limit)).map((c) => c.id as string);

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
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
      storage = app.get<ObjectStorage>(OBJECT_STORAGE);
    });

    afterEach(async () => {
      for (const id of sourceIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE feed_source_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM feed_sources WHERE id = $1", [id]);
      }
      for (const id of materialIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE material_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM materials WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await app?.close();
    });

    it("048 EARS-33: when any caller reads the feed, the system shall serve a Telegram entry as a post card — text, signed preview, duration, the Telegram source, no partner, the t.me permalink, external", async () => {
      const s = await source();
      const video = await post(s, {
        messageId: 1201,
        publishedAt: at(30),
        imageRef: "feed/telegram/preview-1201.webp",
        previewState: "done",
        durationSeconds: 754,
      });
      const cards = await walk(24);
      expect(cards).toEqual([
        {
          id: video.id,
          kind: "post",
          text: video.text,
          publishedAt: new Date(Date.parse(at(30))).toISOString(),
          image: {
            url: await storage.urlFor("feed/telegram/preview-1201.webp"),
          },
          duration: 754,
          source: { platform: "telegram", name: "BBM Academy · Telegram" },
          partner: null,
          href: `https://t.me/${s.address}/1201`,
          external: true,
        },
      ]);
      // Signed at the read, never the stored key.
      expect((cards[0]!.image as { url: string }).url).not.toBe(
        "feed/telegram/preview-1201.webp",
      );
    });

    it("048 EARS-33: a post whose preview is pending, failed or absent is served with image null, and a post with no video with duration null", async () => {
      const s = await source();
      const pending = await post(s, {
        messageId: 11,
        publishedAt: at(13),
        previewState: "pending",
      });
      const failed = await post(s, {
        messageId: 12,
        publishedAt: at(12),
        previewState: "failed",
      });
      const textOnly = await post(s, { messageId: 13, publishedAt: at(11) });
      const cards = await walk(24);
      expect(cards.map((c) => [c.id, c.image, c.duration])).toEqual([
        [pending.id, null, null],
        [failed.id, null, null],
        [textOnly.id, null, null],
      ]);
    });

    it("048 EARS-33: post cards take the EARS-9 order among own materials — newest first, ties by id — and the cursor pages them with no gap or repeat", async () => {
      const s = await source();
      const newest = await post(s, { messageId: 21, publishedAt: at(50) });
      const ownMid = await own(at(40));
      const tieA = await post(s, {
        messageId: 22,
        publishedAt: at(30, 7),
      });
      const tieB = await own(at(30, 7));
      const ownOld = await own(at(20));
      const oldest = await post(s, { messageId: 23, publishedAt: at(10) });
      const tie = [tieA.id, tieB].sort().reverse();
      const expected = [newest.id, ownMid, ...tie, ownOld, oldest.id];
      expect(await ids(24)).toEqual(expected);
      expect(await ids(2)).toEqual(expected);
      const kinds = (await walk(24)).map((c) => c.kind);
      expect(kinds).toEqual([
        "post",
        "news",
        ...tie.map((id) => (id === tieB ? "news" : "post")),
        "news",
        "post",
      ]);
    });

    it("048 EARS-33: a hidden entry and an entry of a switched-off source are absent from the feed, and each is back at its own date once returned or switched on", async () => {
      const s = await source();
      const off = await source();
      const shown = await post(s, { messageId: 31, publishedAt: at(30) });
      const hidden = await post(s, { messageId: 32, publishedAt: at(20) });
      const ofOff = await post(off, { messageId: 33, publishedAt: at(10) });
      expect(await ids()).toEqual([shown.id, hidden.id, ofOff.id]);

      await pool.query(
        "UPDATE feed_entries SET hidden_at = now() WHERE id = $1",
        [hidden.id],
      );
      await pool.query(
        "UPDATE feed_entries SET source_off = true WHERE feed_source_id = $1",
        [off.id],
      );
      expect(await ids()).toEqual([shown.id]);
      // Absent, never deleted.
      const kept = await pool.query(
        "SELECT id FROM feed_entries WHERE id = ANY($1::uuid[])",
        [[hidden.id, ofOff.id]],
      );
      expect(kept.rowCount).toBe(2);

      await pool.query(
        "UPDATE feed_entries SET hidden_at = NULL WHERE id = $1",
        [hidden.id],
      );
      await pool.query(
        "UPDATE feed_entries SET source_off = false WHERE feed_source_id = $1",
        [off.id],
      );
      expect(await ids()).toEqual([shown.id, hidden.id, ofOff.id]);
    });

    it("048 EARS-35: while Telegram is unreachable, the webhook is not delivered, the source is failing or the connector is not configured, the system shall serve the feed from the stored entries with every other card as usual and never call Telegram", async () => {
      const s = await source();
      const a = await post(s, {
        messageId: 41,
        publishedAt: at(30),
        imageRef: "feed/telegram/preview-41.webp",
        previewState: "done",
      });
      const material = await own(at(20));
      const b = await post(s, { messageId: 42, publishedAt: at(10) });
      const callsBefore = telegram.calls.length;
      const cards = await walk(1);
      expect(cards.map((c) => c.id)).toEqual([a.id, material, b.id]);
      expect(cards.map((c) => c.kind)).toEqual(["post", "news", "post"]);
      expect(cards[0]!.image).toEqual({
        url: await storage.urlFor("feed/telegram/preview-41.webp"),
      });
      expect(telegram.calls.slice(callsBefore)).toEqual([]);
      expect(telegram.outage).toBe("network_error");
    });
  },
);
