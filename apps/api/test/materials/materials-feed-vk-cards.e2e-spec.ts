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
import { FakeVkApi } from "../../src/materials/vk/vk-api.fake.js";
import { VK_API } from "../../src/materials/vk/vk-api.types.js";
import { VK_CONFIG, type VkConfig } from "../../src/materials/vk/vk-config.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 048 V-30 (#4006) — the feed read serving VK entries over the REAL stack
// (Fastify + Postgres): VK `post` and `video` cards in the EARS-9 order and
// cursor among own materials with the referenced VK image URL as stored;
// removed, hidden and switched-off entries absent and back once restored,
// unhidden or switched on (EARS-48); the read served from the stored entries
// with the VK double down or the connector not configured — the read never
// calls VK (EARS-50). Entries are seeded as the connector writes them (its
// write path is the #4004 suite's subject) inside a far-future instant window
// unique to this run, and every page walk starts just above that window, so
// rows other suites write never interleave.

/** The two ways the connector can be absent while the feed is read (EARS-50). */
const outages: { name: string; config: VkConfig | null }[] = [
  {
    name: "VK unreachable, no Callback events, the source failing",
    config: {
      serviceKey: "vk1.a.E2E-feed_service_key",
      callbackSecret: "e2e-feed-callback-secret",
      confirmation: "e2e-feed-confirm",
    },
  },
  { name: "the connector not configured", config: null },
];

