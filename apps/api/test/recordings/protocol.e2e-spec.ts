import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  ADMIN_DEVICE,
  adminHeaders,
  establishAdminSession,
} from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 014 EARS-17 (#1349) — the CROSS-route write-protocol floor.
//
// Every 014 mutation already has a suite that proves ITS behaviour:
// `lifecycle.e2e-spec.ts` drives attach and the four commands, and
// `../events/legacy-lifecycle.e2e-spec.ts` drives the legacy machine. What no
// suite proves is the invariant EARS-17 actually states — that the SAME floor
// holds on EVERY mutating recording endpoint, in the same order, with the same
// codes and the same «refused and changed nothing» guarantee. That is a property
// a reader can only observe by holding the routes side by side.
//
// So this suite seeds one graph and drives the whole 014 mutation table from a
// route descriptor. A regression that gives one route its own key handling, its
// own precondition order, its own refusal status or a refusal that half-applies
// fails HERE and nowhere else. The per-route suites stay: they own the DOMAIN,
// this one owns the PROTOCOL.
//
// The floor, per EARS-17 and 014-design §10/§11:
//
//   1. canonical UUID `Idempotency-Key` on every mutation — absent/blank 428
//      `IDEMPOTENCY_KEY_REQUIRED`, malformed 400 `IDEMPOTENCY_KEY_INVALID`
//   2. target ETag on every NON-create method — absent 428
//      `PRECONDITION_REQUIRED`, stale 412 `PRECONDITION_FAILED`
//   3. only the dedicated MFA-verified admin session with a LIVE `platform_admin`
//      grant — 401 `ADMIN_SESSION_REQUIRED`, 403 `PLATFORM_ADMIN_REQUIRED`
//   4. public announcement reads zero-auth, playback reads `authenticated`
//   5. every failure an RFC 7807 document with `traceId` and an exact
//      `errorCode`, and never a 5xx
//   6. every COMMITTED mutation appends a feature-010 `audit_ledger` row
//
// Refusals are asserted against a SNAPSHOT rather than a hand-picked column:
// each route carries a probe that reads back everything the route could have
// touched (the recording rows, the event row, the audit rows), and a refusal has
// to leave that snapshot byte-identical. «Refused» and «refused without a side
// effect» are different guarantees and only the second one is EARS-17.
//
// `PATCH /v1/admin/events/:id` appears in 014-design §10 because 014 adds the
// `recordingExpectedBy` FIELD to feature 007's multipart event edit — it is not
// itself a mutating RECORDING endpoint, so the idempotency/ETag floor is not its
// contract. It is swept here for the parts of EARS-17 that DO bind it: the admin
// session requirement and the RFC 7807 refusal shape.

const RUTUBE_REF = "0123456789abcdef0123456789abcdef";
/** Uppercase hex — a UUID by RFC, NOT canonical text per `CANONICAL_UUID_REGEX`. */
const NON_CANONICAL_KEY = randomUUID().toUpperCase();
/** A stale validator: no fixture in this suite ever reaches version 99. */
const STALE_IF_MATCH = 'W/"99"';

interface Fixture {
  eventId: string;
  recordingId: string;
}

/** What a route could have touched; a refusal must leave it identical. */
interface Snapshot {
  recordings: unknown[];
  event: unknown;
  audit: number;
  strayEvents: number;
}

interface RouteCase {
  /** Test-title fragment: the route as an operator names it. */
  name: string;
  method: "POST" | "PATCH";
  url: (f: Fixture) => string;
  /** JSON body, or `undefined` for a bodyless command. */
  payload?: (f: Fixture) => Record<string, unknown>;
  /**
   * A create asserts no prior version, so it takes no `If-Match` (014-design
   * §3.1). Everything else is conditional and owes both headers.
   */
  conditional: boolean;
  /**
   * `false` for feature 007's multipart event edit, which carries the 014 field
   * but not the 014 write protocol — see the header note.
   */
  protocolFloor: boolean;
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-17 cross-route recording write protocol (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];
    const usedKeys: string[] = [];
    /** Slugs a legacy-broadcast create attempt was allowed to claim. */
    const claimedSlugs: string[] = [];
    let adminSid: string;
    let adminSub: string;
    let doctorSid: string;

    // ── Principals ─────────────────────────────────────────────────────────

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function registeredSub(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      return rows[0]!.zitadel_sub;
    }

    /** An admin session held by a `platform_admin`; returns `{ sid, sub }`. */
    async function adminSession(): Promise<{ sid: string; sub: string }> {
      const email = uniqueEmail("p1349-admin");
      const sub = await registeredSub(email);
      await fake.grantProjectRole(sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device: ADMIN_DEVICE,
      });
      return { sid: admin.sid, sub };
    }

    /** A doctor-portal (non-admin tier) session cookie value. */
    async function doctorSession(): Promise<string> {
      const email = uniqueEmail("p1349-doctor");
      await registeredSub(email);
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    }

    // ── Fixtures ───────────────────────────────────────────────────────────

    function key(): string {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    }

    async function insertEvent(state = "ended"): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state)
         VALUES ($1, $2, $3, now() - interval '2 days', 90, $4)
         RETURNING id`,
        [
          `rec-1349-${randomUUID()}`,
          "Мероприятие 1349",
          "Кардиология сегодня",
          state,
        ],
      );
      const id = rows[0]!.id;
      createdEventIds.push(id);
      return id;
    }

    /** One `ended` event carrying one attached (draft, version 1) recording. */
    async function seed(): Promise<Fixture> {
      const eventId = await insertEvent("ended");
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${eventId}/recordings`,
        headers: {
          ...ADMIN_DEVICE,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { kind: "edited", provider: "rutube", embedRef: RUTUBE_REF },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload) as { id: string; version: number };
      expect(body.version).toBe(1);
      return { eventId, recordingId: body.id };
    }

    function legacyPayload(slug: string): Record<string, unknown> {
      claimedSlugs.push(slug);
      return {
        title: `Архивный эфир ${slug}`,
        heldAtMsk: "2024-03-14T18:00",
        durationMin: 90,
        recording: {
          kind: "edited",
          provider: "rutube",
          embedRef: RUTUBE_REF,
        },
      };
    }

    // ── The 014 mutation table (014-design §10, core wave) ──────────────────

    const MUTATIONS: RouteCase[] = [
      {
        name: "POST /v1/admin/events/:id/recordings",
        method: "POST",
        url: (f) => `/v1/admin/events/${f.eventId}/recordings`,
        payload: () => ({
          kind: "raw",
          provider: "rutube",
          embedRef: RUTUBE_REF,
        }),
        conditional: false,
        protocolFloor: true,
      },
      {
        name: "PATCH /v1/admin/events/:id/recordings/:rid",
        method: "PATCH",
        url: (f) =>
          `/v1/admin/events/${f.eventId}/recordings/${f.recordingId}`,
        payload: () => ({ durationSec: 4200 }),
        conditional: true,
        protocolFloor: true,
      },
      ...(["publish", "unpublish", "retire", "restore"] as const).map(
        (command): RouteCase => ({
          name: `POST /v1/admin/events/:id/recordings/:rid/${command}`,
          method: "POST",
          url: (f) =>
            `/v1/admin/events/${f.eventId}/recordings/${f.recordingId}/${command}`,
          conditional: true,
          protocolFloor: true,
        }),
      ),
      {
        name: "POST /v1/admin/legacy-broadcasts",
        method: "POST",
        url: () => "/v1/admin/legacy-broadcasts",
        payload: () => legacyPayload(`p1349-${randomUUID()}`),
        conditional: false,
        protocolFloor: true,
      },
      {
        name: "POST /v1/admin/events/:id/archive-legacy",
        method: "POST",
        url: (f) => `/v1/admin/events/${f.eventId}/archive-legacy`,
        conditional: true,
        protocolFloor: true,
      },
      {
        name: "POST /v1/admin/events/:id/hide-legacy",
        method: "POST",
        url: (f) => `/v1/admin/events/${f.eventId}/hide-legacy`,
        conditional: true,
        protocolFloor: true,
      },
      {
        name: "PATCH /v1/admin/events/:id (recordingExpectedBy)",
        method: "PATCH",
        url: (f) => `/v1/admin/events/${f.eventId}`,
        conditional: true,
        protocolFloor: false,
      },
    ];

    // ── Request driving ────────────────────────────────────────────────────

    interface CallOpts {
      /** `""` sends NO header; `undefined` sends a fresh canonical key. */
      idempotencyKey?: string;
      /** `""` sends NO header. */
      ifMatch?: string;
      /** Admin session to present; `null` sends none (anonymous). */
      sid?: string | null;
      /** Doctor-tier cookie to present instead of an admin session. */
      doctorCookie?: string;
    }

    async function call(route: RouteCase, f: Fixture, opts: CallOpts = {}) {
      const payload = route.payload?.(f);
      const auth =
        opts.doctorCookie !== undefined
          ? { cookie: `${SESSION_COOKIE_NAME}=${opts.doctorCookie}` }
          : opts.sid === null
            ? {}
            : adminHeaders(opts.sid ?? adminSid);
      const idem =
        opts.idempotencyKey === ""
          ? {}
          : { "idempotency-key": opts.idempotencyKey ?? key() };
      const cond =
        !route.conditional || opts.ifMatch === ""
          ? {}
          : { "if-match": opts.ifMatch ?? 'W/"1"' };
      return app.inject({
        method: route.method,
        url: route.url(f),
        headers: {
          ...ADMIN_DEVICE,
          ...auth,
          ...idem,
          ...cond,
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        ...(payload === undefined ? {} : { payload }),
      });
    }

    // ── Assertions ─────────────────────────────────────────────────────────

    /**
     * Every 014 refusal is one RFC 7807 document (014-design §11): the
     * problem media type, the four core members, the exact `errorCode` and a
     * non-empty `traceId` — and never a 5xx, because 014 defines none.
     */
    function expectProblem(
      res: { statusCode: number; headers: Record<string, unknown>; payload: string },
      status: number,
      errorCode: string,
    ): void {
      expect(res.statusCode).toBe(status);
      expect(res.statusCode).toBeLessThan(500);
      expect(String(res.headers["content-type"])).toContain(
        "application/problem+json",
      );
      const body = JSON.parse(res.payload) as Record<string, unknown>;
      expect(body).toMatchObject({ status, errorCode });
      expect(typeof body.type).toBe("string");
      expect(body.type).not.toBe("");
      expect(typeof body.title).toBe("string");
      expect(body.title).not.toBe("");
      expect(typeof body.detail).toBe("string");
      expect(body.detail).not.toBe("");
      expect(typeof body.traceId).toBe("string");
      expect(body.traceId).not.toBe("");
    }

    /** Everything the 014 mutation table could touch, for the no-side-effect check. */
    async function snapshot(f: Fixture): Promise<Snapshot> {
      const recordings = (
        await pool.query(
          `SELECT id, kind, status, version, embed_ref, duration_sec,
                  first_published_at, deleted_at
             FROM event_recordings WHERE event_id = $1 ORDER BY id`,
          [f.eventId],
        )
      ).rows;
      const event = (
        await pool.query(
          "SELECT state, version, title, recording_expected_by FROM events WHERE id = $1",
          [f.eventId],
        )
      ).rows[0];
      const audit = Number(
        (
          await pool.query(
            `SELECT count(*) FROM audit_ledger
              WHERE metadata->'pk'->>'id' = ANY($1::text[])`,
            [[f.eventId, f.recordingId]],
          )
        ).rows[0]!.count,
      );
      // A refused legacy-broadcast create must not have authored a NEW эфир.
      const strayEvents = Number(
        (
          await pool.query(
            "SELECT count(*) FROM events WHERE title LIKE 'Архивный эфир p1349-%'",
          )
        ).rows[0]!.count,
      );
      return { recordings, event, audit, strayEvents };
    }

    /** Drive `opts`, assert the refusal AND that nothing moved. */
    async function expectRefusedWithoutSideEffect(
      route: RouteCase,
      f: Fixture,
      opts: CallOpts,
      status: number,
      errorCode: string,
    ): Promise<void> {
      const before = await snapshot(f);
      const res = await call(route, f, opts);
      expectProblem(res, status, errorCode);
      expect(await snapshot(f)).toEqual(before);
    }

    // ── Boot ───────────────────────────────────────────────────────────────

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
      // 007's event edit is multipart, and it is one of the swept routes.
      await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      const admin = await adminSession();
      adminSid = admin.sid;
      adminSub = admin.sub;
      doctorSid = await doctorSession();
    });

    afterEach(async () => {
      for (const slug of claimedSlugs.splice(0)) {
        const { rows } = await pool.query<{ id: string }>(
          "SELECT id FROM events WHERE title = $1",
          [`Архивный эфир ${slug}`],
        );
        for (const row of rows) {
          await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
            row.id,
          ]);
          await deleteEventFixture(pool, row.id);
        }
      }
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
      // The grant is re-asserted: the 403 case revokes it mid-suite.
      await fake.grantProjectRole(adminSub, "platform_admin");
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    // ── 17.1 — the Idempotency-Key floor ───────────────────────────────────

    for (const route of MUTATIONS.filter((r) => r.protocolFloor)) {
      it(`014 EARS-17.1: ${route.name} without an Idempotency-Key shall be refused 428 IDEMPOTENCY_KEY_REQUIRED and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { idempotencyKey: "" },
          428,
          "IDEMPOTENCY_KEY_REQUIRED",
        );
      });

      it(`014 EARS-17.1: ${route.name} with a blank Idempotency-Key shall be refused 428 IDEMPOTENCY_KEY_REQUIRED and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { idempotencyKey: "   " },
          428,
          "IDEMPOTENCY_KEY_REQUIRED",
        );
      });

      it(`014 EARS-17.1: ${route.name} with a non-canonical Idempotency-Key shall be refused 400 IDEMPOTENCY_KEY_INVALID and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { idempotencyKey: "not-a-uuid" },
          400,
          "IDEMPOTENCY_KEY_INVALID",
        );
        // Uppercase hex is a UUID by RFC and still NOT canonical text — the
        // key is a database identity, so one request must have one spelling.
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { idempotencyKey: NON_CANONICAL_KEY },
          400,
          "IDEMPOTENCY_KEY_INVALID",
        );
      });
    }

    // ── 17.2 — the ETag precondition floor (non-create methods) ────────────

    for (const route of MUTATIONS.filter(
      (r) => r.protocolFloor && r.conditional,
    )) {
      it(`014 EARS-17.2: ${route.name} without an If-Match shall be refused 428 PRECONDITION_REQUIRED and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { ifMatch: "" },
          428,
          "PRECONDITION_REQUIRED",
        );
      });

      it(`014 EARS-17.2: ${route.name} with a stale or unusable If-Match shall be refused 412 PRECONDITION_FAILED and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { ifMatch: STALE_IF_MATCH },
          412,
          "PRECONDITION_FAILED",
        );
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { ifMatch: "not-a-validator" },
          412,
          "PRECONDITION_FAILED",
        );
      });
    }

    // ── 17.2b — the key is checked BEFORE the precondition ─────────────────

    it("014 EARS-17.2: a mutation missing BOTH headers shall answer the Idempotency-Key refusal, not the precondition one", async () => {
      const f = await seed();
      // The failure ORDER is the contract (014-design §3.1): key shape, then
      // If-Match. A route that answered PRECONDITION_REQUIRED here would make a
      // client fix the wrong header.
      for (const route of MUTATIONS.filter(
        (r) => r.protocolFloor && r.conditional,
      )) {
        const res = await call(route, f, { idempotencyKey: "", ifMatch: "" });
        expectProblem(res, 428, "IDEMPOTENCY_KEY_REQUIRED");
      }
    });

    // ── 17.3 — the admin-session floor ─────────────────────────────────────

    for (const route of MUTATIONS) {
      it(`014 EARS-17.3: ${route.name} shall refuse an anonymous caller 401 ADMIN_SESSION_REQUIRED and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { sid: null },
          401,
          "ADMIN_SESSION_REQUIRED",
        );
      });

      it(`014 EARS-17.3: ${route.name} shall refuse a doctor-tier session 401 ADMIN_SESSION_REQUIRED and change nothing`, async () => {
        const f = await seed();
        await expectRefusedWithoutSideEffect(
          route,
          f,
          { doctorCookie: doctorSid },
          401,
          "ADMIN_SESSION_REQUIRED",
        );
      });
    }

    it("014 EARS-17.3: an admin session whose platform_admin grant is gone shall be refused 403 PLATFORM_ADMIN_REQUIRED and change nothing", async () => {
      const f = await seed();
      // The session record survives; what changed is the LIVE grant. Only a
      // route that revalidates against the IdP per request can see that, which
      // is precisely why every 014 mutation carries `revalidate: "live"`.
      await fake.revokeProjectRole(adminSub, "platform_admin");
      for (const route of MUTATIONS.filter((r) => r.protocolFloor)) {
        await expectRefusedWithoutSideEffect(
          route,
          f,
          {},
          403,
          "PLATFORM_ADMIN_REQUIRED",
        );
      }
    });

    // ── 17.6 — a committed mutation is audited ─────────────────────────────

    it("014 EARS-17.6: a committed recording mutation shall append a feature-010 audit row for the recording", async () => {
      const f = await seed();
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${f.eventId}/recordings/${f.recordingId}/publish`,
        headers: {
          ...ADMIN_DEVICE,
          ...adminHeaders(adminSid),
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
      });
      expect(res.statusCode).toBe(200);
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [f.recordingId],
      );
      expect(rows.map((r) => r.event_type)).toContain(
        "data.event_recordings.update",
      );
      expect(rows.every((r) => r.subject_id !== null)).toBe(true);
    });

    it("014 EARS-17.6: a committed legacy-broadcast create shall append a feature-010 audit row for the эфир", async () => {
      const slug = `p1349-${randomUUID()}`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/legacy-broadcasts",
        headers: {
          ...ADMIN_DEVICE,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: legacyPayload(slug),
      });
      expect(res.statusCode).toBe(201);
      const created = JSON.parse(res.payload) as { id: string };
      const { rows } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [created.id],
      );
      expect(rows.map((r) => r.event_type)).toContain("data.events.insert");
    });

    // ── 17.4 — the read floor ──────────────────────────────────────────────

    it("014 EARS-17.4: the public announcement reads shall answer an anonymous caller", async () => {
      const f = await seed();
      const list = await app.inject({
        method: "GET",
        url: "/v1/public/events",
      });
      expect(list.statusCode).toBe(200);
      const detail = await app.inject({
        method: "GET",
        url: `/v1/public/events/${f.eventId}`,
      });
      expect([200, 404]).toContain(detail.statusCode);
    });

    it("014 EARS-17.4: the playback read shall refuse an anonymous caller 401 AUTHENTICATION_REQUIRED and answer an authenticated one", async () => {
      const f = await seed();
      const anon = await app.inject({
        method: "GET",
        url: `/v1/events/${f.eventId}/recordings`,
      });
      expectProblem(anon, 401, "AUTHENTICATION_REQUIRED");
      const authed = await app.inject({
        method: "GET",
        url: `/v1/events/${f.eventId}/recordings`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${doctorSid}` },
      });
      expect(authed.statusCode).toBe(200);
    });

    it("014 EARS-17.4: the admin recording list and the doctor's own-events tab shall refuse an anonymous caller", async () => {
      const f = await seed();
      const adminList = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${f.eventId}/recordings`,
      });
      expectProblem(adminList, 401, "ADMIN_SESSION_REQUIRED");
      const mine = await app.inject({
        method: "GET",
        url: "/v1/me/events?tab=recordings",
      });
      expect(mine.statusCode).toBe(401);
    });
  },
);
