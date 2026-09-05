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
      state: "draft" | "published" | "live" | "ended" | "hidden",
      hoursAgo: number,
      overrides: { id?: string; startsAt?: string } = {},
    ) {
      const id = overrides.id ?? randomUUID();
      const slug = `archive-${state}-${id}`;
      const startsAt =
        overrides.startsAt ??
        new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
      await pool.query(
        `INSERT INTO events
       (id, slug, title, school, starts_at, duration_min, description, specialties, state)
       VALUES ($1,$2,$3,'Школа',$4,60,'Описание',ARRAY['Кардиология'],$5)`,
        [id, slug, `Event ${state} ${hoursAgo}`, startsAt, state],
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
      await seed("hidden", 4);
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

    it("EARS-11.1: when past events share a millisecond but differ in microseconds, the descending cursor shall not skip the row after the cutoff", async () => {
      // `timestamptz` stores microseconds; node-postgres hands back a
      // millisecond `Date`. A cursor encoded from that Date is a cutoff strictly
      // EARLIER than the row it came from — on the newest-first archive that
      // truncation does not loop, it SKIPS: every row between the truncated
      // millisecond and the real instant falls outside `starts_at < cutoff` and
      // is never served, so an эфир silently disappears from «Прошедшие» (#1888).
      const newest = await seed("ended", 0, {
        startsAt: "2031-01-01T10:00:00.123456Z",
      });
      const older = await seed("ended", 0, {
        startsAt: "2031-01-01T10:00:00.123001Z",
      });

      const first = await app.inject({
        method: "GET",
        url: "/v1/public/events?timeframe=past&limit=1",
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json() as {
        data: Array<{ id: string }>;
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      expect(firstBody.data.map((event) => event.id)).toEqual([newest.id]);

      const second = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=past&limit=1&cursor=${encodeURIComponent(firstBody.pagination.nextCursor!)}`,
      });
      expect(second.statusCode).toBe(200);
      const secondBody = second.json() as typeof firstBody;
      // The page that follows must serve the next row — neither repeating the
      // row that issued the cursor nor skipping past it.
      expect(secondBody.data.map((event) => event.id)).toEqual([older.id]);
    });

    it("EARS-11.2: when an upcoming event's starts_at carries microsecond precision, the ascending cursor shall advance past the row that issued it", async () => {
      // Just inside the air window, so both rows sort at the FRONT of the
      // ascending upcoming page regardless of what else the branch DB holds.
      const windowStart = Date.now() - (6 * 60 - 10) * 60_000;
      const nearer = await seed("published", 0, {
        startsAt: new Date(windowStart).toISOString().replace("Z", "456Z"),
      });
      const later = await seed("published", 0, {
        startsAt: new Date(windowStart + 60_000)
          .toISOString()
          .replace("Z", "321Z"),
      });

      const listing = await app.inject({
        method: "GET",
        url: "/v1/public/events?timeframe=upcoming&limit=50",
      });
      expect(listing.statusCode).toBe(200);
      const full = listing.json() as {
        data: Array<{ id: string }>;
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      const nearerIndex = full.data.findIndex(
        (event) => event.id === nearer.id,
      );
      expect(nearerIndex).toBeGreaterThanOrEqual(0);

      const boundary = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=upcoming&limit=${nearerIndex + 1}`,
      });
      const boundaryBody = boundary.json() as typeof full;
      expect(boundaryBody.data.at(-1)?.id).toBe(nearer.id);
      expect(boundaryBody.pagination.nextCursor).toEqual(expect.any(String));

      const next = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=upcoming&limit=1&cursor=${encodeURIComponent(boundaryBody.pagination.nextCursor!)}`,
      });
      const nextBody = next.json() as typeof full;
      // The microsecond row must NOT be served again on the next page.
      expect(nextBody.data.map((event) => event.id)).not.toContain(nearer.id);
      expect(nextBody.data.map((event) => event.id)).toEqual([later.id]);
    });

    it("EARS-11.3: when a cursor is not in the grammar this API issues, the listing shall answer 400 rather than let the value reach Postgres", async () => {
      // Well-formed base64url envelope, values outside the issued grammar: a
      // millisecond instant (what the pre-#1888 encoder emitted) and a
      // non-UUID id, which would otherwise reach a `uuid` column as `22P02`.
      const tampered = Buffer.from(
        JSON.stringify({
          startsAt: "2031-01-01T10:00:00.123Z",
          id: "00000000-0000-0000-0000-000000000000",
        }),
        "utf8",
      ).toString("base64url");
      const truncated = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=past&limit=1&cursor=${encodeURIComponent(tampered)}`,
      });
      expect(truncated.statusCode).toBe(400);

      const foreignId = Buffer.from(
        JSON.stringify({
          startsAt: "2031-01-01T10:00:00.123456Z",
          id: "not-a-uuid",
        }),
        "utf8",
      ).toString("base64url");
      const badId = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=past&limit=1&cursor=${encodeURIComponent(foreignId)}`,
      });
      expect(badId.statusCode).toBe(400);
    });

    it("EARS-11: when upcoming events share a start instant, the cursor shall follow the id ASC tie-breaker without skips", async () => {
      const prefix = randomUUID().slice(0, -1);
      const lowerId = `${prefix}1`;
      const higherId = `${prefix}2`;
      const startsAt = new Date(
        Date.now() - (6 * 60 - 2) * 60_000,
      ).toISOString();
      await seed("live", 0, { id: higherId, startsAt });
      await seed("live", 0, { id: lowerId, startsAt });

      const listing = await app.inject({
        method: "GET",
        url: "/v1/public/events?timeframe=upcoming&limit=50",
      });
      expect(listing.statusCode).toBe(200);
      const full = listing.json() as {
        data: Array<{ id: string }>;
        pagination: { nextCursor: string | null };
      };
      const lowerIndex = full.data.findIndex((event) => event.id === lowerId);
      expect(lowerIndex).toBeGreaterThanOrEqual(0);
      expect(
        full.data.slice(lowerIndex, lowerIndex + 2).map((event) => event.id),
      ).toEqual([lowerId, higherId]);

      const boundary = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=upcoming&limit=${lowerIndex + 1}`,
      });
      const boundaryBody = boundary.json() as typeof full;
      expect(boundaryBody.data.at(-1)?.id).toBe(lowerId);
      expect(boundaryBody.pagination.nextCursor).toEqual(expect.any(String));

      const next = await app.inject({
        method: "GET",
        url: `/v1/public/events?timeframe=upcoming&limit=1&cursor=${encodeURIComponent(boundaryBody.pagination.nextCursor!)}`,
      });
      expect(
        (next.json() as typeof full).data.map((event) => event.id),
      ).toEqual([higherId]);
    });
  },
);
