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

// 012 EARS-4 (#1286) — the partner authoring vertical over the REAL stack:
// Fastify + the 011 admin session + Postgres + object storage. It is the SAME
// §5.1 contract the project and expert verticals proved, so this suite asserts
// what is genuinely partner-specific — the slug generated from the TITLE, the
// `logo` media slot, and the absolute-HTTPS website link — plus the reject
// branches whose zero-side-effect guarantee has to hold per entity, not per
// codebase.
//
// Skips when the stand is absent, exactly as the 007 admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-4 partner authoring vertical (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let storage: ObjectStorage;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "AdminTest/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdPartnerIds: string[] = [];
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
      const email = uniqueEmail("prt-admin");
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
      const email = uniqueEmail("prt-doctor");
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
      const boundary = `----ds1286${Math.random().toString(16).slice(2)}`;
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
        url: "/v1/admin/partners",
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
        title: `Ромашка ${Math.random().toString(36).slice(2, 8)}`,
        websiteUrl: "https://romashka.example/ru",
        ...overrides,
      };
    }

    /** Track a created partner for cleanup and return its body. */
    async function created(res: { payload: string }) {
      const body = JSON.parse(res.payload) as { id: string };
      createdPartnerIds.push(body.id);
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
      for (const id of createdPartnerIds.splice(0)) {
        await pool.query("DELETE FROM media_cleanup_jobs WHERE entity_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM partners WHERE id = $1", [id]);
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

    it("012 EARS-4: when a platform_admin creates a partner, the system shall persist one retained draft row with a slug generated from the title, version 1 and an ETag", async () => {
      const marker = randomUUID().slice(0, 8);
      const res = await createJson({
        payload: validPayload({ title: `Ромашка ${marker}` }),
      });
      expect(res.statusCode).toBe(201);
      const body = await created(res);
      expect(body).toMatchObject({
        title: `Ромашка ${marker}`,
        websiteUrl: "https://romashka.example/ru",
        status: "draft",
        version: 1,
        logoUrl: null,
        firstPublishedAt: null,
        slugEditable: true,
      });
      // The slug is derived from the TITLE — a partner has no personal name.
      expect(body.slug).toMatch(/^romashka-/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/partners/${body.id}`);

      // The SAME row is what the list and the detail render — no second copy.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/partners/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({
        id: body.id,
        slug: body.slug,
      });
      const list = await app.inject({
        method: "GET",
        url: `/v1/admin/partners?q=${encodeURIComponent(marker)}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      const listBody = JSON.parse(list.payload) as {
        data: { id: string; websiteUrl: string | null }[];
        total: number;
        page: number;
      };
      expect(listBody.data.map((r) => r.id)).toContain(body.id);
      expect(listBody.page).toBe(1);
    });

    it("012 EARS-4: when the create rides multipart with one logo, the system shall store only canonical WebP bytes under a server-generated key", async () => {
      const source = await stillPng();
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "logo",
          filename: "logo.png",
          contentType: "image/png",
          body: source,
        },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
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
      expect(body.logoUrl).toBeTypeOf("string");

      const { rows } = await pool.query<{ logo_ref: string }>(
        "SELECT logo_ref FROM partners WHERE id = $1",
        [body.id],
      );
      const ref = rows[0]!.logo_ref;
      // A server-generated key — never a client value, never the filename.
      expect(ref).toMatch(/^taxonomy\/partners\/logos\//);
      expect(ref).not.toContain("logo.png");
      const stored = await storage.getBytes(ref);
      expect(stored).not.toBeNull();
      expect((await sharp(stored!).metadata()).format).toBe("webp");
      // The ORIGINAL bytes never reached storage — the logo slot uses the same
      // #1283 decoder as the cover and photo slots, not a forked pipeline.
      expect(stored!.equals(source)).toBe(false);
    });

    it("012 EARS-4: when a partner is edited with a matching If-Match, the system shall update the same row, bump its version and clear the website on an explicit null", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { websiteUrl: "https://romashka.example/ru/partners" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: body.id,
        websiteUrl: "https://romashka.example/ru/partners",
        version: 2,
      });
      expect(res.headers.etag).toBe('W/"2"');

      // An explicit null CLEARS the optional link; omission would have meant
      // "unchanged", so the two must not be the same request.
      const cleared = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"2"',
        },
        payload: { websiteUrl: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(JSON.parse(cleared.payload)).toMatchObject({
        websiteUrl: null,
        version: 3,
      });
      const { rows } = await pool.query<{ count: string; website_url: null }>(
        "SELECT count(*) FROM partners WHERE id = $1",
        [body.id],
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it("012 EARS-4: when a logo is replaced or cleared, the system shall enqueue a durable cleanup job for the released key in the same transaction", async () => {
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "logo",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(40, 30),
        },
      ]);
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
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
        await pool.query<{ logo_ref: string }>(
          "SELECT logo_ref FROM partners WHERE id = $1",
          [body.id],
        )
      ).rows[0]!.logo_ref;

      // Replace with different bytes.
      const mp2 = multipartBody({ payload: JSON.stringify({}) }, [
        {
          field: "logo",
          filename: "b.png",
          contentType: "image/png",
          body: await stillPng(48, 36),
        },
      ]);
      const replace = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
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
        await pool.query<{ logo_ref: string }>(
          "SELECT logo_ref FROM partners WHERE id = $1",
          [body.id],
        )
      ).rows[0]!.logo_ref;
      // A replacement never overwrites the referenced object in place.
      expect(secondRef).not.toBe(firstRef);

      const jobs = await pool.query<{
        object_key: string;
        status: string;
        execution_state: string;
        cleanup_kind: string;
        entity_kind: string;
        slot: string;
      }>(
        "SELECT object_key, status, execution_state, cleanup_kind, entity_kind, slot FROM media_cleanup_jobs WHERE entity_id = $1",
        [body.id],
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0]).toMatchObject({
        object_key: firstRef,
        status: "active",
        execution_state: "pending",
        cleanup_kind: "replace",
        entity_kind: "partner",
        slot: "logo",
      });

      // Now CLEAR the current logo — a second obligation, kind `clear`.
      const clear = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
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
      expect(JSON.parse(clear.payload)).toMatchObject({ logoUrl: null });
      const kinds = (
        await pool.query<{ cleanup_kind: string }>(
          "SELECT cleanup_kind FROM media_cleanup_jobs WHERE entity_id = $1 ORDER BY created_at",
          [body.id],
        )
      ).rows.map((r) => r.cleanup_kind);
      expect(kinds).toEqual(["replace", "clear"]);
    });

    it("012 EARS-15: the list shall search titles case-insensitively and exclude retired rows by default", async () => {
      const marker = randomUUID().slice(0, 8);
      const body = await created(
        await createJson({ payload: validPayload({ title: `Ромашка ${marker}` }) }),
      );
      // LD-6: ordinary case-insensitive substring search over the title.
      const found = await app.inject({
        method: "GET",
        url: `/v1/admin/partners?q=${encodeURIComponent(marker.toUpperCase())}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(found.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).toContain(body.id);

      await pool.query(
        "UPDATE partners SET status = 'retired', deleted_at = now() WHERE id = $1",
        [body.id],
      );
      const def = await app.inject({
        method: "GET",
        url: `/v1/admin/partners?q=${marker}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(def.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).not.toContain(body.id);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/partners?q=${marker}&includeRetired=true`,
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
        url: `/v1/admin/partners/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({ status: "retired" });
    });

    // ── Reject branches ───────────────────────────────────────────────────

    it("012 EARS-16: when the caller has no admin session, the system shall refuse with a Problem Details body and no row", async () => {
      const before = await partnerCount();
      const anon = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
        headers: { ...device, "content-type": "application/json" },
        payload: validPayload(),
      });
      expect(anon.statusCode).toBe(401);

      // A DOCTOR-portal session is not an admin session (011 EARS-2).
      const doctor = await doctorCookie();
      const wrongTier = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
        headers: {
          ...device,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${doctor}`,
          "idempotency-key": randomUUID(),
        },
        payload: validPayload(),
      });
      expect(wrongTier.statusCode).toBe(401);
      expect(await partnerCount()).toBe(before);
    });

    it("012 EARS-17: when the Idempotency-Key is missing or non-canonical, the system shall refuse before any row is written", async () => {
      const before = await partnerCount();
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
      expect(await partnerCount()).toBe(before);
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
        "SELECT count(*) FROM partners WHERE slug = $1",
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
        payload: validPayload({ title: "Совсем другой партнёр" }),
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

    it("012 EARS-4: when a slug is already held by a retained row, the system shall refuse with SLUG_CONFLICT", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const clash = await createJson({
        payload: validPayload({ slug: body.slug }),
      });
      expect(clash.statusCode).toBe(409);
      expect(problem(clash).errorCode).toBe("SLUG_CONFLICT");
    });

    it("012 EARS-4: when the partner was first published, the system shall refuse a slug change with SLUG_IMMUTABLE and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE partners SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
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
        "SELECT slug, version FROM partners WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });
      // The detail read tells the UI the field is locked.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/partners/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(detail.payload)).toMatchObject({ slugEditable: false });

      // Echoing the OWN slug is not a change: the «Основное» tab posts the whole
      // form, so refusing the echo would block every ordinary edit.
      const echo = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { slug: body.slug, title: "Ромашка (правка)" },
      });
      expect(echo.statusCode).toBe(200);
      expect(JSON.parse(echo.payload)).toMatchObject({
        slug: body.slug,
        title: "Ромашка (правка)",
        version: 2,
      });
    });

    it("012 EARS-17: when If-Match is absent or stale, the system shall answer 428 then 412 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const absent = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
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
        url: `/v1/admin/partners/${body.id}`,
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
        "SELECT title, version FROM partners WHERE id = $1",
        [body.id],
      );
      expect(rows[0]!.version).toBe(1);
      expect(rows[0]!.title).toBe(body.title);
    });

    it("012 EARS-16: when client JSON supplies a storage reference, an unknown field or a non-HTTPS website, the system shall refuse with VALIDATION_FAILED", async () => {
      const before = await partnerCount();
      const storageRef = await createJson({
        payload: validPayload({ logoRef: "taxonomy/partners/logos/x.webp" }),
      });
      expect(storageRef.statusCode).toBe(400);
      expect(problem(storageRef).errorCode).toBe("VALIDATION_FAILED");

      // A partner link is rendered into public pages, so anything other than an
      // absolute https:// origin is refused at the contract edge — `http:` would
      // downgrade the outbound link and `javascript:` would be an injection.
      for (const bad of [
        "http://romashka.example",
        "//romashka.example",
        "/about",
        "javascript:alert(1)",
        "romashka.example",
      ]) {
        const res = await createJson({ payload: validPayload({ websiteUrl: bad }) });
        expect(res.statusCode, `websiteUrl ${bad} must be refused`).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      }
      expect(await partnerCount()).toBe(before);
    });

    it("012 EARS-16: when the multipart request carries no file, the wrong part name or two files, the system shall refuse before upload", async () => {
      const before = await partnerCount();
      const objectsBefore = await logoObjectCount();
      const payload = JSON.stringify(validPayload());

      const noFile = multipartBody({ payload });
      const noFileRes = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
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

      // `photo` is the EXPERT slot and `cover` the PROJECT one — on a partner
      // both are wrong part names.
      for (const wrongField of ["photo", "cover"]) {
        const wrongName = multipartBody({ payload }, [
          {
            field: wrongField,
            filename: "c.png",
            contentType: "image/png",
            body: await stillPng(),
          },
        ]);
        const wrongNameRes = await app.inject({
          method: "POST",
          url: "/v1/admin/partners",
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
      }

      const twoFiles = multipartBody({ payload }, [
        {
          field: "logo",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(),
        },
        {
          field: "logo",
          filename: "b.png",
          contentType: "image/png",
          body: await stillPng(44, 30),
        },
      ]);
      const twoFilesRes = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
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

      expect(await partnerCount()).toBe(before);
      expect(await logoObjectCount()).toBe(objectsBefore);
    });

    it("012 EARS-4: when a logo file rides a mediaAction clear, the system shall refuse with MEDIA_INPUT_CONFLICT and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const mp = multipartBody(
        { payload: JSON.stringify({ mediaAction: "clear" }) },
        [
          {
            field: "logo",
            filename: "a.png",
            contentType: "image/png",
            body: await stillPng(),
          },
        ],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/partners/${body.id}`,
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
      const { rows } = await pool.query<{ version: number; logo_ref: null }>(
        "SELECT version, logo_ref FROM partners WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ version: 1, logo_ref: null });
    });

    it("012 EARS-4: when the logo is a GIF or an animated container, the system shall refuse with MEDIA_INVALID and write no row", async () => {
      const before = await partnerCount();
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
          field: "logo",
          filename: "a.gif",
          contentType: "image/gif",
          body: gif,
        },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/partners",
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
      expect(await partnerCount()).toBe(before);
    });

    it("012 EARS-4: when an unknown partner id is addressed, the system shall answer 404 RESOURCE_NOT_FOUND without disclosing anything", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/partners/${randomUUID()}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(404);
      expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      // A slug is not an admin address — the admin surface is id-only.
      const bySlug = await app.inject({
        method: "GET",
        url: "/v1/admin/partners/romashka",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(bySlug.statusCode).toBe(404);
    });

    it("012 EARS-4: when a partner mutation commits, feature 010 shall hold an attributed audit row of ordinary columns", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [body.id],
      );
      expect(rows.map((r) => r.event_type)).toContain("data.partners.insert");
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

    async function partnerCount(): Promise<number> {
      const { rows } = await pool.query("SELECT count(*) FROM partners");
      return Number(rows[0]!.count);
    }

    /** How many partner-logo objects the store currently holds. */
    async function logoObjectCount(): Promise<number> {
      const { rows } = await pool.query<{ logo_ref: string | null }>(
        "SELECT logo_ref FROM partners WHERE logo_ref IS NOT NULL",
      );
      let present = 0;
      for (const row of rows) {
        if (row.logo_ref && (await storage.exists(row.logo_ref))) present += 1;
      }
      return present;
    }
  },
);
