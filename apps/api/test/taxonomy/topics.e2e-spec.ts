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
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

// 012 EARS-3 (#1285) — the curated topic authoring vertical over the REAL
// stack: Fastify + the 011 admin session + Postgres. It is the SAME §5.1
// contract the project and expert verticals proved, so this suite asserts what
// is genuinely topic-specific — the slug generated from the TITLE, and the
// JSON-only request shape of an entity that has no media slot at all — plus the
// reject branches whose zero-side-effect guarantee has to hold per entity,
// rather than being assumed from a sibling's suite.
//
// The multipart plugin IS registered here, exactly as production registers it
// for the entities that do carry a binary: that is the only way to prove a
// multipart POST to `admin/topics` is refused by THIS controller with the
// documented 415, and not merely dropped by an unconfigured body parser.
//
// Skips when the stand is absent, exactly as the 007 admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-3 curated topic authoring vertical (e2e)",
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
    const createdTopicIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;
    let otherAdminSid: string;

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

    /** Register + grant + establish an ADMIN session; returns its sid. */
    async function adminSession(): Promise<string> {
      const email = uniqueEmail("top-admin");
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

    /** A doctor-portal (non-admin) session cookie — the 401 probe. */
    async function doctorCookie(): Promise<string> {
      const email = uniqueEmail("top-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      return res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    }

    /** A minimal multipart envelope — a topic has no file part to offer. */
    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds1285${Math.random().toString(16).slice(2)}`;
      const chunks: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    interface JsonPost {
      payload: Record<string, unknown>;
      sid?: string;
      idempotencyKey?: string;
    }

    async function createJson({ payload, sid, idempotencyKey }: JsonPost) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/topics",
        headers: {
          ...device,
          ...adminHeaders(sid ?? adminSid),
          "content-type": "application/json",
          ...(idempotencyKey === undefined
            ? { "idempotency-key": key() }
            : idempotencyKey === ""
              ? {}
              : { "idempotency-key": idempotencyKey }),
        },
        payload,
      });
    }

    function validPayload(overrides: Record<string, unknown> = {}) {
      return {
        title: `Кардиология ${Math.random().toString(36).slice(2, 8)}`,
        ...overrides,
      };
    }

    /** Track a created topic for cleanup and return its body. */
    async function created(res: { payload: string }) {
      const body = JSON.parse(res.payload) as { id: string };
      createdTopicIds.push(body.id);
      return body as { id: string; slug: string; version: number } & Record<
        string,
        unknown
      >;
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
      await app.register(multipart, {
        limits: { fileSize: 25 * 1024 * 1024 },
      });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await adminSession();
      otherAdminSid = await adminSession();
    });

    afterEach(async () => {
      for (const id of createdTopicIds.splice(0)) {
        await pool.query("DELETE FROM topics WHERE id = $1", [id]);
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

    it("012 EARS-3: when a platform_admin creates a topic, the system shall persist one retained draft row with a slug generated from the title, version 1 and an ETag", async () => {
      const marker = randomUUID().slice(0, 8);
      const res = await createJson({
        payload: validPayload({ title: `Кардиология ${marker}` }),
      });
      expect(res.statusCode).toBe(201);
      const body = await created(res);
      expect(body).toMatchObject({
        title: `Кардиология ${marker}`,
        status: "draft",
        version: 1,
        firstPublishedAt: null,
        slugEditable: true,
      });
      // The slug is derived from the TITLE — a topic has no name and no
      // description, so the heading is its whole identity source (§2.2).
      expect(body.slug).toMatch(/^kardiologiya-/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/topics/${body.id}`);

      // The SAME row is what the list and the detail render — no second copy.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/topics/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({
        id: body.id,
        slug: body.slug,
        title: `Кардиология ${marker}`,
      });
      const list = await app.inject({
        method: "GET",
        url: `/v1/admin/topics?q=${encodeURIComponent(marker)}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      const listBody = JSON.parse(list.payload) as {
        data: { id: string; title: string }[];
        total: number;
        page: number;
      };
      expect(listBody.data.map((r) => r.id)).toContain(body.id);
      expect(listBody.page).toBe(1);
    });

    it("012 EARS-3: when a topic is edited with a matching If-Match, the system shall update the same row and bump its version", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/topics/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { title: "Аритмология" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: body.id,
        title: "Аритмология",
        version: 2,
      });
      expect(res.headers.etag).toBe('W/"2"');
      // A retitle does NOT re-point the public URL: the slug is identity, not a
      // rendering of the current heading.
      const { rows } = await pool.query<{ slug: string; count: string }>(
        "SELECT slug, count(*) OVER () AS count FROM topics WHERE id = $1",
        [body.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.slug).toBe(body.slug);
    });

    it("012 EARS-15: the list shall search titles case-insensitively and exclude retired rows by default", async () => {
      const marker = randomUUID().slice(0, 8);
      const body = await created(
        await createJson({
          payload: validPayload({ title: `Онкология ${marker}` }),
        }),
      );
      // LD-6: ordinary case-insensitive substring search over the title.
      const found = await app.inject({
        method: "GET",
        url: `/v1/admin/topics?q=${encodeURIComponent(marker.toUpperCase())}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(found.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).toContain(body.id);

      await pool.query(
        "UPDATE topics SET status = 'retired', deleted_at = now() WHERE id = $1",
        [body.id],
      );
      const def = await app.inject({
        method: "GET",
        url: `/v1/admin/topics?q=${marker}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(def.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).not.toContain(body.id);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/topics?q=${marker}&includeRetired=true`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (
          JSON.parse(withRetired.payload) as { data: { id: string }[] }
        ).data.map((r) => r.id),
      ).toContain(body.id);

      // The detail route addresses a retired row directly (restore path input).
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/topics/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({ status: "retired" });
    });

    // ── Reject branches ───────────────────────────────────────────────────

    it("012 EARS-16: when the caller has no admin session, the system shall refuse with a Problem Details body and no row", async () => {
      const before = await topicCount();
      const anon = await app.inject({
        method: "POST",
        url: "/v1/admin/topics",
        headers: { ...device, "content-type": "application/json" },
        payload: validPayload(),
      });
      expect(anon.statusCode).toBe(401);

      // A DOCTOR-portal session is not an admin session (011 EARS-2).
      const doctor = await doctorCookie();
      const wrongTier = await app.inject({
        method: "POST",
        url: "/v1/admin/topics",
        headers: {
          ...device,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${doctor}`,
          "idempotency-key": randomUUID(),
        },
        payload: validPayload(),
      });
      expect(wrongTier.statusCode).toBe(401);
      expect(await topicCount()).toBe(before);
    });

    it("012 EARS-17: when the Idempotency-Key is missing or non-canonical, the system shall refuse before any row is written", async () => {
      const before = await topicCount();
      const missing = await createJson({
        payload: validPayload(),
        idempotencyKey: "",
      });
      expect(missing.statusCode).toBe(428);
      expect(problem(missing).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(problem(missing).traceId).toBeTypeOf("string");
      expect(missing.headers["content-type"]).toContain(
        "application/problem+json",
      );

      const upper = await createJson({
        payload: validPayload(),
        idempotencyKey: randomUUID().toUpperCase(),
      });
      expect(upper.statusCode).toBe(400);
      expect(problem(upper).errorCode).toBe("IDEMPOTENCY_KEY_INVALID");
      expect(await topicCount()).toBe(before);
    });

    it("012 EARS-17: when the same key is retried with identical input, the system shall replay the stored response instead of creating a second row", async () => {
      const k = key();
      const payload = validPayload();
      const first = await createJson({ payload, idempotencyKey: k });
      expect(first.statusCode).toBe(201);
      const body = await created(first);

      const replay = await createJson({ payload, idempotencyKey: k });
      expect(replay.statusCode).toBe(201);
      expect((JSON.parse(replay.payload) as { id: string }).id).toBe(body.id);
      expect(replay.headers.etag).toBe('W/"1"');
      const { rows } = await pool.query(
        "SELECT count(*) FROM topics WHERE slug = $1",
        [body.slug],
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it("012 EARS-17: when the same key carries different input or a different actor, the system shall refuse with IDEMPOTENCY_KEY_REUSED", async () => {
      const k = key();
      const first = await createJson({
        payload: validPayload(),
        idempotencyKey: k,
      });
      await created(first);

      const differentInput = await createJson({
        payload: validPayload({ title: "Совсем другая тема" }),
        idempotencyKey: k,
      });
      expect(differentInput.statusCode).toBe(409);
      expect(problem(differentInput).errorCode).toBe("IDEMPOTENCY_KEY_REUSED");

      const differentActor = await createJson({
        payload: validPayload(),
        idempotencyKey: k,
        sid: otherAdminSid,
      });
      expect(differentActor.statusCode).toBe(409);
      expect(problem(differentActor).errorCode).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("012 EARS-3: when a slug is already held by a retained row, the system shall refuse with SLUG_CONFLICT", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const clash = await createJson({
        payload: validPayload({ slug: body.slug }),
      });
      expect(clash.statusCode).toBe(409);
      expect(problem(clash).errorCode).toBe("SLUG_CONFLICT");
    });

    it("012 EARS-3: when the topic was first published, the system shall refuse a slug change with SLUG_IMMUTABLE and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE topics SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/topics/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { slug: "sovsem-drugoy-adres" },
      });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("SLUG_IMMUTABLE");
      const { rows } = await pool.query<{ slug: string; version: number }>(
        "SELECT slug, version FROM topics WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });
      // The detail read tells the UI the field is locked.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/topics/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(detail.payload)).toMatchObject({ slugEditable: false });

      // Echoing the OWN slug is not a change: the «Основное» tab posts the whole
      // form, so refusing the echo would block every ordinary edit.
      const echo = await app.inject({
        method: "PATCH",
        url: `/v1/admin/topics/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { slug: body.slug, title: "Кардиология (переименована)" },
      });
      expect(echo.statusCode).toBe(200);
      expect(JSON.parse(echo.payload)).toMatchObject({
        slug: body.slug,
        title: "Кардиология (переименована)",
        version: 2,
      });
    });

    it("012 EARS-17: when If-Match is absent or stale, the system shall answer 428 then 412 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const absent = await app.inject({
        method: "PATCH",
        url: `/v1/admin/topics/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { title: "Без предусловия" },
      });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await app.inject({
        method: "PATCH",
        url: `/v1/admin/topics/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"99"',
        },
        payload: { title: "Устаревшая версия" },
      });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");
      const { rows } = await pool.query<{ title: string; version: number }>(
        "SELECT title, version FROM topics WHERE id = $1",
        [body.id],
      );
      expect(rows[0]!.version).toBe(1);
      expect(rows[0]!.title).toBe(body.title);
    });

    it("012 EARS-16: when client JSON supplies a field this feature does not have, the system shall refuse with VALIDATION_FAILED", async () => {
      const before = await topicCount();
      // A topic has NO description and NO media. Silently ignoring either would
      // let an operator believe the platform stored something it never will.
      for (const extra of [
        { description: "Подробное описание темы" },
        { coverRef: "taxonomy/topics/covers/x.webp" },
        { mediaAction: "clear" },
      ]) {
        const res = await createJson({ payload: validPayload(extra) });
        expect(res.statusCode).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      }
      // …and the title bound is enforced at the edge, not only in the DB.
      const tooLong = await createJson({
        payload: validPayload({ title: "х".repeat(121) }),
      });
      expect(tooLong.statusCode).toBe(400);
      expect(problem(tooLong).errorCode).toBe("VALIDATION_FAILED");
      expect(await topicCount()).toBe(before);
    });

    it("012 EARS-16: when the request is not application/json, the system shall refuse with 415 and write no row", async () => {
      const before = await topicCount();
      // Multipart is not "an upload in the wrong place" for a topic — it is a
      // shape that could never be satisfied, because there is no file part name
      // to accept. The plugin IS registered, so this 415 is the controller's.
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) });
      const multipartRes = await app.inject({
        method: "POST",
        url: "/v1/admin/topics",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": randomUUID(),
        },
        payload: mp.body,
      });
      expect(multipartRes.statusCode).toBe(415);
      expect(problem(multipartRes).errorCode).toBe("UNSUPPORTED_MEDIA_TYPE");

      const textRes = await app.inject({
        method: "POST",
        url: "/v1/admin/topics",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "text/plain",
          "idempotency-key": randomUUID(),
        },
        payload: JSON.stringify(validPayload()),
      });
      expect(textRes.statusCode).toBe(415);
      expect(await topicCount()).toBe(before);
    });

    it("012 EARS-3: when an unknown topic id is addressed, the system shall answer 404 RESOURCE_NOT_FOUND without disclosing anything", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/topics/${randomUUID()}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(404);
      expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      // A slug is not an admin address — the admin surface is id-only.
      const bySlug = await app.inject({
        method: "GET",
        url: "/v1/admin/topics/kardiologiya",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(bySlug.statusCode).toBe(404);
    });

    it("012 EARS-3: when a topic mutation commits, feature 010 shall hold an attributed audit row of ordinary columns", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [body.id],
      );
      expect(rows.map((r) => r.event_type)).toContain("data.topics.insert");
      expect(rows[0]!.subject_id).not.toBeNull();
    });

    // ── helpers ───────────────────────────────────────────────────────────

    function problem(res: { payload: string }): {
      errorCode: string;
      traceId: string;
      errors?: { path: string; message: string }[];
    } {
      return JSON.parse(res.payload) as {
        errorCode: string;
        traceId: string;
        errors?: { path: string; message: string }[];
      };
    }

    async function topicCount(): Promise<number> {
      const { rows } = await pool.query("SELECT count(*) FROM topics");
      return Number(rows[0]!.count);
    }
  },
);
