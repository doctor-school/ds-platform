import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { deleteEventFixture } from "../setup/fixture-cleanup.js";

describe.skipIf(!process.env.DATABASE_URL)(
  "014 EARS-11 public event archive",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const created: string[] = [];

    async function seed(
      state: "draft" | "published" | "live" | "ended" | "archived",
      hoursAgo: number,
    ) {
      const id = randomUUID();
      const slug = `archive-${state}-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events
       (id, slug, title, school, starts_at, duration_min, description, specialties, state)
       VALUES ($1,$2,$3,'Школа',now() - ($4 * interval '1 hour'),60,'Описание',ARRAY['Кардиология'],$5)`,
        [id, slug, `Event ${state} ${hoursAgo}`, hoursAgo, state],
      );
      await pool.query(
        `INSERT INTO event_speakers (event_id, position, name, regalia) VALUES ($1,0,'Доктор','')`,
        [id],
      );
      created.push(id);
      return { id, slug };
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart);
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of created.splice(0)) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
    });
    afterAll(async () => app.close());

    it("EARS-11: when past events are requested, the public endpoint shall return ended events newest-first with counts, cursor and recording badge", async () => {
      // Far-future fixture instants keep this page deterministic even if a shared
      // branch DB already contains unrelated ended events.
      const newest = await seed("ended", -640_000);
      const older = await seed("ended", -630_000);
      await seed("draft", 3);
      await seed("archived", 4);
      await seed("published", -2);
      await pool.query(
        `INSERT INTO event_recordings
       (event_id, kind, provider, embed_ref, status, first_published_at)
       VALUES ($1,'raw','rutube','0123456789abcdef0123456789abcdef','published',now())`,
        [newest.id],
      );

      const first = await app.inject({
        method: "GET",
        url: "/v1/public/events?timeframe=past&limit=1",
      });
      expect(first.statusCode).toBe(200);
      const body = first.json() as {
        data: Array<{
          id: string;
          state: string;
          recording: { state: string };
        }>;
        counts: { upcoming: number; past: number };
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      expect(body.data.map((event) => event.id)).toEqual([newest.id]);
      expect(body.data[0]?.recording.state).toBe("raw-only");
      expect(body.counts.past).toBeGreaterThanOrEqual(2);
      expect(body.counts.upcoming).toBeGreaterThanOrEqual(1);
      expect(body.pagination.hasMore).toBe(true);
      expect(body.pagination.nextCursor).toEqual(expect.any(String));

      const second = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=past&limit=1&cursor=${encodeURIComponent(body.pagination.nextCursor!)}`,
      });
      expect(second.statusCode).toBe(200);
      expect(
        (second.json() as typeof body).data.map((event) => event.id),
      ).toEqual([older.id]);

      const malformed = await app.inject({
        method: "GET",
        url: "/v1/public/events?timeframe=past&cursor=not-issued",
      });
      expect(malformed.statusCode).toBe(400);
    });
  },
);
