import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { SpecialtyFeedSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "../../src/storefront/specialty-choice.cookie.js";

/**
 * 018 EARS-1 (#1496) — `GET /v1/storefront/feed/{specialty}`, the specialty
 * feed envelope (018-design §7, LD-1).
 *
 * The envelope is validated against the `.strict()` SSOT on every read, so a
 * ranking score, a weighting or a personalisation flag in the body fails the
 * parse, and a block kind that is not connected is not even a member of the
 * schema's enum.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "018 EARS-1 specialty feed envelope (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let code = "";
    let otherCode = "";

    const read = (specialty: string, cookie?: string) =>
      app.inject({
        method: "GET",
        url: `/v1/storefront/feed/${encodeURIComponent(specialty)}`,
        headers: cookie ? { cookie } : {},
      });

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      const rows = await pool.query<{ code: string }>(
        "SELECT code FROM specialties_minzdrav WHERE is_other = false ORDER BY code LIMIT 2",
      );
      code = rows.rows[0]!.code;
      otherCode = rows.rows[1]!.code;
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-1: when a visitor opens the feed of a specialty, system shall answer the envelope with the specialty, the connected blocks in the F-018-1 order (events first) and the `events-first` order constant", async () => {
      const response = await read(code);
      expect(response.statusCode).toBe(200);
      const feed = SpecialtyFeedSchema.parse(response.json());
      expect(feed.specialty.code).toBe(code);
      expect(feed.order).toBe("events-first");
      expect(feed.blocks.map((block) => block.kind)).toEqual(["events"]);
      expect(feed.blocks[0]!.read).toBe(
        `/v1/storefront/feed/${encodeURIComponent(code)}/events`,
      );
      expect(feed.viewer).toEqual({ loggedIn: false });
    });

    it("EARS-1: a content type that is not connected has no `blocks` entry — no schools, lessons, leaderboard or communities key anywhere in the body", async () => {
      const response = await read(code);
      const raw = response.body;
      const kinds = (
        response.json() as { blocks: { kind: string }[] }
      ).blocks.map((block) => block.kind);
      for (const absent of [
        "schools",
        "lessons",
        "leaderboard",
        "communities",
      ]) {
        expect(kinds).not.toContain(absent);
        expect(raw).not.toContain(absent);
      }
    });

    it("EARS-1: two visitors of one specialty see the same blocks in the same order, whatever specialty each one remembers — and no field carries a ranking, a weighting or a personalisation flag", async () => {
      const first = await read(
        code,
        `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(code)}`,
      );
      const second = await read(
        code,
        `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(otherCode)}`,
      );
      const a = SpecialtyFeedSchema.parse(first.json());
      const b = SpecialtyFeedSchema.parse(second.json());
      expect(a.blocks).toEqual(b.blocks);
      expect(a.order).toBe(b.order);
      for (const body of [first.body, second.body]) {
        expect(body).not.toMatch(/rank|score|weight|personali[sz]/i);
        expect(body).not.toContain("на основе ваших данных");
      }
    });

    it("EARS-1: the envelope names the specialty the PATH names, not the remembered one", async () => {
      const response = await read(
        otherCode,
        `${SPECIALTY_CHOICE_COOKIE_NAME}=${encodeURIComponent(code)}`,
      );
      const feed = SpecialtyFeedSchema.parse(response.json());
      expect(feed.specialty.code).toBe(otherCode);
    });

    it("EARS-1: a path naming no member of the specialty book is an honest RFC 7807 not-found, never a crash or an empty envelope", async () => {
      const response = await read("no-such-specialty");
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      const body = response.json() as {
        errorCode: string;
        status: number;
        detail?: string;
      };
      expect(body.errorCode).toBe("SPECIALTY_FEED_NOT_FOUND");
      expect(body.status).toBe(404);
      // `instance` is the request path (RFC 7807); no other field echoes it.
      expect(body.detail ?? "").not.toContain("no-such-specialty");
    });
  },
);
