import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { EventsLiveReadSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

/**
 * Wave-2 entry gate §4.3 D5 — `GET /v1/public/events/live`, the Academy's
 * «Идёт сейчас» read over the SAME live resolution as the doctor read,
 * parameterised by audience (019 EARS-6, 012 LD-12).
 *
 * The fixture runs one `experts` эфир and one `doctors` эфир at the same time,
 * so a resolution that forgot its audience would leak one host's эфир onto the
 * other host's block — the assertion both reads make in both directions.
 *
 * Runs against the dev-stand Postgres + the fake IdP, and skips when either is
 * absent so the shared CI unit job stays green.
 */
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "wave-2 D5 Academy events live read (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];

    const createdEmails: string[] = [];
    const eventIds: string[] = [];

    let expertsLive = { id: "", slug: "" };
    let expertsLater = { id: "", slug: "" };
    let doctorsLive = { id: "", slug: "" };
    let registeredSession = "";

    const makeEvent = async (input: {
      title: string;
      startsAt: Date;
      audience: "doctors" | "experts";
    }): Promise<{ id: string; slug: string }> => {
      const id = randomUUID();
      const slug = `alive-${id.slice(0, 8)}`;
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience) VALUES ($1, $2, $3, $4, $5, $6, 'published', ${eventClassificationSql(input.audience)})`,
        [
          id,
          slug,
          input.title,
          "Школа ортобиологии",
          input.startsAt.toISOString(),
          180,
        ],
      );
      eventIds.push(id);
      return { id, slug };
    };

    const setState = async (id: string, state: string): Promise<void> => {
      await pool.query("UPDATE events SET state = $2 WHERE id = $1", [
        id,
        state,
      ]);
    };

    const session = async (prefix: string): Promise<string> => {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      return cookie!.value;
    };

    const read = async (url: string, sessionId?: string) => {
      const response = await app.inject({
        method: "GET",
        url,
        headers:
          sessionId === undefined
            ? { ...device }
            : { ...device, cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      });
      expect(response.statusCode).toBe(200);
      return {
        list: EventsLiveReadSchema.parse(response.json()),
        cacheControl: response.headers["cache-control"],
      };
    };

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      expertsLive = await makeEvent({
        title: "Идущий эфир Академии",
        startsAt: new Date(Date.now() - 60 * 60_000),
        audience: "experts",
      });
      expertsLater = await makeEvent({
        title: "Второй идущий эфир Академии",
        startsAt: new Date(Date.now() - 20 * 60_000),
        audience: "experts",
      });
      doctorsLive = await makeEvent({
        title: "Идущий эфир для врачей",
        startsAt: new Date(Date.now() - 30 * 60_000),
        audience: "doctors",
      });

      // Registration is taken while the event is still `published` — the same
      // order the room suites use — and the state is advanced afterwards.
      registeredSession = await session("alive-registered");
      const reg = await app.inject({
        method: "POST",
        url: `/v1/events/${expertsLive.slug}/registration`,
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${registeredSession}`,
        },
      });
      expect(reg.statusCode).toBe(200);

      for (const event of [expertsLive, expertsLater, doctorsLive]) {
        await setState(event.id, "live");
      }
    }, 120_000);

    afterAll(async () => {
      for (const id of eventIds) await deleteEventFixture(pool, id);
      for (const email of createdEmails) {
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    it("NEW: the Academy read lists every running experts эфир, earliest start first, as a per-viewer no-store body", async () => {
      const { list, cacheControl } = await read("/v1/public/events/live");
      const ids = list.map((strip) => strip.eventId);
      expect(ids).toContain(expertsLive.id);
      expect(ids).toContain(expertsLater.id);
      expect(ids.indexOf(expertsLive.id)).toBeLessThan(
        ids.indexOf(expertsLater.id),
      );
      expect(cacheControl).toBe("private, no-store");
    });

    it("NEW: audience separation — a doctors эфир never reaches the Academy read, an experts эфир never reaches the doctor read", async () => {
      const academy = await read("/v1/public/events/live");
      expect(academy.list.map((strip) => strip.eventId)).not.toContain(
        doctorsLive.id,
      );

      // No specialty cookie ⇒ the untargeted doctor read: every doctors эфир.
      const doctor = await read("/v1/storefront/doctor/events/live");
      const doctorIds = doctor.list.map((strip) => strip.eventId);
      expect(doctorIds).toContain(doctorsLive.id);
      expect(doctorIds).not.toContain(expertsLive.id);
      expect(doctorIds).not.toContain(expertsLater.id);
    });

    it("NEW: the Academy href is the Academy route table's — the event page for a guest, the room for a registered viewer", async () => {
      const guest = await read("/v1/public/events/live");
      const guestStrip = guest.list.find((s) => s.eventId === expertsLive.id);
      expect(guestStrip?.href).toBe(`/webinars/${expertsLive.slug}`);
      expect(guestStrip?.viewerIsRegistered).toBe(false);

      const registered = await read(
        "/v1/public/events/live",
        registeredSession,
      );
      const own = registered.list.find((s) => s.eventId === expertsLive.id);
      expect(own?.href).toBe(`/webinars/${expertsLive.slug}/room`);
      expect(own?.viewerIsRegistered).toBe(true);
    });

    it("NEW: an experts эфир whose room closed leaves the Academy read on the next call", async () => {
      await setState(expertsLater.id, "ended");
      try {
        const { list } = await read("/v1/public/events/live");
        expect(list.map((strip) => strip.eventId)).not.toContain(
          expertsLater.id,
        );
      } finally {
        await setState(expertsLater.id, "live");
      }
    });
  },
);
