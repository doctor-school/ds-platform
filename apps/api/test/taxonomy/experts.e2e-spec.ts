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

// 012 EARS-2 (#1284) — the expert authoring vertical over the REAL stack:
// Fastify + the 011 admin session + Postgres + object storage. It is the SAME
// §5.1 contract the project vertical proved, so this suite asserts the three
// things that are genuinely expert-specific — the slug generated from the NAME,
// the `photo` media slot, and the deterministic server-computed initials that
// answer a missing photo — plus the reject branches whose zero-side-effect
// guarantee has to hold per entity, not per codebase.
//
// Skips when the stand is absent, exactly as the 007 admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-2 expert authoring vertical (e2e)",
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
    const createdExpertIds: string[] = [];
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
      const email = uniqueEmail("exp-admin");
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
      const email = uniqueEmail("exp-doctor");
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
      const boundary = `----ds1284${Math.random().toString(16).slice(2)}`;
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
        url: "/v1/admin/experts",
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
        name: `Иванова Мария ${Math.random().toString(36).slice(2, 8)}`,
        professionalRole: "Кардиолог",
        credentials: "Д.м.н., профессор",
        affiliation: "НМИЦ кардиологии",
        bio: "Практикующий кардиолог, автор клинических рекомендаций.",
        ...overrides,
      };
    }

    /** Track a created expert for cleanup and return its body. */
    async function created(res: { payload: string }) {
      const body = JSON.parse(res.payload) as { id: string };
      createdExpertIds.push(body.id);
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
      for (const id of createdExpertIds.splice(0)) {
        await pool.query(
          "DELETE FROM media_cleanup_jobs WHERE entity_id = $1",
          [id],
        );
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

    it("012 EARS-2: when a platform_admin creates an expert, the system shall persist one retained draft row with a slug generated from the name, version 1 and an ETag", async () => {
      const uniqueName = `Иванова Мария ${randomUUID().slice(0, 8)}`;
      const res = await createJson({
        payload: validPayload({ name: uniqueName }),
      });
      expect(res.statusCode).toBe(201);
      const body = await created(res);
      expect(body).toMatchObject({
        name: uniqueName,
        professionalRole: "Кардиолог",
        status: "draft",
        version: 1,
        photoUrl: null,
        firstPublishedAt: null,
        slugEditable: true,
        contentRemovedAt: null,
      });
      // The slug is derived from the NAME — an expert has no title.
      expect(body.slug).toMatch(/^ivanova-mariya/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/experts/${body.id}`);

      // The SAME row is what the list and the detail render — no second copy.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({
        id: body.id,
        slug: body.slug,
      });
      const list = await app.inject({
        method: "GET",
        url: `/v1/admin/experts?q=${encodeURIComponent(uniqueName)}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      const listBody = JSON.parse(list.payload) as {
        data: { id: string; professionalRole: string | null }[];
        total: number;
        page: number;
      };
      expect(listBody.data.map((r) => r.id)).toContain(body.id);
      expect(listBody.page).toBe(1);
    });

    it("012 EARS-2: when an expert has no photo, the system shall answer deterministic initials derived from the name", async () => {
      const withoutPhoto = await created(
        await createJson({ payload: validPayload({ name: "Иванова Мария" }) }),
      );
      expect(withoutPhoto).toMatchObject({ photoUrl: null, initials: "ИМ" });

      // The SAME derivation on every read of the same person — the admin avatar,
      // the public projection (#1294) and the speaker projection (#1290) cannot
      // disagree, because only the server computes it (012-design §2.2).
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/${withoutPhoto.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(detail.payload)).toMatchObject({ initials: "ИМ" });
    });

    it("012 EARS-2: when the create rides multipart with one photo, the system shall store only canonical WebP bytes under a server-generated key", async () => {
      const source = await stillPng();
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "photo",
          filename: "photo.png",
          contentType: "image/png",
          body: source,
        },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
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
      expect(body.photoUrl).toBeTypeOf("string");

      const { rows } = await pool.query<{ photo_ref: string }>(
        "SELECT photo_ref FROM experts WHERE id = $1",
        [body.id],
      );
      const ref = rows[0]!.photo_ref;
      // A server-generated key — never a client value, never the filename.
      expect(ref).toMatch(/^taxonomy\/experts\/photos\//);
      expect(ref).not.toContain("photo.png");
      const stored = await storage.getBytes(ref);
      expect(stored).not.toBeNull();
      expect((await sharp(stored!).metadata()).format).toBe("webp");
      // The ORIGINAL bytes never reached storage.
      expect(stored!.equals(source)).toBe(false);
    });

    it("012 EARS-2: when an expert is edited with a matching If-Match, the system shall update the same row and bump its version", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: {
          professionalRole: "Кардиолог, аритмолог",
          affiliation: "НМИЦ терапии",
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: body.id,
        professionalRole: "Кардиолог, аритмолог",
        affiliation: "НМИЦ терапии",
        version: 2,
      });
      expect(res.headers.etag).toBe('W/"2"');
      const { rows } = await pool.query(
        "SELECT count(*) FROM experts WHERE id = $1",
        [body.id],
      );
      expect(Number(rows[0]!.count)).toBe(1);
    });

    it("012 EARS-2: when a photo is replaced or cleared, the system shall enqueue a durable cleanup job for the released key in the same transaction", async () => {
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) }, [
        {
          field: "photo",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(40, 30),
        },
      ]);
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
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
        await pool.query<{ photo_ref: string }>(
          "SELECT photo_ref FROM experts WHERE id = $1",
          [body.id],
        )
      ).rows[0]!.photo_ref;

      // Replace with different bytes.
      const mp2 = multipartBody({ payload: JSON.stringify({}) }, [
        {
          field: "photo",
          filename: "b.png",
          contentType: "image/png",
          body: await stillPng(48, 36),
        },
      ]);
      const replace = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
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
        await pool.query<{ photo_ref: string }>(
          "SELECT photo_ref FROM experts WHERE id = $1",
          [body.id],
        )
      ).rows[0]!.photo_ref;
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
        entity_kind: "expert",
        slot: "photo",
      });

      // Now CLEAR the current photo — a second obligation, kind `clear`, and the
      // row falls back to initials rather than an empty box.
      const clear = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
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
      const cleared = JSON.parse(clear.payload) as {
        photoUrl: string | null;
        initials: string;
      };
      expect(cleared.photoUrl).toBeNull();
      expect(cleared.initials).toMatch(/^\p{Lu}/u);
      const kinds = (
        await pool.query<{ cleanup_kind: string }>(
          "SELECT cleanup_kind FROM media_cleanup_jobs WHERE entity_id = $1 ORDER BY created_at",
          [body.id],
        )
      ).rows.map((r) => r.cleanup_kind);
      expect(kinds).toEqual(["replace", "clear"]);
    });

    it("012 EARS-15: the list shall search names case-insensitively and exclude retired rows by default", async () => {
      const marker = randomUUID().slice(0, 8);
      const body = await created(
        await createJson({
          payload: validPayload({ name: `Петров ${marker}` }),
        }),
      );
      // LD-6: ordinary case-insensitive substring search over the name.
      const found = await app.inject({
        method: "GET",
        url: `/v1/admin/experts?q=${encodeURIComponent(marker.toUpperCase())}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(found.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).toContain(body.id);

      await pool.query(
        "UPDATE experts SET status = 'retired', deleted_at = now() WHERE id = $1",
        [body.id],
      );
      const def = await app.inject({
        method: "GET",
        url: `/v1/admin/experts?q=${marker}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(def.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).not.toContain(body.id);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/experts?q=${marker}&includeRetired=true`,
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
        url: `/v1/admin/experts/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({ status: "retired" });
    });

    // ── Reject branches ───────────────────────────────────────────────────

    it("012 EARS-16: when the caller has no admin session, the system shall refuse with a Problem Details body and no row", async () => {
      const before = await expertCount();
      const anon = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
        headers: { ...device, "content-type": "application/json" },
        payload: validPayload(),
      });
      expect(anon.statusCode).toBe(401);

      // A DOCTOR-portal session is not an admin session (011 EARS-2).
      const doctor = await doctorCookie();
      const wrongTier = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
        headers: {
          ...device,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${doctor}`,
          "idempotency-key": randomUUID(),
        },
        payload: validPayload(),
      });
      expect(wrongTier.statusCode).toBe(401);
      expect(await expertCount()).toBe(before);
    });

    it("012 EARS-17: when the Idempotency-Key is missing or non-canonical, the system shall refuse before any row is written", async () => {
      const before = await expertCount();
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
      expect(await expertCount()).toBe(before);
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
        "SELECT count(*) FROM experts WHERE slug = $1",
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
        payload: validPayload({ name: "Совсем другой эксперт" }),
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

    it("012 EARS-2: when a slug is already held by a retained row, the system shall refuse with SLUG_CONFLICT", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const clash = await createJson({
        payload: validPayload({ slug: body.slug }),
      });
      expect(clash.statusCode).toBe(409);
      expect(problem(clash).errorCode).toBe("SLUG_CONFLICT");
    });

    it("012 EARS-2: when the expert was first published, the system shall refuse a slug change with SLUG_IMMUTABLE and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE experts SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
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
        "SELECT slug, version FROM experts WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });
      // The detail read tells the UI the field is locked.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(detail.payload)).toMatchObject({ slugEditable: false });

      // Echoing the OWN slug is not a change: the «Основное» tab posts the whole
      // form, so refusing the echo would block every ordinary edit.
      const echo = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { slug: body.slug, professionalRole: "Терапевт" },
      });
      expect(echo.statusCode).toBe(200);
      expect(JSON.parse(echo.payload)).toMatchObject({
        slug: body.slug,
        professionalRole: "Терапевт",
        version: 2,
      });
    });

    it("012 EARS-5: when a PATCH would leave a published projection incomplete, the system shall refuse with a field-addressed PUBLISH_REQUIREMENTS_NOT_MET", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE experts SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { bio: null },
      });
      expect(res.statusCode).toBe(409);
      const detail = problem(res);
      expect(detail.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      expect(detail.errors?.map((e) => e.path)).toContain("bio");
      const { rows } = await pool.query<{ bio: string; version: number }>(
        "SELECT bio, version FROM experts WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({
        bio: "Практикующий кардиолог, автор клинических рекомендаций.",
        version: 1,
      });
    });

    it("012 EARS-14: when an editorially removed expert is edited, the system shall refuse with CONTENT_REMOVED and repopulate nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      // #1306 owns the removal command; the refusal exists from day one so no
      // window lets an ordinary edit put a removed person back on the site.
      await pool.query(
        `UPDATE experts
            SET content_removed_at = now(), status = 'retired', deleted_at = now(),
                name = NULL, photo_ref = NULL, professional_role = NULL,
                credentials = NULL, affiliation = NULL, bio = NULL
          WHERE id = $1`,
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { name: "Возвращённое имя" },
      });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("CONTENT_REMOVED");
      const { rows } = await pool.query<{ name: string | null }>(
        "SELECT name FROM experts WHERE id = $1",
        [body.id],
      );
      expect(rows[0]!.name).toBeNull();
    });

    it("012 EARS-17: when If-Match is absent or stale, the system shall answer 428 then 412 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const absent = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { professionalRole: "Без предусловия" },
      });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"99"',
        },
        payload: { professionalRole: "Устаревшая версия" },
      });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");
      const { rows } = await pool.query<{
        professional_role: string;
        version: number;
      }>("SELECT professional_role, version FROM experts WHERE id = $1", [
        body.id,
      ]);
      expect(rows[0]!.version).toBe(1);
      expect(rows[0]!.professional_role).toBe("Кардиолог");
    });

    it("012 EARS-16: when client JSON supplies a storage reference or an unknown field, the system shall refuse with VALIDATION_FAILED", async () => {
      const before = await expertCount();
      const res = await createJson({
        payload: validPayload({ photoRef: "taxonomy/experts/photos/x.webp" }),
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      expect(await expertCount()).toBe(before);
    });

    it("012 EARS-16: when the multipart request carries no file, the wrong part name or two files, the system shall refuse before upload", async () => {
      const before = await expertCount();
      const objectsBefore = await photoObjectCount();
      const payload = JSON.stringify(validPayload());

      const noFile = multipartBody({ payload });
      const noFileRes = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
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

      // `cover` is the PROJECT slot — on an expert it is a wrong part name.
      const wrongName = multipartBody({ payload }, [
        {
          field: "cover",
          filename: "c.png",
          contentType: "image/png",
          body: await stillPng(),
        },
      ]);
      const wrongNameRes = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
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
          field: "photo",
          filename: "a.png",
          contentType: "image/png",
          body: await stillPng(),
        },
        {
          field: "photo",
          filename: "b.png",
          contentType: "image/png",
          body: await stillPng(44, 30),
        },
      ]);
      const twoFilesRes = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
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

      expect(await expertCount()).toBe(before);
      expect(await photoObjectCount()).toBe(objectsBefore);
    });

    it("012 EARS-2: when a photo file rides a mediaAction clear, the system shall refuse with MEDIA_INPUT_CONFLICT", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const mp = multipartBody(
        { payload: JSON.stringify({ mediaAction: "clear" }) },
        [
          {
            field: "photo",
            filename: "a.png",
            contentType: "image/png",
            body: await stillPng(),
          },
        ],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${body.id}`,
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

    it("012 EARS-2: when the photo is a GIF or an animated container, the system shall refuse with MEDIA_INVALID and write no row", async () => {
      const before = await expertCount();
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
          field: "photo",
          filename: "a.gif",
          contentType: "image/gif",
          body: gif,
        },
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/experts",
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
      expect(await expertCount()).toBe(before);
    });

    it("012 EARS-2: when an unknown expert id is addressed, the system shall answer 404 RESOURCE_NOT_FOUND without disclosing anything", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/${randomUUID()}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(404);
      expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      // A slug is not an admin address — the admin surface is id-only.
      const bySlug = await app.inject({
        method: "GET",
        url: "/v1/admin/experts/ivanova-mariya",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(bySlug.statusCode).toBe(404);
    });

    it("012 EARS-2: when an expert mutation commits, feature 010 shall hold an attributed audit row of ordinary columns", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [body.id],
      );
      expect(rows.map((r) => r.event_type)).toContain("data.experts.insert");
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

    async function expertCount(): Promise<number> {
      const { rows } = await pool.query("SELECT count(*) FROM experts");
      return Number(rows[0]!.count);
    }

    /** How many expert-photo objects the store currently holds. */
    async function photoObjectCount(): Promise<number> {
      const { rows } = await pool.query<{ photo_ref: string | null }>(
        "SELECT photo_ref FROM experts WHERE photo_ref IS NOT NULL",
      );
      let present = 0;
      for (const row of rows) {
        if (row.photo_ref && (await storage.exists(row.photo_ref)))
          present += 1;
      }
      return present;
    }
  },
);
