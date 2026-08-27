import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { DIRECTION_ADJACENCY_KINDS } from "@ds/schemas";
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

// 012 EARS-3 (#1285) — the curated direction authoring vertical over the REAL
// stack: Fastify + the 011 admin session + Postgres. It is the SAME §5.1
// contract the project and expert verticals proved, so this suite asserts what
// is genuinely direction-specific — the slug generated from the TITLE, and the
// JSON-only request shape of an entity that has no media slot at all — plus the
// reject branches whose zero-side-effect guarantee has to hold per entity,
// rather than being assumed from a sibling's suite.
//
// The multipart plugin IS registered here, exactly as production registers it
// for the entities that do carry a binary: that is the only way to prove a
// multipart POST to `admin/directions` is refused by THIS controller with the
// documented 415, and not merely dropped by an unconfigured body parser.
//
// Skips when the stand is absent, exactly as the 007 admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-3 curated direction authoring vertical (e2e)",
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
    const createdDirectionIds: string[] = [];
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

    /** A minimal multipart envelope — a direction has no file part to offer. */
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
        url: "/v1/admin/directions",
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

    /** Track a created direction for cleanup and return its body. */
    async function created(res: { payload: string }) {
      const body = JSON.parse(res.payload) as { id: string };
      createdDirectionIds.push(body.id);
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
      for (const id of createdDirectionIds.splice(0)) {
        // The joins reference `directions` with ON DELETE RESTRICT, so a
        // fixture edge has to go first — the FK is the production guarantee
        // that a direction is retired and never deleted.
        await pool.query(
          "DELETE FROM direction_adjacency WHERE direction_id = $1 OR adjacent_direction_id = $1",
          [id],
        );
        await pool.query(
          "DELETE FROM direction_specialties WHERE direction_id = $1",
          [id],
        );
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
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

    it("012 EARS-3: when a platform_admin creates a direction, the system shall persist one retained draft row with a slug generated from the title, version 1 and an ETag", async () => {
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
      });
      // The projection carries no `slugEditable`: the address is derived and
      // never authored, so there is no affordance for the flag to gate.
      expect(body).not.toHaveProperty("slugEditable");
      // The slug is derived from the TITLE — a direction has no name and no
      // description, so the heading is its whole identity source (§2.2).
      expect(body.slug).toMatch(/^kardiologiya-/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/directions/${body.id}`);

      // The SAME row is what the list and the detail render — no second copy.
      const detail = await app.inject({
        method: "GET",
        url: `/v1/admin/directions/${body.id}`,
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
        url: `/v1/admin/directions?q=${encodeURIComponent(marker)}`,
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

    it("012 EARS-3: when a direction is edited with a matching If-Match, the system shall update the same row and bump its version", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/directions/${body.id}`,
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
        "SELECT slug, count(*) OVER () AS count FROM directions WHERE id = $1",
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
        url: `/v1/admin/directions?q=${encodeURIComponent(marker.toUpperCase())}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(found.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).toContain(body.id);

      await pool.query(
        "UPDATE directions SET status = 'retired', deleted_at = now() WHERE id = $1",
        [body.id],
      );
      const def = await app.inject({
        method: "GET",
        url: `/v1/admin/directions?q=${marker}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(def.payload) as { data: { id: string }[] }).data.map(
          (r) => r.id,
        ),
      ).not.toContain(body.id);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/directions?q=${marker}&includeRetired=true`,
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
        url: `/v1/admin/directions/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect(JSON.parse(detail.payload)).toMatchObject({ status: "retired" });
    });

    // ── Reject branches ───────────────────────────────────────────────────

    it("012 EARS-16: when the caller has no admin session, the system shall refuse with a Problem Details body and no row", async () => {
      const before = await directionCount();
      const anon = await app.inject({
        method: "POST",
        url: "/v1/admin/directions",
        headers: { ...device, "content-type": "application/json" },
        payload: validPayload(),
      });
      expect(anon.statusCode).toBe(401);

      // A DOCTOR-portal session is not an admin session (011 EARS-2).
      const doctor = await doctorCookie();
      const wrongTier = await app.inject({
        method: "POST",
        url: "/v1/admin/directions",
        headers: {
          ...device,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${doctor}`,
          "idempotency-key": randomUUID(),
        },
        payload: validPayload(),
      });
      expect(wrongTier.statusCode).toBe(401);
      expect(await directionCount()).toBe(before);
    });

    it("012 EARS-17: when the Idempotency-Key is missing or non-canonical, the system shall refuse before any row is written", async () => {
      const before = await directionCount();
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
      expect(await directionCount()).toBe(before);
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
        "SELECT count(*) FROM directions WHERE slug = $1",
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

    it("EARS-18.4: the create surface shall refuse an authored slug outright instead of honouring it", async () => {
      const before = await directionCount();
      const res = await createJson({
        payload: validPayload({ slug: "sovsem-drugoy-adres" }),
      });
      // There is exactly one implementation of the derivation and a client
      // cannot opt out of it: under `.strict()` the extra key is a 400, not a
      // silently accepted override of a permanent public address.
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      expect(await directionCount()).toBe(before);
    });

    it("EARS-18.4: the edit surface shall refuse a slug change with the same 400, published or not", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      await pool.query(
        "UPDATE directions SET status = 'published', first_published_at = now() WHERE id = $1",
        [body.id],
      );
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/admin/directions/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { slug: "sovsem-drugoy-adres" },
      });
      // The old 409 `SLUG_IMMUTABLE` path is unreachable from this surface now:
      // the address never arrives from the operator at all, so the refusal is
      // pre-domain and does not depend on whether the row was ever published.
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      const { rows } = await pool.query<{ slug: string; version: number }>(
        "SELECT slug, version FROM directions WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });

      // The address survives an ordinary retitle of a PUBLISHED direction — a
      // doctor's bookmark outlives an editorial rewording of the heading.
      const retitle = await app.inject({
        method: "PATCH",
        url: `/v1/admin/directions/${body.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { title: "Кардиология (переименована)" },
      });
      expect(retitle.statusCode).toBe(200);
      expect(JSON.parse(retitle.payload)).toMatchObject({
        slug: body.slug,
        title: "Кардиология (переименована)",
        version: 2,
      });
    });

    it("EARS-18.5: two directions whose titles fold to the same address shall both be created, the second one deterministically suffixed", async () => {
      // The heading carries a per-run marker so the assertion is about the
      // COLLISION SEQUENCE and not about which rows a shared stand happens to
      // hold already — an operator-authored `detskaya-kardiologiya` left over
      // from a live walkthrough must not decide whether this contract holds.
      const marker = randomUUID().slice(0, 8);
      const title = `Детская кардиология ${marker}`;
      const first = await created(await createJson({ payload: { title } }));
      expect(first.slug).toBe(`detskaya-kardiologiya-${marker}`);

      const second = await created(await createJson({ payload: { title } }));
      // The operator never chose the address, so a taken candidate is not a
      // refusal they could act on — the server walks the deterministic sequence.
      expect(second.slug).toBe(`detskaya-kardiologiya-${marker}-2`);
      expect(second.id).not.toBe(first.id);
    });

    it("EARS-18.6: a title that folds to nothing sluggable shall be refused against `title`, the field the operator typed", async () => {
      const before = await directionCount();
      const res = await createJson({ payload: { title: "🫀🫁" } });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      // Not against a `slug` field: there is no slug input left to point at, and
      // inventing an identity for a permanent public URL is worse than asking.
      expect(
        (problem(res) as { errors?: { path: string }[] }).errors?.map(
          (e) => e.path,
        ),
      ).toContain("title");
      expect(await directionCount()).toBe(before);
    });

    it("012 EARS-17: when If-Match is absent or stale, the system shall answer 428 then 412 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const absent = await app.inject({
        method: "PATCH",
        url: `/v1/admin/directions/${body.id}`,
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
        url: `/v1/admin/directions/${body.id}`,
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
        "SELECT title, version FROM directions WHERE id = $1",
        [body.id],
      );
      expect(rows[0]!.version).toBe(1);
      expect(rows[0]!.title).toBe(body.title);
    });

    it("012 EARS-16: when client JSON supplies a field this feature does not have, the system shall refuse with VALIDATION_FAILED", async () => {
      const before = await directionCount();
      // A direction has NO description and NO media. Silently ignoring either would
      // let an operator believe the platform stored something it never will.
      for (const extra of [
        { description: "Подробное описание темы" },
        { coverRef: "taxonomy/directions/covers/x.webp" },
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
      expect(await directionCount()).toBe(before);
    });

    it("012 EARS-16: when the request is not application/json, the system shall refuse with 415 and write no row", async () => {
      const before = await directionCount();
      // Multipart is not "an upload in the wrong place" for a direction — it is a
      // shape that could never be satisfied, because there is no file part name
      // to accept. The plugin IS registered, so this 415 is the controller's.
      const mp = multipartBody({ payload: JSON.stringify(validPayload()) });
      const multipartRes = await app.inject({
        method: "POST",
        url: "/v1/admin/directions",
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
        url: "/v1/admin/directions",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "text/plain",
          "idempotency-key": randomUUID(),
        },
        payload: JSON.stringify(validPayload()),
      });
      expect(textRes.statusCode).toBe(415);
      expect(await directionCount()).toBe(before);
    });

    it("012 EARS-3: when an unknown direction id is addressed, the system shall answer 404 RESOURCE_NOT_FOUND without disclosing anything", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/directions/${randomUUID()}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(404);
      expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      // A slug is not an admin address — the admin surface is id-only.
      const bySlug = await app.inject({
        method: "GET",
        url: "/v1/admin/directions/kardiologiya",
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(bySlug.statusCode).toBe(404);
    });

    it("012 EARS-3: when a direction mutation commits, feature 010 shall hold an attributed audit row of ordinary columns", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1`,
        [body.id],
      );
      expect(rows.map((r) => r.event_type)).toContain("data.directions.insert");
      expect(rows[0]!.subject_id).not.toBeNull();
    });

    // ── Lifecycle: publish / retire / restore (012 EARS-13/14, §3.1) ──────

    it("012 EARS-13: when a draft direction is published, the system shall stamp first_published_at once and refuse a second publish with INVALID_TRANSITION", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await publish(body.id, 1);
      expect(res.statusCode).toBe(200);
      const published = JSON.parse(res.payload) as {
        status: string;
        version: number;
        firstPublishedAt: string | null;
      };
      expect(published).toMatchObject({ status: "published", version: 2 });
      expect(published.firstPublishedAt).toBeTypeOf("string");
      expect(res.headers.etag).toBe('W/"2"');

      // A publish withdraws nothing, so it carries NO impact envelope — the
      // §3.1 gate fences the subtractive half of the lifecycle only.
      expect(res.headers["lifecycle-impact-token"]).toBeUndefined();

      // Publishing an already-published row is not "already done": the operator
      // is looking at a stale screen, and 409 says so without touching the row.
      const again = await publish(body.id, 2);
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");
      const after = await directionRow(body.id);
      expect(after.version).toBe(2);
      expect(after.first_published_at).toEqual(
        new Date(published.firstPublishedAt!),
      );
    });

    it("012 EARS-13: when a retire is confirmed without a lifecycle-impact token, the system shall answer 428 LIFECYCLE_IMPACT_REQUIRED and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const res = await confirm(body.id, "retire", { version: 1, token: null });
      expect(res.statusCode).toBe(428);
      expect(problem(res).errorCode).toBe("LIFECYCLE_IMPACT_REQUIRED");
      const row = await directionRow(body.id);
      expect(row).toMatchObject({ status: "draft", version: 1 });
      expect(row.deleted_at).toBeNull();
    });

    it("012 EARS-13: when a previewed retire is confirmed, the system shall withdraw the SAME row — id and slug retained — and the list shall surface it only with includeRetired", async () => {
      const marker = randomUUID().slice(0, 8);
      const body = await created(
        await createJson({
          payload: validPayload({ title: `Пульмонология ${marker}` }),
        }),
      );
      const res = await move(body.id, "retire");
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: body.id,
        slug: body.slug,
        status: "retired",
        version: 2,
      });
      const row = await directionRow(body.id);
      expect(row.status).toBe("retired");
      expect(row.deleted_at).not.toBeNull();
      expect(row.slug).toBe(body.slug);

      // The finding-1 acceptance: the «показывать снятые» switch is only ever
      // meaningful because a direction CAN now be retired — a retired row is
      // absent by default and present iff `includeRetired` is on.
      expect(await listIds(`q=${marker}`)).not.toContain(body.id);
      expect(await listIds(`q=${marker}&includeRetired=true`)).toContain(
        body.id,
      );
    });

    it("012 EARS-14: when a retired direction is restored, the system shall return the SAME row as a draft, clear deleted_at and keep first_published_at", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      expect((await publish(body.id, 1)).statusCode).toBe(200);
      const firstPublishedAt = (await directionRow(body.id)).first_published_at;
      expect((await move(body.id, "retire")).statusCode).toBe(200);

      const res = await move(body.id, "restore");
      expect(res.statusCode).toBe(200);
      // §102 — a restore hands the row back to the operator as a DRAFT: coming
      // back into circulation is a deliberate second act, not a side effect.
      expect(JSON.parse(res.payload)).toMatchObject({
        id: body.id,
        slug: body.slug,
        status: "draft",
        version: 4,
      });
      const row = await directionRow(body.id);
      expect(row.deleted_at).toBeNull();
      expect(row.first_published_at).toEqual(firstPublishedAt);
    });

    it("012 EARS-13: when an adjacency edge appears between preview and confirmation, the system shall answer 412 LIFECYCLE_IMPACT_STALE and change nothing", async () => {
      const target = await created(
        await createJson({ payload: validPayload() }),
      );
      const neighbour = await created(
        await createJson({ payload: validPayload({ title: "Неврология" }) }),
      );
      const preview = await previewed(target.id, "retire");
      expect(preview.impactToken).toBeTypeOf("string");

      // The set the operator SAW is now not the set the confirmation would
      // withdraw — the edge is discovered by the fingerprint, so the envelope
      // no longer describes reality.
      await pool.query(
        `INSERT INTO direction_adjacency (direction_id, adjacent_direction_id, kind)
           VALUES ($1, $2, $3)`,
        [neighbour.id, target.id, DIRECTION_ADJACENCY_KINDS[0]],
      );

      const res = await confirm(target.id, "retire", {
        version: preview.version,
        token: preview.impactToken,
      });
      expect(res.statusCode).toBe(412);
      expect(problem(res).errorCode).toBe("LIFECYCLE_IMPACT_STALE");
      const row = await directionRow(target.id);
      expect(row).toMatchObject({ status: "draft", version: 1 });
      expect(row.deleted_at).toBeNull();

      // Re-previewing after the change confirms cleanly: the operator is shown
      // the edge, then allowed to act on what they saw.
      const fresh = await previewed(target.id, "retire");
      expect(fresh.affected.map((a) => a.kind)).toContain("direction↔direction");
      const ok = await confirm(target.id, "retire", {
        version: fresh.version,
        token: fresh.impactToken,
      });
      expect(ok.statusCode).toBe(200);
    });

    // ── helpers ───────────────────────────────────────────────────────────

    interface Preview {
      transition: string;
      version: number;
      affected: { kind: string; id: string; status: string }[];
      impactToken: string;
    }

    /** The §3.1 preview — what this transition would change, plus its envelope. */
    async function previewed(
      id: string,
      transition: string,
    ): Promise<Preview> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/directions/${id}/lifecycle-impact?transition=${transition}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload) as Preview;
    }

    /**
     * Confirm a transition. Every header is individually overridable so a
     * reject branch can omit exactly one of them and nothing else.
     */
    async function confirm(
      id: string,
      transition: string,
      opts: { version?: number; ifMatch?: string | null; token?: string | null },
    ) {
      const headers: Record<string, string> = {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
        "idempotency-key": key(),
      };
      const ifMatch =
        opts.ifMatch === undefined ? `W/"${opts.version}"` : opts.ifMatch;
      if (ifMatch !== null) headers["if-match"] = ifMatch;
      if (opts.token !== null && opts.token !== undefined) {
        headers["lifecycle-impact-token"] = opts.token;
      }
      return app.inject({
        method: "POST",
        url: `/v1/admin/directions/${id}/${transition}`,
        headers,
        payload: {},
      });
    }

    /** Preview then immediately confirm — the ordinary operator flow. */
    async function move(id: string, transition: string) {
      const p = await previewed(id, transition);
      return confirm(id, transition, {
        version: p.version,
        token: p.impactToken,
      });
    }

    /** `POST :id/publish` — the additive half, which carries no envelope. */
    async function publish(id: string, version: number) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/directions/${id}/publish`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": `W/"${version}"`,
        },
        payload: {},
      });
    }

    async function directionRow(id: string): Promise<{
      status: string;
      version: number;
      slug: string;
      deleted_at: Date | null;
      first_published_at: Date | null;
    }> {
      const { rows } = await pool.query<{
        status: string;
        version: number;
        slug: string;
        deleted_at: Date | null;
        first_published_at: Date | null;
      }>(
        "SELECT status, version, slug, deleted_at, first_published_at FROM directions WHERE id = $1",
        [id],
      );
      return rows[0]!;
    }

    async function listIds(query: string): Promise<string[]> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/directions?${query}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.payload) as { data: { id: string }[] }).data.map(
        (r) => r.id,
      );
    }


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

    async function directionCount(): Promise<number> {
      const { rows } = await pool.query("SELECT count(*) FROM directions");
      return Number(rows[0]!.count);
    }
  },
);
