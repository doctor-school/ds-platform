import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { asSlotConflict } from "../../src/taxonomy/taxonomy.errors.js";

// 012 EARS-7 (#1289) — the admin expert↔event link over the REAL stack:
// Fastify + the 011 admin session + Postgres.
//
// What this suite has to prove is narrower and sharper than «the CRUD works».
// Since the EARS-24 cutover (#1607) the link is the SOLE source of an event's
// public speaker projection, and the product invariant is that the projection
// stays single-valued and never silently loses a name. Two rules carry that:
//
//   1. one link per expert per event, retained rows included — a retired link
//      is RESTORED, never re-created, so its row must stay reserved;
//   2. one ACTIVE link per position. The rule is ELIGIBILITY-BLIND: two draft
//      experts still collide, because the index that enforces it is, and an
//      operator authoring a roster before publishing must be told at the point
//      of the mistake rather than after the publish flips it visible.
//
// Rule 2 is why the check lives inside the transaction, under the §2.3 locks,
// rather than in an optimistic pre-flight read.
//
// Skips when the stand is absent, exactly as the sibling admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-7 admin expert-to-event link (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    function key(): string {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    }

    async function adminSession(): Promise<string> {
      const email = uniqueEmail("ee-admin");
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
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
    }

    // ── Fixtures ───────────────────────────────────────────────────────────

    async function insertEvent(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
         VALUES ($1, $2, $3, now(), 60) RETURNING id`,
        [`e-1289-${randomUUID()}`, "Эфир 1289", "Школа 1289"],
      );
      createdEventIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /** By default a PUBLISHED expert — the eligible, visible lifecycle. */
    async function insertExpert(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: `x-1289-${randomUUID()}`,
        family_name: "Иванова",
        given_name: "И. И.",
        status: "published",
        first_published_at: new Date(),
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      createdExpertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /** A DRAFT expert — linkable, but invisible, so it suppresses nothing. */
    function insertDraftExpert(): Promise<string> {
      return insertExpert({ status: "draft", first_published_at: null });
    }

    // ── Request helpers ────────────────────────────────────────────────────

    interface Mutation {
      payload?: Record<string, unknown>;
      idempotencyKey?: string;
      ifMatch?: string;
    }

    function mutationHeaders({ idempotencyKey, ifMatch }: Mutation) {
      return {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
        ...(idempotencyKey === undefined
          ? { "idempotency-key": key() }
          : idempotencyKey === ""
            ? {}
            : { "idempotency-key": idempotencyKey }),
        ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
      };
    }

    function createLink(opts: Mutation) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/event-experts",
        headers: mutationHeaders(opts),
        payload: opts.payload ?? {},
      });
    }

    function patchLink(id: string, opts: Mutation) {
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/event-experts/${id}`,
        headers: mutationHeaders(opts),
        payload: opts.payload ?? {},
      });
    }

    function transitionLink(
      id: string,
      transition: "retire" | "restore",
      opts: Mutation,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/event-experts/${id}/${transition}`,
        headers: mutationHeaders(opts),
        payload: {},
      });
    }

    function readLink(id: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/event-experts/${id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
    }

    interface LinkDetail {
      id: string;
      eventId: string;
      expertId: string;
      role: string | null;
      position: number;
      status: "active" | "retired";
      version: number;
      createdAt: string;
      updatedAt: string;
    }

    function body(res: { payload: string }): LinkDetail {
      return JSON.parse(res.payload) as LinkDetail;
    }

    function problem(res: { payload: string }): {
      errorCode: string;
      title: string;
      status: number;
    } {
      return JSON.parse(res.payload) as {
        errorCode: string;
        title: string;
        status: number;
      };
    }

    /** Create one valid link and return its detail plus its ETag. */
    async function seedLink(overrides: Record<string, unknown> = {}) {
      const eventId = (overrides.eventId as string) ?? (await insertEvent());
      const expertId = (overrides.expertId as string) ?? (await insertExpert());
      const res = await createLink({
        payload: {
          eventId,
          expertId,
          role: "Спикер",
          position: 0,
          ...overrides,
        },
      });
      expect(res.statusCode).toBe(201);
      return {
        detail: body(res),
        etag: res.headers.etag as string,
        eventId,
        expertId,
      };
    }

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
      // Registered exactly as production does, so a multipart create is refused
      // by THIS controller with an RFC 7807 body instead of by Fastify's own
      // bare 415 — the sibling `directions.e2e-spec.ts` registers it for the same
      // reason.
      await app.register(multipart, {
        limits: { fileSize: 25 * 1024 * 1024 },
      });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await adminSession();
    });

    afterEach(async () => {
      // Children first — every FK is RESTRICT by design.
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of createdExpertIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE expert_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    // ── Accept branches ────────────────────────────────────────────────────

    it("012 EARS-7: when a platform_admin links an expert to an event, the system shall persist one retained active link at version 1 with an ETag and a Location", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const res = await createLink({
        payload: { eventId, expertId, role: "Модератор", position: 2 },
      });
      expect(res.statusCode).toBe(201);
      const detail = body(res);
      expect(detail).toMatchObject({
        eventId,
        expertId,
        role: "Модератор",
        position: 2,
        status: "active",
        version: 1,
      });
      expect(detail.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/event-experts/${detail.id}`);
      expect(detail.createdAt).toBe(detail.updatedAt);
    });

    it("012 EARS-7: when a link is retired and then restored, the system shall keep the same row, bump its version and answer the exact admin DTO", async () => {
      const { detail, etag } = await seedLink();
      const retired = await transitionLink(detail.id, "retire", {
        ifMatch: etag,
      });
      expect(retired.statusCode).toBe(200);
      expect(body(retired)).toMatchObject({
        id: detail.id,
        status: "retired",
        version: 2,
      });
      expect(retired.headers.etag).toBe('W/"2"');

      const restored = await transitionLink(detail.id, "restore", {
        ifMatch: '"2"',
      });
      expect(restored.statusCode).toBe(200);
      const back = body(restored);
      expect(back).toMatchObject({
        id: detail.id,
        eventId: detail.eventId,
        expertId: detail.expertId,
        status: "active",
        version: 3,
      });
      // DTO exactness — the admin projection is a closed shape, so a future
      // column cannot leak onto the wire unnoticed.
      expect(Object.keys(back).sort()).toEqual([
        "createdAt",
        "eventId",
        "expertId",
        "id",
        "position",
        "role",
        "status",
        "updatedAt",
        "version",
      ]);

      const read = await readLink(detail.id);
      expect(read.statusCode).toBe(200);
      expect(body(read)).toEqual(back);
      expect(read.headers.etag).toBe('W/"3"');
    });

    it("012 EARS-7: when the same link is retired twice, the system shall refuse the second as an invalid transition", async () => {
      const { detail, etag } = await seedLink();
      expect(
        (await transitionLink(detail.id, "retire", { ifMatch: etag }))
          .statusCode,
      ).toBe(200);
      const again = await transitionLink(detail.id, "retire", {
        ifMatch: '"2"',
      });
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");
    });

    it("012 EARS-7: the admin list shall filter by event, by expert and by status, with retired links excluded by default", async () => {
      const eventId = await insertEvent();
      const first = await insertExpert();
      const second = await insertExpert();
      const a = await seedLink({ eventId, expertId: first, position: 0 });
      const b = await seedLink({ eventId, expertId: second, position: 1 });
      await transitionLink(b.detail.id, "retire", { ifMatch: b.etag });

      const listed = await app.inject({
        method: "GET",
        url: `/v1/admin/event-experts?eventId=${eventId}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(listed.statusCode).toBe(200);
      const page = JSON.parse(listed.payload) as {
        data: LinkDetail[];
        total: number;
        page: number;
        pageSize: number;
      };
      expect(page.data.map((r) => r.id)).toEqual([a.detail.id]);
      expect(page.total).toBe(1);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/event-experts?eventId=${eventId}&includeRetired=true`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      const all = JSON.parse(withRetired.payload) as { data: LinkDetail[] };
      expect(all.data.map((r) => r.id).sort()).toEqual(
        [a.detail.id, b.detail.id].sort(),
      );

      const byExpert = await app.inject({
        method: "GET",
        url: `/v1/admin/event-experts?expertId=${first}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(byExpert.payload) as { data: LinkDetail[] }).data.map(
          (r) => r.id,
        ),
      ).toEqual([a.detail.id]);
    });

    // ── Reject branches ────────────────────────────────────────────────────

    it("012 EARS-7: when a second link lands on a position an ACTIVE link already holds, the system shall refuse it as an occupied slot even while both experts are still invisible", async () => {
      // The browser path, and the defect it exposed. An expert authored in the
      // admin starts DRAFT, so it is not eligible and the VISIBLE projection
      // shows neither link — but `event_experts_event_position_active_uniq` is
      // eligibility-blind and both rows are ACTIVE, so the second insert used to
      // die on the index and surface as an unclassified 500. The same-table rule
      // is now checked where the cross-table one is, under the §2.3 locks.
      const eventId = await insertEvent();
      const first = await createLink({
        payload: {
          eventId,
          expertId: await insertDraftExpert(),
          role: "Докладчик",
          position: 1,
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await createLink({
        payload: {
          eventId,
          expertId: await insertDraftExpert(),
          role: "Докладчик",
          position: 1,
        },
      });
      expect(second.statusCode).toBe(409);
      expect(problem(second).errorCode).toBe("SPEAKER_POSITION_OCCUPIED");

      // A free slot is still free, and MOVING onto the taken one is refused by
      // the same rule — an edit reaches the index exactly as a create does.
      const moved = await createLink({
        payload: {
          eventId,
          expertId: await insertDraftExpert(),
          role: "Докладчик",
          position: 2,
        },
      });
      expect(moved.statusCode).toBe(201);
      const collide = await patchLink(body(moved).id, {
        payload: { position: 1 },
        ifMatch: moved.headers.etag as string,
      });
      expect(collide.statusCode).toBe(409);
      expect(problem(collide).errorCode).toBe("SPEAKER_POSITION_OCCUPIED");

      // A RETIRED link frees its slot, mirroring the index's `WHERE status =
      // 'active'` — otherwise a retired row would squat forever.
      const retired = await transitionLink(body(first).id, "retire", {
        ifMatch: first.headers.etag as string,
      });
      expect(retired.statusCode).toBe(200);
      const reused = await patchLink(body(moved).id, {
        payload: { position: 1 },
        ifMatch: moved.headers.etag as string,
      });
      expect(reused.statusCode).toBe(200);
    });

    it("012 EARS-7: a slot-index violation that beats the in-transaction check shall still answer 409, never an opaque 500", async () => {
      // Defense in depth. The pre-check above runs under the §2.3 locks, but no
      // application check can be proven to beat every interleaving, and an
      // unmapped `23505` reaches the caller as a 500 for what is an ordinary
      // refusal. This drives the REAL constraint — so a rename of the index is a
      // failing test here rather than a silent 500 in production — and asserts
      // the classifier the repository writes are wrapped in.
      const eventId = await insertEvent();
      const expertId = await insertDraftExpert();
      const other = await insertDraftExpert();
      await pool.query(
        `INSERT INTO event_experts (event_id, expert_id, role, position)
           VALUES ($1, $2, 'Докладчик', 7)`,
        [eventId, expertId],
      );
      const raw = await pool
        .query(
          `INSERT INTO event_experts (event_id, expert_id, role, position)
             VALUES ($1, $2, 'Докладчик', 7)`,
          [eventId, other],
        )
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(raw).not.toBeNull();
      const classified = asSlotConflict(raw);
      expect(classified).not.toBeNull();
      expect(classified!.errorCode).toBe("SPEAKER_POSITION_OCCUPIED");
      expect(classified!.getStatus()).toBe(409);

      // Anything that is NOT a slot index stays loud: the pair index is a
      // different refusal and must not be laundered into a position message.
      const pairViolation = await pool
        .query(
          `INSERT INTO event_experts (event_id, expert_id, role, position)
             VALUES ($1, $2, 'Докладчик', 8)`,
          [eventId, expertId],
        )
        .then(
          () => null,
          (err: unknown) => err,
        );
      expect(asSlotConflict(pairViolation)).toBeNull();
    });

    it("012 EARS-7: when the same expert is already linked to the event, the system shall refuse a second link and point at the restore instead", async () => {
      const { detail, eventId, expertId, etag } = await seedLink();
      const duplicate = await createLink({
        payload: { eventId, expertId, role: "Спикер", position: 9 },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(problem(duplicate).errorCode).toBe("RELATIONSHIP_CONFLICT");

      // Still true once the link is retired: the retained row IS the link's
      // history, and a second row would fork it.
      await transitionLink(detail.id, "retire", { ifMatch: etag });
      const afterRetire = await createLink({
        payload: { eventId, expertId, role: "Спикер", position: 9 },
      });
      expect(afterRetire.statusCode).toBe(409);
      expect(problem(afterRetire).errorCode).toBe("RELATIONSHIP_CONFLICT");
    });

    it("012 EARS-7: when the role or the position is outside its §2.2 bound, the system shall refuse the payload before any write", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const bad: Array<Record<string, unknown>> = [
        { role: "" },
        { role: "x".repeat(81) },
        { position: -1 },
        { position: 32768 },
        { position: 1.5 },
        { eventId: "not-a-uuid" },
        // Strict objects: an unknown key is a contract mismatch, not a value to
        // ignore — an operator who misspells `expertId` must be told.
        { expertID: randomUUID() },
      ];
      for (const override of bad) {
        const res = await createLink({
          payload: {
            eventId,
            expertId,
            role: "Спикер",
            position: 0,
            ...override,
          },
        });
        expect(res.statusCode, JSON.stringify(override)).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      }
      const { rows } = await pool.query(
        "SELECT id FROM event_experts WHERE event_id = $1",
        [eventId],
      );
      expect(rows).toHaveLength(0);
    });

    it("012 EARS-7: when an edit carries no If-Match or a stale one, the system shall refuse it", async () => {
      const { detail, etag } = await seedLink();
      const absent = await patchLink(detail.id, {
        payload: { role: "Модератор" },
      });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await patchLink(detail.id, {
        payload: { role: "Модератор" },
        ifMatch: '"99"',
      });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");

      // A validator this API never issued asserts nothing, so it cannot pass.
      const garbage = await patchLink(detail.id, {
        payload: { role: "Модератор" },
        ifMatch: "W/not-a-version",
      });
      expect(garbage.statusCode).toBe(412);
      expect(problem(garbage).errorCode).toBe("PRECONDITION_FAILED");

      const fresh = await patchLink(detail.id, {
        payload: { role: "Модератор" },
        ifMatch: etag,
      });
      expect(fresh.statusCode).toBe(200);
      expect(body(fresh)).toMatchObject({ role: "Модератор", version: 2 });
    });

    it("012 EARS-7: the link endpoints shall not be patchable — a re-point is retire plus a new link", async () => {
      const { detail, etag } = await seedLink();
      const otherExpert = await insertExpert();
      const res = await patchLink(detail.id, {
        payload: { expertId: otherExpert },
        ifMatch: etag,
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
    });

    it("012 EARS-7: when a create is replayed with the same Idempotency-Key, the system shall answer the stored outcome without a second link", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const k = key();
      const payload = { eventId, expertId, role: "Спикер", position: 0 };
      const first = await createLink({ payload, idempotencyKey: k });
      expect(first.statusCode).toBe(201);
      const replay = await createLink({ payload, idempotencyKey: k });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(first));
      expect(replay.headers.etag).toBe(first.headers.etag);
      expect(replay.headers.location).toBe(first.headers.location);
      const { rows } = await pool.query(
        "SELECT id FROM event_experts WHERE event_id = $1",
        [eventId],
      );
      expect(rows).toHaveLength(1);
    });

    it("012 EARS-7: when a mutation carries no Idempotency-Key, the system shall refuse it before touching the payload", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const res = await createLink({
        // Deliberately invalid payload too: the key check must answer FIRST, so
        // the errorCode proves the §5.1 failure order rather than the payload.
        payload: { eventId, expertId, role: "", position: -1 },
        idempotencyKey: "",
      });
      // 428 is the platform contract for a missing precondition header
      // (`taxonomy.errors.ts` maps IDEMPOTENCY_KEY_REQUIRED to 428), same as a
      // missing If-Match.
      expect(res.statusCode).toBe(428);
      expect(problem(res).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("012 EARS-7: an absent or non-UUID link id shall be indistinguishable from a real one that is not there", async () => {
      const absent = await readLink(randomUUID());
      expect(absent.statusCode).toBe(404);
      expect(problem(absent).errorCode).toBe("RESOURCE_NOT_FOUND");
      const nonUuid = await readLink("not-a-uuid");
      expect(nonUuid.statusCode).toBe(404);
      expect(problem(nonUuid).errorCode).toBe("RESOURCE_NOT_FOUND");
    });

    it("012 EARS-7: a link carries no media, so a multipart create shall be refused as an unsupported shape", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/event-experts",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "multipart/form-data; boundary=----ds1289",
          "idempotency-key": key(),
        },
        payload: `------ds1289\r\nContent-Disposition: form-data; name="eventId"\r\n\r\n${eventId}\r\n------ds1289--\r\n`,
      });
      expect(res.statusCode).toBe(415);
      expect(problem(res).errorCode).toBe("UNSUPPORTED_MEDIA_TYPE");
      expect(expertId).toBeTypeOf("string");
    });
  },
);
