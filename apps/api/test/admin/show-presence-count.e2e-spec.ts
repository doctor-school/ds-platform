import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { PresenceHeartbeatAckSchema, RoomConfigSchema } from "@ds/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import {
  eventClassification,
  eventClassificationSql,
} from "../setup/event-classification.js";

// 007 EARS-13 (#2911) — the event editor's «Показывать зрителям число
// участников»: `CreateEvent` defaults it off, `UpdateEvent` sets it only when
// the key is present, the admin detail returns the setting's own state (never a
// count), an event that existed before the migration reads `false`, and the
// room read follows it — a doctor receives the live count only while it is on,
// a staff session either way (006 EARS-19). Runs against the dev-stand Postgres
// + the fake IdP; skips when DATABASE_URL or IDP_ISSUER is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-13 «Показывать зрителям число участников» (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    const validPayload = {
      title: "Актуальная терапия ХСН",
      school: "Кардиология сегодня",
      startsAtMsk: "2026-07-17T19:00",
      ...eventClassification(),
      durationMin: 90,
      description: "Разбор клинических рекомендаций.",
      specialties: ["cardiology"],
      partnerRef: "sponsor:acme-pharma",
    };

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function registerAccount(email: string, staff: boolean) {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      if (!staff) return;
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
    }

    async function adminSid(): Promise<string> {
      const email = uniqueEmail("admin13");
      await registerAccount(email, true);
      return (
        await establishAdminSession(app, {
          identifier: email,
          password,
          device,
        })
      ).sid;
    }

    async function portalCookie(staff: boolean): Promise<string> {
      const email = uniqueEmail(staff ? "staff13" : "doctor13");
      await registerAccount(email, staff);
      return signIn(app, email, password, { device });
    }

    function payloadBody(payload: Record<string, unknown>) {
      const boundary = `----ds2911${Math.random().toString(16).slice(2)}`;
      return {
        body: Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(
            payload,
          )}\r\n--${boundary}--\r\n`,
        ),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    async function create(
      sid: string,
      overrides: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
      const mp = payloadBody({ ...validPayload, ...overrides });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...authHeaders(sid),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as Record<string, unknown>;
      createdEventIds.push(body.id as string);
      return body;
    }

    async function patch(
      sid: string,
      id: string,
      payload: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const mp = payloadBody(payload);
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${id}`,
        headers: {
          ...device,
          ...authHeaders(sid),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(200);
      return res.json() as Record<string, unknown>;
    }

    async function detail(sid: string, id: string) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${id}`,
        headers: { ...device, ...authHeaders(sid) },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as Record<string, unknown>;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM presence_beats WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("007 EARS-13: the setting defaults off on create, is set by create and update, survives an edit that omits it, and the detail returns its own state — never a count", async () => {
      const sid = await adminSid();

      const plain = await create(sid);
      expect(plain.showPresenceCount).toBe(false);
      expect((await detail(sid, plain.id as string)).showPresenceCount).toBe(
        false,
      );

      const shown = await create(sid, { showPresenceCount: true });
      const id = shown.id as string;
      expect(shown.showPresenceCount).toBe(true);
      const read = await detail(sid, id);
      expect(read.showPresenceCount).toBe(true);
      expect("presenceCount" in read).toBe(false);

      expect(
        (await patch(sid, id, { title: "Со счётчиком" })).showPresenceCount,
      ).toBe(true);
      expect(
        (await patch(sid, id, { showPresenceCount: false })).showPresenceCount,
      ).toBe(false);
      const { rows } = await pool.query<{ show_presence_count: boolean }>(
        "SELECT show_presence_count FROM events WHERE id = $1",
        [id],
      );
      expect(rows[0]?.show_presence_count).toBe(false);
    });

    it("007 EARS-13: an event written without the column (as every pre-migration event was) reads `false`", async () => {
      const sid = await adminSid();
      const id = randomUUID();
      await pool.query(
        `INSERT INTO events (id, slug, title, school, starts_at, duration_min, state, kind_id, audience)
         VALUES ($1, $2, 'Старое событие', 'Школа', now(), 60, 'draft', ${eventClassificationSql()})`,
        [id, `legacy13-${id.slice(0, 8)}`],
      );
      createdEventIds.push(id);
      expect((await detail(sid, id)).showPresenceCount).toBe(false);
    });

    it("007 EARS-13: a doctor's room read of the live event carries the count only while the setting is on; a staff read carries it either way (006 EARS-19)", async () => {
      const sid = await adminSid();
      const event = await create(sid);
      const id = event.id as string;
      const slug = event.slug as string;
      await pool.query("UPDATE events SET state = 'live' WHERE id = $1", [id]);

      const doctor = await portalCookie(false);
      const staff = await portalCookie(true);
      for (const cookie of [doctor, staff]) {
        const res = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/registration`,
          headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
        });
        expect(res.statusCode).toBe(200);
      }
      const beat = async (cookie: string) => {
        const res = await app.inject({
          method: "POST",
          url: `/v1/events/${slug}/heartbeat`,
          headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
        });
        expect(res.statusCode).toBe(200);
        return PresenceHeartbeatAckSchema.parse(res.json()).presenceCount;
      };
      const room = async (cookie: string) => {
        const res = await app.inject({
          method: "GET",
          url: `/v1/events/${slug}/room`,
          headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
        });
        expect(res.statusCode).toBe(200);
        return RoomConfigSchema.parse(res.json()).presenceCount;
      };

      expect(await beat(doctor)).toBeNull();
      expect(await room(doctor)).toBeNull();
      expect(await room(staff)).toBe(1);

      await patch(sid, id, { showPresenceCount: true });
      expect(await room(doctor)).toBe(1);
      expect(await room(staff)).toBe(1);
    });
  },
);
