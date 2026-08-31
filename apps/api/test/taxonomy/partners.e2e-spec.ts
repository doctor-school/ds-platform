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
import { OBJECT_STORAGE, type ObjectStorage } from "../../src/storage/index.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

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
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
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
      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("prt-admin"),
        password,
        consent,
      });
      await fake.grantProjectRole(sub, "platform_admin");
      return (
        await establishAdminSession(app, {
          identifier: email,
          password,
          device,
        })
      ).sid;
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
        await pool.query(
          "DELETE FROM media_cleanup_jobs WHERE entity_id = $1",
          [id],
        );
        await pool.query("DELETE FROM partners WHERE id = $1", [id]);
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
      });
      expect(body).not.toHaveProperty("slugEditable");
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
        await createJson({
          payload: validPayload({ title: `Ромашка ${marker}` }),
        }),
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
        (
          JSON.parse(withRetired.payload) as { data: { id: string }[] }
        ).data.map((r) => r.id),
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

    it("EARS-20: when partner create carries a slug, the system shall reject it without mutation", async () => {
      const before = await partnerCount();
      const body = await created(await createJson({ payload: validPayload() }));
      const clash = await createJson({
        payload: validPayload({ slug: body.slug }),
      });
      expect(clash.statusCode).toBe(400);
      expect(problem(clash).errorCode).toBe("VALIDATION_FAILED");
      expect(await partnerCount()).toBe(before + 1);
    });

    it("EARS-20: same-title, retained and concurrent partner collisions shall allocate distinct stable slugs", async () => {
      const marker = randomUUID().slice(0, 8);
      const title = `Stable partner ${marker}`;
      const first = await created(
        await createJson({ payload: validPayload({ title }) }),
      );
      await pool.query(
        "UPDATE partners SET status = 'retired', deleted_at = now() WHERE id = $1",
        [first.id],
      );
      const second = await created(
        await createJson({ payload: validPayload({ title }) }),
      );
      expect(second.slug).toBe(`stable-partner-${marker}-2`);

      const concurrentTitle = `Concurrent partner ${marker}`;
      const responses = await Promise.all([
        createJson({ payload: validPayload({ title: concurrentTitle }) }),
        createJson({ payload: validPayload({ title: concurrentTitle }) }),
      ]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        201, 201,
      ]);
      const bodies = responses.map(
        (response) => JSON.parse(response.payload) as { slug: string },
      );
      expect(bodies.map(({ slug }) => slug).sort()).toEqual(
        [
          `concurrent-partner-${marker}`,
          `concurrent-partner-${marker}-2`,
        ].sort(),
      );
    });

    it("EARS-20: a partner title with no transliterable base shall receive a system fallback", async () => {
      const body = await created(
        await createJson({ payload: validPayload({ title: "🫀🧠" }) }),
      );
      expect(body.slug).toMatch(/^partner(?:-\d+)?$/);
    });

    it("EARS-20: when partner PATCH carries a slug, the system shall reject it and change nothing", async () => {
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
        payload: { slug: "sovsem-drugoy-adres" },
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      const { rows } = await pool.query<{ slug: string; version: number }>(
        "SELECT slug, version FROM partners WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/partners/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(detail.payload)).not.toHaveProperty("slugEditable");

      // A normal title edit retains the system-owned address.
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
        payload: { title: "Ромашка (правка)" },
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
        const res = await createJson({
          payload: validPayload({ websiteUrl: bad }),
        });
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

    // ── 012 EARS-5: publish completeness (#1287) ──────────────────────────
    //
    // A partner has NO completeness branch by decision, not omission: `title`
    // is NOT NULL at the schema level and §5.2 declares `logoUrl` / `websiteUrl`
    // nullable on `PublicPartner`, so a titled row already IS a complete public
    // projection. These cases pin that decision so a later "tighten it up"
    // cannot silently make the bare partner unpublishable.

    async function publishPartner(
      id: string,
      version: number,
      overrides: {
        ifMatch?: string | null;
        idempotencyKey?: string | null;
        sid?: string;
      } = {},
    ) {
      const ifMatch =
        overrides.ifMatch === undefined ? `W/"${version}"` : overrides.ifMatch;
      const idempotencyKey =
        overrides.idempotencyKey === undefined
          ? key()
          : overrides.idempotencyKey;
      return app.inject({
        method: "POST",
        url: `/v1/admin/partners/${id}/publish`,
        headers: {
          ...device,
          ...adminHeaders(overrides.sid ?? adminSid),
          ...(ifMatch === null ? {} : { "if-match": ifMatch }),
          ...(idempotencyKey === null
            ? {}
            : { "idempotency-key": idempotencyKey }),
        },
      });
    }

    async function partnerRow(id: string) {
      const { rows } = await pool.query<{
        status: string;
        version: number;
        first_published_at: Date | null;
      }>(
        "SELECT status, version, first_published_at FROM partners WHERE id = $1",
        [id],
      );
      return rows[0]!;
    }

    async function auditRowCount(id: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*) FROM audit_ledger WHERE metadata->'pk'->>'id' = $1",
        [id],
      );
      return Number(rows[0]!.count);
    }

    it("012 EARS-5.1: when a draft partner is published, the system shall stamp first_published_at once, bump the ETag and write the audit row in the same transaction", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const auditBefore = await auditRowCount(body.id);

      const res = await publishPartner(body.id, 1);
      expect(res.statusCode).toBe(200);
      const published = JSON.parse(res.payload) as {
        status: string;
        version: number;
        firstPublishedAt: string | null;
      };
      expect(published).toMatchObject({ status: "published", version: 2 });
      expect(published.firstPublishedAt).toBeTypeOf("string");
      expect(res.headers.etag).toBe('W/"2"');

      const row = await partnerRow(body.id);
      expect(row.status).toBe("published");
      expect(row.first_published_at).toEqual(
        new Date(published.firstPublishedAt!),
      );
      // Feature 010 writes the ledger row inside the SAME transaction as the
      // status change: had it been an after-the-fact side effect, this read
      // could observe the published row with no ledger entry behind it.
      expect(await auditRowCount(body.id)).toBeGreaterThan(auditBefore);
    });

    it("012 EARS-5.11: when a partner carries no logo, no website and no project relation, the system shall still publish it", async () => {
      const body = await created(
        await createJson({
          payload: { title: `Ромашка ${randomUUID().slice(0, 8)}` },
        }),
      );
      expect(body).toMatchObject({ logoUrl: null, websiteUrl: null });

      const res = await publishPartner(body.id, 1);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        status: "published",
        logoUrl: null,
        websiteUrl: null,
      });
    });

    it("012 EARS-5.12: when an already-published partner is published again, the system shall answer 409 INVALID_TRANSITION and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      expect((await publishPartner(body.id, 1)).statusCode).toBe(200);
      const stamped = (await partnerRow(body.id)).first_published_at;

      const again = await publishPartner(body.id, 2);
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");
      const after = await partnerRow(body.id);
      expect(after).toMatchObject({ status: "published", version: 2 });
      // Write-once: a refused second publish must not re-stamp the date that
      // pins the slug (LD-3).
      expect(after.first_published_at).toEqual(stamped);
    });

    it("012 EARS-5.13: when the publish carries no If-Match, a stale If-Match or no Idempotency-Key, the system shall answer 428/412/428 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));

      const absent = await publishPartner(body.id, 1, { ifMatch: null });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await publishPartner(body.id, 1, { ifMatch: 'W/"99"' });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");

      const garbage = await publishPartner(body.id, 1, { ifMatch: "not-an-etag" });
      expect([412, 428]).toContain(garbage.statusCode);

      const noKey = await publishPartner(body.id, 1, { idempotencyKey: null });
      expect(noKey.statusCode).toBe(428);

      expect(await partnerRow(body.id)).toMatchObject({
        status: "draft",
        version: 1,
      });
    });

    it("012 EARS-5.13: when the exact publish request is retried, the system shall replay the stored outcome instead of transitioning twice", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const reused = key();

      const first = await publishPartner(body.id, 1, { idempotencyKey: reused });
      expect(first.statusCode).toBe(200);
      const replay = await publishPartner(body.id, 1, {
        idempotencyKey: reused,
      });
      expect(replay.statusCode).toBe(200);
      // Value-identical, not byte-identical: the stored body round-trips through
      // jsonb, which does not preserve key order. What EARS-17 promises is the
      // same OUTCOME, and a deep comparison is exactly that promise.
      expect(JSON.parse(replay.payload)).toEqual(JSON.parse(first.payload));
      expect(replay.headers.etag).toBe(first.headers.etag);
      // One transition, not two: the replay must not have bumped the version.
      expect(await partnerRow(body.id)).toMatchObject({ version: 2 });
    });

    it("012 EARS-5.14: when a non-public partner is addressed on the public surface, the system shall answer exactly as it does for an unknown one", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const draft = await app.inject({
        method: "GET",
        url: `/v1/public/partners/${body.slug}/projects`,
        headers: device,
      });
      const unknown = await app.inject({
        method: "GET",
        url: `/v1/public/partners/${randomUUID()}/projects`,
        headers: device,
      });
      expect(draft.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
      // Indistinguishable: same status AND same error code, so a probe cannot
      // learn that a draft partner exists behind this slug.
      expect(problem(draft).errorCode).toBe(problem(unknown).errorCode);

      // Once published, the SAME address answers — proving the 404 above was
      // the visibility allow-list and not a missing route.
      expect((await publishPartner(body.id, 1)).statusCode).toBe(200);
      const visible = await app.inject({
        method: "GET",
        url: `/v1/public/partners/${body.slug}/projects`,
        headers: device,
      });
      expect(visible.statusCode).toBe(200);
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