describe.skipIf(!process.env.DATABASE_URL).each(outages)(
  "048 materials feed — VK post and video cards (e2e): $name",
  ({ config }) => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    /** The VK double, down for every call. */
    const vk = new FakeVkApi();
    vk.outage = "network_error";
    const sourceIds: string[] = [];
    const materialIds: string[] = [];
    const windowBase =
      Date.UTC(2920, 0, 1) + Math.floor(Math.random() * 5e6) * 60_000;
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

    /** A bound VK source as an administrator added it, its check failing. */
    async function source(): Promise<{ id: string; groupId: number }> {
      const groupId = 900_000_000 + Math.floor(Math.random() * 99_000_000);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_sources
           (platform, address, status, status_reason, checked_at, vk_group_id, vk_last_event_at)
         VALUES ('vk', $1, 'failing', 'VK недоступен', now(), $2, now())
         RETURNING id`,
        [`e2e_${marker()}`, groupId],
      );
      sourceIds.push(rows[0]!.id);
      return { id: rows[0]!.id, groupId };
    }

    interface VkSeed {
      objectId: number;
      publishedAt: string;
      title?: string;
      imageUrl?: string | null;
      durationSeconds?: number | null;
    }

    /** A VK entry as the connector writes it (048-design §Data model (slice 3)). */
    async function entry(
      s: { id: string; groupId: number },
      kind: "post" | "video",
      seed: VkSeed,
    ): Promise<{ id: string; href: string; title: string }> {
      const title = seed.title ?? `VK ${kind} ${seed.objectId} ${marker()}`;
      const href =
        kind === "post"
          ? `https://vk.com/wall-${s.groupId}_${seed.objectId}`
          : `https://vk.com/video-${s.groupId}_${seed.objectId}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO feed_entries
           (source_platform, source_ref, feed_source_id, kind, title, image_url, source_name,
            href, published_at, duration_seconds)
         VALUES ('vk', $1, $2, $3::feed_entry_kind, $4, $5, $6, $7, $8::timestamptz, $9)
         RETURNING id`,
        [
          `${s.id}:${s.groupId}:${kind}:${seed.objectId}`,
          s.id,
          kind,
          title,
          seed.imageUrl ?? null,
          kind === "post" ? "BBM Academy · VK" : "BBM Academy · VK Видео",
          href,
          seed.publishedAt,
          kind === "video"
            ? (seed.durationSeconds ?? 60)
            : (seed.durationSeconds ?? null),
        ],
      );
      return { id: rows[0]!.id, href, title };
    }

    /** An own material's card in the window, as the own-materials source writes it. */
    async function own(publishedAt: string): Promise<string> {
      const slug = `vk-feed-mat-${marker()}`;
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
        const callsBefore = vk.calls.length;
        const res = await app.inject({
          method: "GET",
          url: `/v1/public/feed?limit=${limit}&cursor=${cursor}`,
        });
        expect(res.statusCode, res.payload).toBe(200);
        // EARS-50 — the read never calls VK.
        expect(vk.calls.slice(callsBefore)).toEqual([]);
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
        .overrideProvider(VK_CONFIG)
        .useValue(config)
        .overrideProvider(VK_API)
        .useValue(vk)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
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

    it("048 EARS-48: when any caller reads the feed, the system shall serve a VK post as a post card and a VK video as a video card — the referenced VK image URL, duration, the VK source, no partner, the vk.com permalink, external", async () => {
      const s = await source();
      const wall = await entry(s, "post", {
        objectId: 501,
        publishedAt: at(30),
        imageUrl: "https://sun9-1.userapi.com/impg/wall-501.jpg?size=604x340",
        durationSeconds: 95,
      });
      const video = await entry(s, "video", {
        objectId: 456239017,
        publishedAt: at(20),
        imageUrl: "https://sun9-2.userapi.com/impg/video-cover.jpg",
        durationSeconds: 3725,
      });
      expect(await walk(24)).toEqual([
        {
          id: wall.id,
          kind: "post",
          text: wall.title,
          publishedAt: new Date(Date.parse(at(30))).toISOString(),
          // Referenced, never copied or signed: the stored URL unchanged.
          image: {
            url: "https://sun9-1.userapi.com/impg/wall-501.jpg?size=604x340",
          },
          duration: 95,
          source: { platform: "vk", name: "BBM Academy · VK" },
          partner: null,
          href: `https://vk.com/wall-${s.groupId}_501`,
          external: true,
        },
        {
          id: video.id,
          kind: "video",
          title: video.title,
          publishedAt: new Date(Date.parse(at(20))).toISOString(),
          image: { url: "https://sun9-2.userapi.com/impg/video-cover.jpg" },
          duration: 3725,
          source: { platform: "vk", name: "BBM Academy · VK Видео" },
          partner: null,
          href: `https://vk.com/video-${s.groupId}_456239017`,
          external: true,
        },
      ]);
    });

    it("048 EARS-48: a VK entry with no preview is served with image null, and a post with no video with duration null", async () => {
      const s = await source();
      const text = await entry(s, "post", {
        objectId: 11,
        publishedAt: at(12),
      });
      const bare = await entry(s, "video", {
        objectId: 12,
        publishedAt: at(11),
        durationSeconds: 40,
      });
      const cards = await walk(24);
      expect(cards.map((c) => [c.id, c.kind, c.image, c.duration])).toEqual([
        [text.id, "post", null, null],
        [bare.id, "video", null, 40],
      ]);
    });

    it("048 EARS-48: VK cards take the EARS-9 order among own materials — newest first, ties by id — and the cursor pages them with no gap or repeat", async () => {
      const s = await source();
      const newest = await entry(s, "post", {
        objectId: 21,
        publishedAt: at(50),
      });
      const ownMid = await own(at(40));
      const tieA = await entry(s, "video", {
        objectId: 22,
        publishedAt: at(30, 7),
      });
      const tieB = await own(at(30, 7));
      const ownOld = await own(at(20));
      const oldest = await entry(s, "post", {
        objectId: 23,
        publishedAt: at(10),
      });
      const tie = [tieA.id, tieB].sort().reverse();
      const expected = [newest.id, ownMid, ...tie, ownOld, oldest.id];
      expect(await ids(24)).toEqual(expected);
      expect(await ids(2)).toEqual(expected);
      expect((await walk(24)).map((c) => c.kind)).toEqual([
        "post",
        "news",
        ...tie.map((id) => (id === tieB ? "news" : "video")),
        "news",
        "post",
      ]);
    });

    it("048 EARS-48: a removed, a hidden and a switched-off source's entry are absent from the feed, and each is back at its own date once restored, unhidden or switched on", async () => {
      const s = await source();
      const off = await source();
      const shown = await entry(s, "post", {
        objectId: 31,
        publishedAt: at(40),
      });
      const removed = await entry(s, "post", {
        objectId: 32,
        publishedAt: at(30),
      });
      const hidden = await entry(s, "video", {
        objectId: 33,
        publishedAt: at(20),
      });
      const ofOff = await entry(off, "post", {
        objectId: 34,
        publishedAt: at(10),
      });
      const all = [shown.id, removed.id, hidden.id, ofOff.id];
      expect(await ids()).toEqual(all);

      await pool.query(
        "UPDATE feed_entries SET removed_at = now() WHERE id = $1",
        [removed.id],
      );
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
        [all],
      );
      expect(kept.rowCount).toBe(4);

      await pool.query(
        "UPDATE feed_entries SET removed_at = NULL WHERE id = $1",
        [removed.id],
      );
      await pool.query(
        "UPDATE feed_entries SET hidden_at = NULL WHERE id = $1",
        [hidden.id],
      );
      await pool.query(
        "UPDATE feed_entries SET source_off = false WHERE feed_source_id = $1",
        [off.id],
      );
      expect(await ids()).toEqual(all);
    });

    it("048 EARS-50: while VK is unreachable, Callback events do not arrive, a VK source is failing or the connector is not configured, the system shall serve the feed read from the stored entries with no error state for that source and every other card as usual, never calling VK", async () => {
      const s = await source();
      const a = await entry(s, "post", {
        objectId: 41,
        publishedAt: at(30),
        imageUrl: "https://sun9-3.userapi.com/impg/gone.jpg",
      });
      const material = await own(at(20));
      const b = await entry(s, "video", { objectId: 42, publishedAt: at(10) });
      const callsBefore = vk.calls.length;
      const cards = await walk(1);
      expect(cards.map((c) => c.id)).toEqual([a.id, material, b.id]);
      expect(cards.map((c) => c.kind)).toEqual(["post", "news", "video"]);
      expect(cards[0]!.image).toEqual({
        url: "https://sun9-3.userapi.com/impg/gone.jpg",
      });
      expect(vk.calls.slice(callsBefore)).toEqual([]);
      expect(vk.outage).toBe("network_error");
    });
  },
);
