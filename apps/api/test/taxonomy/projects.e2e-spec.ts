import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../src/storage/index.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 012 EARS-1 (#1283) — the project authoring vertical over the REAL stack:
// Fastify + the 011 admin session + Postgres + object storage. Every assertion
// below is one of the spec's reject or accept branches; the reject branches carry
// the extra obligation of proving ZERO side effect, because "refused" and
// "refused without changing anything" are different guarantees and only the
// second one is what §5.1/§6 promise.
//
// Skips when the stand is absent, exactly as the 007 admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-1 project authoring vertical (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let storage: ObjectStorage;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "AdminTest/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdProjectIds: string[] = [];
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
      const email = uniqueEmail("tax-admin");
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
      const email = uniqueEmail("tax-doctor");
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

    function multipartBody(
      fields: Record<string, string>,
      files: {
        field: string;
        filename: string;
        contentType: string;
        body: Buffer;
      }[] = [],
    ): { body: Buffer; contentType: string } {
      const boundary = `----ds1283${Math.random().toString(16).slice(2)}`;
      const chunks: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      for (const file of files) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
          ),
        );
        chunks.push(file.body, Buffer.from("\r\n"));
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    async function stillPng(width = 40, height = 30): Promise<Buffer> {
      return sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 20, g: 60, b: 160 },
        },
      })
        .png()
        .toBuffer();
    }

    interface JsonPost {
      payload: Record<string, unknown>;
      sid?: string;
      idempotencyKey?: string;
    }

    async function createJson({ payload, sid, idempotencyKey }: JsonPost) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/projects",
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
        kind: "school",
        title: `Школа кардиологии ${Math.random().toString(36).slice(2, 8)}`,
        description: "Программа для практикующих кардиологов.",
        ...overrides,
      };
    }

    /** Track a created project for cleanup and return its body. */
    async function created(res: { payload: string }) {
      const body = JSON.parse(res.payload) as { id: string };
      createdProjectIds.push(body.id);
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
      storage = app.get<ObjectStorage>(OBJECT_STORAGE);
      adminSid = await adminSession();
      otherAdminSid = await adminSession();
    });

    afterEach(async () => {
      for (const id of createdProjectIds.splice(0)) {
        await pool.query("DELETE FROM media_cleanup_jobs WHERE entity_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
      }
      await app.close();
    });

    // ── Accept branches ────────────────────────────────────────────────────

    it("012 EARS-1: when a platform_admin creates a project, the system shall persist one retained draft row with a generated slug, version 1 and an ETag", async () => {
      // A unique suffix: the generated slug is the row's PERMANENT identity, so a
      // fixed title would collide with any leftover row from an earlier run (and
      // 409 SLUG_CONFLICT is the correct answer to that — see the conflict test).
      const uniqueTitle = `Школа кардиологии ${randomUUID().slice(0, 8)}`;
      const payload = validPayload({ title: uniqueTitle });
      const res = await createJson({ payload });
      expect(res.statusCode).toBe(201);
      const body = await created(res);
      expect(body).toMatchObject({
        kind: "school",
        title: uniqueTitle,
        status: "draft",
        version: 1,
        coverUrl: null,
        firstPublishedAt: null,
        slugEditable: true,
      });
      expect(body.slug).toMatch(/^shkola-kardiologii/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/projects/${body.id}`);

      // The SAME row is what the list and the detail render — no second copy.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/projects/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({
        id: body.id,
        slug: body.slug,
      });
      const list = await app.inject({
        method: "GET",
        url: `/v1/admin/projects?q=${encodeURIComponent(uniqueTitle)}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      const listBody = JSON.parse(list.payload) as {
        data: { id: string }[];
        total: number;
        page: number;
      };
      expect(listBody.data.map((r) => r.id)).toContain(body.id);
      expect(listBody.page).toBe(1);
    });

    it("012 EARS-1: when the create rides multipart with one cover, the system shall store only canonical WebP bytes under a server-generated key", async () => {
      const source = await stillPng();
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "cover",
          filename: "cover.png",
          contentType: "image/png",
          body: source,
        },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": key(),
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const body = await created(res);
      expect(body.coverUrl).toBeTypeOf("string");

      const { rows } = await pool.query<{ cover_ref: string }>(
        "SELECT cover_ref FROM projects WHERE id = $1",
        [body.id],
      );
      const ref = rows[0]!.cover_ref;
      // A server-generated key — never a client value, never the filename.
      expect(ref).toMatch(/^taxonomy\/projects\/covers\//);
      expect(ref).not.toContain("cover.png");
      const stored = await storage.getBytes(ref);
      expect(stored).not.toBeNull();
      expect((await sharp(stored!).metadata()).format).toBe("webp");
      // The ORIGINAL bytes never reached storage.
      expect(stored!.equals(source)).toBe(false);
    });

    it("012 EARS-1: when a project is edited with a matching If-Match, the system shall update the same row and bump its version", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { title: "Школа кардиологии — 2027", kind: "program" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: body.id,
        title: "Школа кардиологии — 2027",
        kind: "program",
        version: 2,
      });
      expect(res.headers.etag).toBe('W/"2"');
      const { rows } = await pool.query("SELECT count(*) FROM projects WHERE id = $1", [
        body.id,
      ]);
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it("012 EARS-1: when a cover is replaced or cleared, the system shall enqueue a durable cleanup job for the released key in the same transaction", async () => {
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "cover",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(40, 30),
        },
      ]);
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": key(),
        },
        payload: mp.body,
      });
      const body = await created(createRes);
      const firstRef = (
        await pool.query<{ cover_ref: string }>(
          "SELECT cover_ref FROM projects WHERE id = $1",
          [body.id],
        )
      ).rows[0]!.cover_ref;

      // Replace with different bytes.
      const mp2 = multipartBody({ payload: JSON.stringify({}) }, [
        {
          field: "cover",
          filename: "b.png",
          contentType: "image/png",
          body: await stillPng(48, 36),
        },
      ]);
      const replace = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp2.contentType,
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: mp2.body,
      });
      expect(replace.statusCode).toBe(200);
      const secondRef = (
        await pool.query<{ cover_ref: string }>(
          "SELECT cover_ref FROM projects WHERE id = $1",
          [body.id],
        )
      ).rows[0]!.cover_ref;
      // A replacement never overwrites the referenced object in place.
      expect(secondRef).not.toBe(firstRef);

      const jobs = await pool.query<{
        object_key: string;
        status: string;
        execution_state: string;
        cleanup_kind: string;
      }>(
        "SELECT object_key, status, execution_state, cleanup_kind FROM media_cleanup_jobs WHERE entity_id = $1",
        [body.id],
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0]).toMatchObject({
        object_key: firstRef,
        status: "active",
        execution_state: "pending",
        cleanup_kind: "replace",
      });

      // Now CLEAR the current cover — a second obligation, kind `clear`.
      const clear = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"2"',
        },
        payload: { mediaAction: "clear" },
      });
      expect(clear.statusCode).toBe(200);
      expect(JSON.parse(clear.payload)).toMatchObject({ coverUrl: null });
      const kinds = (
        await pool.query<{ cleanup_kind: string }>(
          "SELECT cleanup_kind FROM media_cleanup_jobs WHERE entity_id = $1 ORDER BY created_at",
          [body.id],
        )
      ).rows.map((r) => r.cleanup_kind);
      expect(kinds).toEqual(["replace", "clear"]);
    });

    it("012 EARS-15: the list shall exclude retired rows by default and include them on request", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE projects SET status = 'retired', deleted_at = now() WHERE id = $1",
        [body.id],
      );
      const marker = encodeURIComponent(String(body.slug));
      const def = await app.inject({
        method: "GET",
        url: `/v1/admin/projects?q=${marker}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(def.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).not.toContain(body.id);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/projects?q=${marker}&includeRetired=true`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(withRetired.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).toContain(body.id);

      // The detail route addresses a retired row directly (restore path input).
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/projects/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({ status: "retired" });
    });

    // ── Reject branches ───────────────────────────────────────────────────

    it("012 EARS-16: when the caller has no admin session, the system shall refuse with a Problem Details body and no row", async () => {
      const before = await projectCount();
      const anon = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: { ...device, "content-type": "application/json" },
        payload: validPayload(),
      });
      expect(anon.statusCode).toBe(401);

      // A DOCTOR-portal session is not an admin session (011 EARS-2).
      const doctor = await doctorCookie();
      const wrongTier = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${doctor}`,
          "idempotency-key": randomUUID(),
        },
        payload: validPayload(),
      });
      expect(wrongTier.statusCode).toBe(401);
      expect(await projectCount()).toBe(before);
    });

    it("012 EARS-17: when the Idempotency-Key is missing or non-canonical, the system shall refuse before any row is written", async () => {
      const before = await projectCount();
      const missing = await createJson({
        payload: validPayload(),
        idempotencyKey: "",
      });
      expect(missing.statusCode).toBe(428);
      expect(problem(missing).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(problem(missing).traceId).toBeTypeOf("string");
      expect(missing.headers["content-type"]).toContain("application/problem+json");

      const upper = await createJson({
        payload: validPayload(),
        idempotencyKey: randomUUID().toUpperCase(),
      });
      expect(upper.statusCode).toBe(400);
      expect(problem(upper).errorCode).toBe("IDEMPOTENCY_KEY_INVALID");
      expect(await projectCount()).toBe(before);
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
        "SELECT count(*) FROM projects WHERE slug = $1",
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
        payload: validPayload({ title: "Совсем другой проект" }),
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

    it("012 EARS-17: when a byte-different file rides an already-bound key, the system shall refuse before normalization or upload", async () => {
      const k = key();
      const payload = JSON.stringify(validPayload());
      const mp = multipartBody({ payload }, [
        {
          field: "cover",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(40, 30),
        },
      ]);
      const first = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": k,
        },
        payload: mp.body,
      });
      expect(first.statusCode).toBe(201);
      await created(first);
      const objectsBefore = await coverObjectCount();

      const mp2 = multipartBody({ payload }, [
        {
          field: "cover",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(44, 30),
        },
      ]);
      const second = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp2.contentType,
          "idempotency-key": k,
        },
        payload: mp2.body,
      });
      expect(second.statusCode).toBe(409);
      expect(problem(second).errorCode).toBe("IDEMPOTENCY_KEY_REUSED");
      // Nothing was normalized or uploaded for the refused attempt.
      expect(await coverObjectCount()).toBe(objectsBefore);
    });

    it("012 EARS-1: when a slug is already held by a retained row, the system shall refuse with SLUG_CONFLICT", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const clash = await createJson({
        payload: validPayload({ slug: body.slug }),
      });
      expect(clash.statusCode).toBe(409);
      expect(problem(clash).errorCode).toBe("SLUG_CONFLICT");
    });

    it("012 EARS-1: when the project was first published, the system shall refuse a slug change with SLUG_IMMUTABLE and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE projects SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
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
        "SELECT slug, version FROM projects WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });
      // The detail read tells the UI the field is locked.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/projects/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(detail.payload)).toMatchObject({ slugEditable: false });
    });

    it("012 EARS-1: when a published project echoes its OWN slug, the system shall treat it as a no-op rather than SLUG_IMMUTABLE", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE projects SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      // §2.2 predicates slug UPDATES on `first_published_at IS NULL`. Re-sending
      // the value the form was rendered with changes nothing, so refusing it would
      // block an ordinary edit (the form posts the whole «Основное» tab) over a
      // field the operator never touched.
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { slug: body.slug, title: "Обновлённое название" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        slug: body.slug,
        title: "Обновлённое название",
        version: 2,
      });
      // A DIFFERENT slug on the same row is still refused.
      const changed = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"2"',
        },
        payload: { slug: `${body.slug}-2` },
      });
      expect(changed.statusCode).toBe(409);
      expect(problem(changed).errorCode).toBe("SLUG_IMMUTABLE");
    });

    it("012 EARS-5: when a PATCH would leave a published projection incomplete, the system shall refuse with a field-addressed PUBLISH_REQUIREMENTS_NOT_MET", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE projects SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { description: null },
      });
      expect(res.statusCode).toBe(409);
      const detail = problem(res);
      expect(detail.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      expect(detail.errors?.map((e) => e.path)).toContain("description");
      const { rows } = await pool.query<{
        description: string;
        version: number;
      }>("SELECT description, version FROM projects WHERE id = $1", [body.id]);
      expect(rows[0]).toMatchObject({
        description: "Программа для практикующих кардиологов.",
        version: 1,
      });
    });

    it("012 EARS-17: when If-Match is absent or stale, the system shall answer 428 then 412 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const absent = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
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
        url: `/v1/admin/projects/${body.id}`,
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
        "SELECT title, version FROM projects WHERE id = $1",
        [body.id],
      );
      expect(rows[0]!.version).toBe(1);
      expect(rows[0]!.title).not.toBe("Устаревшая версия");
    });

    it("012 EARS-16: when client JSON supplies a storage reference or an unknown field, the system shall refuse with VALIDATION_FAILED", async () => {
      const before = await projectCount();
      const res = await createJson({
        payload: validPayload({ coverRef: "taxonomy/projects/covers/x.webp" }),
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      expect(await projectCount()).toBe(before);
    });

    it("012 EARS-16: when the multipart request carries no file, the wrong part name or two files, the system shall refuse before upload", async () => {
      const before = await projectCount();
      const objectsBefore = await coverObjectCount();
      const payload = JSON.stringify(validPayload());

      const noFile = multipartBody({ payload });
      const noFileRes = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": noFile.contentType,
          "idempotency-key": randomUUID(),
        },
        payload: noFile.body,
      });
      expect(noFileRes.statusCode).toBe(415);
      expect(problem(noFileRes).errorCode).toBe("UNSUPPORTED_MEDIA_TYPE");

      const wrongName = multipartBody({ payload }, [
        {
          field: "photo",
          filename: "p.png",
          contentType: "image/png",
          body: await stillPng(),
        },
      ]);
      const wrongNameRes = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": wrongName.contentType,
          "idempotency-key": randomUUID(),
        },
        payload: wrongName.body,
      });
      expect(wrongNameRes.statusCode).toBe(400);
      expect(problem(wrongNameRes).errorCode).toBe("MEDIA_INPUT_CONFLICT");

      const twoFiles = multipartBody({ payload }, [
        {
          field: "cover",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(),
        },
        {
          field: "cover",
          filename: "b.png",
          contentType: "image/png",
          body: await stillPng(44, 30),
        },
      ]);
      const twoFilesRes = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": twoFiles.contentType,
          "idempotency-key": randomUUID(),
        },
        payload: twoFiles.body,
      });
      expect(twoFilesRes.statusCode).toBe(400);
      expect(problem(twoFilesRes).errorCode).toBe("MEDIA_INPUT_CONFLICT");

      expect(await projectCount()).toBe(before);
      expect(await coverObjectCount()).toBe(objectsBefore);
    });

    it("012 EARS-1: when a cover file rides a mediaAction clear, the system shall refuse with MEDIA_INPUT_CONFLICT", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const mp = multipartBody(
        { payload: JSON.stringify({ mediaAction: "clear" }) },
        [
          {
            field: "cover",
            filename: "a.png",
            contentType: "image/png",
            body: await stillPng(),
          },
        ],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/projects/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("MEDIA_INPUT_CONFLICT");
    });

    it("012 EARS-1: when the cover is a GIF or an animated container, the system shall refuse with MEDIA_INVALID and write no row", async () => {
      const before = await projectCount();
      const gif = await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .gif()
        .toBuffer();
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "cover",
          filename: "a.gif",
          contentType: "image/gif",
          body: gif,
        },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": randomUUID(),
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("MEDIA_INVALID");
      expect(await projectCount()).toBe(before);
    });

    it("012 EARS-1: when an unknown project id is addressed, the system shall answer 404 RESOURCE_NOT_FOUND without disclosing anything", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/projects/${randomUUID()}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(404);
      expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      // A slug is not an admin address — the admin surface is id-only.
      const bySlug = await app.inject({
        method: "GET",
        url: "/v1/admin/projects/shkola-kardiologii",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(bySlug.statusCode).toBe(404);
    });

    it("012 EARS-1: when a project mutation commits, feature 010 shall hold an attributed audit row and the technical tables shall hold none", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
        metadata: { source: string };
      }>(
        `SELECT event_type, subject_id, metadata FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [body.id],
      );
      expect(rows.map((r) => r.event_type)).toContain("data.projects.insert");
      expect(rows[0]!.subject_id).not.toBeNull();
      const technical = await pool.query(
        `SELECT count(*) FROM audit_ledger
          WHERE metadata->>'table' IN ('idempotency_keys', 'media_cleanup_jobs')`,
      );
      expect(Number(technical.rows[0]!.count)).toBe(0);
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

    async function projectCount(): Promise<number> {
      const { rows } = await pool.query("SELECT count(*) FROM projects");
      return Number(rows[0]!.count);
    }

    /** How many project-cover objects the store currently holds. */
    async function coverObjectCount(): Promise<number> {
      const { rows } = await pool.query<{ cover_ref: string | null }>(
        "SELECT cover_ref FROM projects WHERE cover_ref IS NOT NULL",
      );
      let present = 0;
      for (const row of rows) {
        if (row.cover_ref && (await storage.exists(row.cover_ref))) present += 1;
      }
      return present;
    }
  },
);
