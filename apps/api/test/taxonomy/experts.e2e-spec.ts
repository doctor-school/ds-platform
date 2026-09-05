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
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";

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
    const createdPhones: string[] = [];
    const createdExpertIds: string[] = [];
    // EARS-5's slot rule is only testable against REAL events, real links and
    // real legacy speakers; all three reference rows this suite deletes, so
    // they are tracked separately and torn down first.
    const createdEventIds: string[] = [];
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
        nextEmail: () => uniqueEmail("exp-admin"),
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

    async function unlinkedUserId(): Promise<string> {
      const email = uniqueEmail("exp-link");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return rows[0]!.id;
    }

    async function selectorUser(displayName: string): Promise<{
      id: string;
      identifier: string;
      displayName: string;
    }> {
      const email = uniqueEmail("exp-selector");
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode, reg.payload).toBe(200);
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE users
            SET display_name = $2, updated_at = now()
          WHERE email = $1
          RETURNING id`,
        [email, displayName],
      );
      return { id: rows[0]!.id, identifier: email, displayName };
    }

    async function phoneOnlySelectorUser(): Promise<{
      id: string;
      identifier: string;
      displayName: null;
    }> {
      const phone = `+7${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;
      createdPhones.push(phone);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (zitadel_sub, phone)
         VALUES ($1, $2)
         RETURNING id`,
        [`selector-phone-${randomUUID()}`, phone],
      );
      return { id: rows[0]!.id, identifier: phone, displayName: null };
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
        familyName: `Иванова-${Math.random().toString(36).slice(2, 8)}`,
        givenName: "Мария",
        patronymic: "Ивановна",
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
        .overrideProvider(BOT_PROTECTION)
        .useValue({
          verify: (): Promise<BotProtectionResult> =>
            Promise.resolve({ ok: true }),
        } satisfies BotProtection)
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
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_experts WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
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
      for (const phone of createdPhones.splice(0)) {
        await deleteUserFixture(pool, "phone", phone);
      }
      await app.close();
    });

    // ── Accept branches ────────────────────────────────────────────────────

    it("012 EARS-2: when a platform_admin creates an expert, the system shall persist one retained draft row with a slug generated from the name, version 1 and an ETag", async () => {
      const uniqueFamilyName = `Иванова-${randomUUID().slice(0, 8)}`;
      const res = await createJson({
        payload: validPayload({ familyName: uniqueFamilyName }),
      });
      expect(res.statusCode).toBe(201);
      const body = await created(res);
      expect(body).toMatchObject({
        name: `${uniqueFamilyName} Мария Ивановна`,
        familyName: uniqueFamilyName,
        givenName: "Мария",
        patronymic: "Ивановна",
        userId: null,
        professionalRole: "Кардиолог",
        status: "draft",
        version: 1,
        photoUrl: null,
        firstPublishedAt: null,
        contentRemovedAt: null,
      });
      // The slug is derived from the NAME — an expert has no title.
      expect(body.slug).toMatch(/^ivanova-[a-z0-9]+-mariya-ivanovna$/);
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
        url: `/v1/admin/experts?q=${encodeURIComponent(uniqueFamilyName)}`,
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

    it("EARS-19: when an Expert is created or edited, the system shall link one unlinked User and explicitly unlink later", async () => {
      const createUserId = await unlinkedUserId();
      const linkedAtCreate = await created(
        await createJson({ payload: validPayload({ userId: createUserId }) }),
      );
      expect(linkedAtCreate).toMatchObject({
        userId: createUserId,
        version: 1,
      });

      const standalone = await created(
        await createJson({ payload: validPayload() }),
      );
      const laterUserId = await unlinkedUserId();
      const linkedLater = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${standalone.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { userId: laterUserId },
      });
      expect(linkedLater.statusCode).toBe(200);
      expect(JSON.parse(linkedLater.payload)).toMatchObject({
        userId: laterUserId,
        version: 2,
      });

      const unlinked = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${standalone.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"2"',
        },
        payload: { userId: null },
      });
      expect(unlinked.statusCode).toBe(200);
      expect(JSON.parse(unlinked.payload)).toMatchObject({
        userId: null,
        version: 3,
      });
    });

    it("012 EARS-19: duplicate User ownership returns USER_EXPERT_CONFLICT with zero Expert mutation", async () => {
      const userId = await unlinkedUserId();
      await created(await createJson({ payload: validPayload({ userId }) }));
      const standalone = await created(
        await createJson({ payload: validPayload() }),
      );
      const conflict = await app.inject({
        method: "PATCH",
        url: `/v1/admin/experts/${standalone.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: { userId },
      });
      expect(conflict.statusCode).toBe(409);
      expect(problem(conflict).errorCode).toBe("USER_EXPERT_CONFLICT");
      const { rows } = await pool.query<{
        user_id: string | null;
        version: number;
      }>("SELECT user_id, version FROM experts WHERE id = $1", [standalone.id]);
      expect(rows[0]).toEqual({ user_id: null, version: 1 });
    });

    it("012 EARS-19: when the Expert form searches eligible Users, the system shall return a bounded stable page, exclude other ownership, allow the current link and expose only minimal option data", async () => {
      const marker = `Selector-${randomUUID().slice(0, 8)}`;
      const current = await selectorUser(`A ${marker}`);
      const availableFirst = await selectorUser(`B ${marker}`);
      const occupied = await selectorUser(`C ${marker}`);
      const availableLast = await selectorUser(`B ${marker}`);
      const expectedAvailable = [availableFirst, availableLast].sort((a, b) =>
        a.identifier.localeCompare(b.identifier),
      );
      const currentExpert = await created(
        await createJson({ payload: validPayload({ userId: current.id }) }),
      );
      await created(
        await createJson({ payload: validPayload({ userId: occupied.id }) }),
      );

      const withoutCurrent = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(`  ${marker}  `)}&page=1&pageSize=20`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(withoutCurrent.statusCode, withoutCurrent.payload).toBe(200);
      expect(JSON.parse(withoutCurrent.payload)).toEqual({
        data: expectedAvailable,
        total: 2,
        page: 1,
        pageSize: 20,
      });

      const firstPageWithCurrent = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(marker)}&page=1&pageSize=2&currentExpertId=${currentExpert.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(firstPageWithCurrent.statusCode).toBe(200);
      expect(JSON.parse(firstPageWithCurrent.payload)).toEqual({
        data: [current, expectedAvailable[0]],
        total: 3,
        page: 1,
        pageSize: 2,
      });

      const secondPageWithCurrent = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(marker)}&page=2&pageSize=2&currentExpertId=${currentExpert.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(secondPageWithCurrent.payload)).toEqual({
        data: [expectedAvailable[1]],
        total: 3,
        page: 2,
        pageSize: 2,
      });

      for (const noMatch of [`missing-${marker}`, "%"]) {
        const empty = await app.inject({
          method: "GET",
          url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(noMatch)}`,
          headers: { ...device, ...adminHeaders(adminSid) },
        });
        expect(empty.statusCode).toBe(200);
        expect(JSON.parse(empty.payload)).toMatchObject({ data: [], total: 0 });
      }

      const phoneOnly = await phoneOnlySelectorUser();
      const byPhone = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(phoneOnly.identifier)}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(byPhone.statusCode).toBe(200);
      expect(JSON.parse(byPhone.payload)).toEqual({
        data: [phoneOnly],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it("EARS-19: when more than one page is eligible, currentExpertId shall pin the current User first and preserve stable ordering for every other option", async () => {
      const marker = `Pinned-${randomUUID().slice(0, 8)}`;
      const current = await selectorUser(`Z ${marker}`);
      const currentExpert = await created(
        await createJson({ payload: validPayload({ userId: current.id }) }),
      );
      const candidates = await Promise.all(
        Array.from({ length: 26 }, (_, index) =>
          selectorUser(`A ${String(index).padStart(2, "0")} ${marker}`),
        ),
      );
      const orderedCandidates = candidates.sort((a, b) =>
        a.displayName.localeCompare(b.displayName) ||
        a.identifier.localeCompare(b.identifier) ||
        a.id.localeCompare(b.id),
      );

      const firstPage = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(marker)}&page=1&pageSize=25&currentExpertId=${currentExpert.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(firstPage.statusCode, firstPage.payload).toBe(200);
      expect(JSON.parse(firstPage.payload)).toEqual({
        data: [current, ...orderedCandidates.slice(0, 24)],
        total: 27,
        page: 1,
        pageSize: 25,
      });

      const secondPage = await app.inject({
        method: "GET",
        url: `/v1/admin/experts/eligible-users?q=${encodeURIComponent(marker)}&page=2&pageSize=25&currentExpertId=${currentExpert.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(JSON.parse(secondPage.payload)).toEqual({
        data: orderedCandidates.slice(24),
        total: 27,
        page: 2,
        pageSize: 25,
      });
    });

    it("012 EARS-19: when two Expert links race for one eligible User, the system shall commit one owner and reject the other with USER_EXPERT_CONFLICT", async () => {
      const userId = await unlinkedUserId();
      const candidates = await Promise.all([
        created(await createJson({ payload: validPayload() })),
        created(await createJson({ payload: validPayload() })),
      ]);

      const attempts = await Promise.all(
        candidates.map((candidate) =>
          app.inject({
            method: "PATCH",
            url: `/v1/admin/experts/${candidate.id}`,
            headers: {
              ...device,
              ...adminHeaders(adminSid),
              "content-type": "application/json",
              "idempotency-key": key(),
              "if-match": 'W/"1"',
            },
            payload: { userId },
          }),
        ),
      );
      expect(attempts.map((res) => res.statusCode).sort()).toEqual([200, 409]);
      const conflict = attempts.find((res) => res.statusCode === 409)!;
      expect(problem(conflict).errorCode).toBe("USER_EXPERT_CONFLICT");
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM experts WHERE user_id = $1",
        [userId],
      );
      expect(rows[0]!.n).toBe("1");
    });

    it("012 EARS-2: when an expert has no photo, the system shall answer deterministic initials derived from the name", async () => {
      const withoutPhoto = await created(
        await createJson({
          payload: validPayload({
            familyName: `Иванова-${randomUUID().slice(0, 8)}`,
            givenName: "Мария",
            patronymic: null,
          }),
        }),
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
        slug: body.slug,
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
          payload: validPayload({ familyName: `Петров-${marker}` }),
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
        payload: validPayload({ familyName: "Совсем-другой-эксперт" }),
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

    it("EARS-20: when create input carries a slug, the system shall reject the client-owned identity", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const clash = await createJson({
        payload: validPayload({ slug: body.slug }),
      });
      expect(clash.statusCode).toBe(400);
      expect(problem(clash).errorCode).toBe("VALIDATION_FAILED");
    });

    it("EARS-20: when PATCH input carries a slug, the system shall reject it and change nothing", async () => {
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
        payload: { slug: "sovsem-drugoy-adres" },
      });
      expect(res.statusCode).toBe(400);
      expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      const { rows } = await pool.query<{ slug: string; version: number }>(
        "SELECT slug, version FROM experts WHERE id = $1",
        [body.id],
      );
      expect(rows[0]).toMatchObject({ slug: body.slug, version: 1 });
    });

    it("EARS-20: same-name, retained and concurrent Expert collisions shall allocate distinct stable slugs", async () => {
      const marker = randomUUID().slice(0, 8);
      const names = {
        familyName: `Stable-${marker}`,
        givenName: "Expert",
        patronymic: null,
      };
      const first = await created(
        await createJson({ payload: validPayload(names) }),
      );
      await pool.query(
        "UPDATE experts SET status = 'retired', deleted_at = now() WHERE id = $1",
        [first.id],
      );
      const second = await created(
        await createJson({ payload: validPayload(names) }),
      );
      expect(second.slug).toBe(`stable-${marker}-expert-2`);

      const concurrentNames = {
        familyName: `Concurrent-${marker}`,
        givenName: "Expert",
        patronymic: null,
      };
      const responses = await Promise.all([
        createJson({ payload: validPayload(concurrentNames) }),
        createJson({ payload: validPayload(concurrentNames) }),
      ]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([
        201, 201,
      ]);
      const bodies = responses.map(
        (response) => JSON.parse(response.payload) as { slug: string },
      );
      expect(bodies.map(({ slug }) => slug).sort()).toEqual(
        [`concurrent-${marker}-expert`, `concurrent-${marker}-expert-2`].sort(),
      );
    });

    it("EARS-20: an Expert name with no transliterable base shall receive a system fallback", async () => {
      const body = await created(
        await createJson({
          payload: validPayload({
            familyName: "🫀",
            givenName: "🧠",
            patronymic: null,
          }),
        }),
      );
      expect(body.slug).toMatch(/^expert(?:-\d+)?$/);
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
                family_name = NULL, given_name = NULL, patronymic = NULL,
                photo_ref = NULL, professional_role = NULL,
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
        payload: { familyName: "Возвращённая" },
      });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("CONTENT_REMOVED");
      const { rows } = await pool.query<{ family_name: string | null }>(
        "SELECT family_name FROM experts WHERE id = $1",
        [body.id],
      );
      expect(rows[0]!.family_name).toBeNull();
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

    // ── 012 EARS-5: publish completeness (#1287) ──
    //
    // Publishing an expert is the moment their event links become PUBLICLY
    // visible. Since the EARS-24 cutover (#1607) publication can no longer
    // CREATE a slot collision: links are the only speaker source and
    // `event_experts_event_position_active_uniq` already forbids two active
    // links on one position whatever anybody's publication state, so the
    // refusal happens at the link write, not at the publish.

    async function insertEvent(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
           VALUES ($1, $2, $3, now(), 60) RETURNING id`,
        [`e-1287-${randomUUID()}`, "Эфир 1287", "Школа 1287"],
      );
      createdEventIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function linkExpertToEvent(
      eventId: string,
      expertId: string,
      position: number,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO event_experts (event_id, expert_id, role, position)
           VALUES ($1, $2, 'Докладчик', $3)`,
        [eventId, expertId, position],
      );
    }

    async function publishExpert(
      id: string,
      version: number,
      overrides: { ifMatch?: string | null; idempotencyKey?: string | null } = {},
    ) {
      const ifMatch =
        overrides.ifMatch === undefined ? `W/"${version}"` : overrides.ifMatch;
      const idempotencyKey =
        overrides.idempotencyKey === undefined
          ? key()
          : overrides.idempotencyKey;
      return app.inject({
        method: "POST",
        url: `/v1/admin/experts/${id}/publish`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          ...(ifMatch === null ? {} : { "if-match": ifMatch }),
          ...(idempotencyKey === null
            ? {}
            : { "idempotency-key": idempotencyKey }),
        },
      });
    }

    async function expertRow(id: string) {
      const { rows } = await pool.query<{
        status: string;
        version: number;
        first_published_at: Date | null;
      }>(
        "SELECT status, version, first_published_at FROM experts WHERE id = $1",
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

    it("012 EARS-5.1: when a complete draft expert is published, the system shall stamp first_published_at, bump the ETag and write the audit row in the same transaction", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const auditBefore = await auditRowCount(body.id);

      const res = await publishExpert(body.id, 1);
      expect(res.statusCode).toBe(200);
      const published = JSON.parse(res.payload) as {
        status: string;
        version: number;
        firstPublishedAt: string | null;
      };
      expect(published).toMatchObject({ status: "published", version: 2 });
      expect(published.firstPublishedAt).toBeTypeOf("string");
      expect(res.headers.etag).toBe('W/"2"');
      expect((await expertRow(body.id)).first_published_at).toEqual(
        new Date(published.firstPublishedAt!),
      );
      expect(await auditRowCount(body.id)).toBeGreaterThan(auditBefore);
    });

    it("012 EARS-5.4: when an incomplete expert is published, the system shall name EVERY missing field in one field-addressed refusal", async () => {
      const body = await created(
        await createJson({
          payload: validPayload({
            professionalRole: null,
            credentials: null,
            affiliation: null,
            bio: null,
          }),
        }),
      );
      const res = await publishExpert(body.id, 1);
      expect(res.statusCode).toBe(409);
      const detail = problem(res);
      expect(detail.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      // All four at once, not one per round trip: an operator fixing a form
      // should not have to discover the requirements by repeated refusal.
      expect(detail.errors?.map((e) => e.path).sort()).toEqual([
        "affiliation",
        "bio",
        "credentials",
        "professionalRole",
      ]);
      expect(await expertRow(body.id)).toMatchObject({
        status: "draft",
        version: 1,
      });
    });

    it("012 EARS-5.12: when an already-published expert is published again, the system shall answer 409 INVALID_TRANSITION and keep the original first_published_at", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      expect((await publishExpert(body.id, 1)).statusCode).toBe(200);
      const stamped = (await expertRow(body.id)).first_published_at;

      const again = await publishExpert(body.id, 2);
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");
      const after = await expertRow(body.id);
      expect(after).toMatchObject({ status: "published", version: 2 });
      expect(after.first_published_at).toEqual(stamped);
    });

    it("012 EARS-5.10: when the expert record was editorially removed, the system shall refuse with CONTENT_REMOVED rather than a lifecycle mismatch", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      // The §2.4 removed shape, exactly as `experts_content_removed_shape`
      // pins it — retired, deleted, every descriptive value NULL.
      await pool.query(
        `UPDATE experts SET status = 'retired', deleted_at = now(),
            content_removed_at = now(), family_name = NULL, given_name = NULL,
            patronymic = NULL, photo_ref = NULL, professional_role = NULL,
            credentials = NULL, affiliation = NULL, bio = NULL
          WHERE id = $1`,
        [body.id],
      );
      const res = await publishExpert(body.id, 1);
      expect(res.statusCode).toBe(409);
      // "Removed" is the stronger statement: reporting INVALID_TRANSITION would
      // invite an operator to restore and republish a person who asked to be
      // taken off the site.
      expect(problem(res).errorCode).toBe("CONTENT_REMOVED");
      expect(await expertRow(body.id)).toMatchObject({
        status: "retired",
        version: 1,
      });
    });

    it("012 EARS-5.9: when the expert holds an event slot no other ACTIVE link claims, publishing shall succeed — links are the only speaker source since the cutover", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const eventId = await insertEvent();
      await linkExpertToEvent(eventId, body.id, 3);

      const res = await publishExpert(body.id, 1);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({ status: "published" });
    });

    it("012 EARS-5.13: when the publish carries no If-Match, a stale If-Match or no Idempotency-Key, the system shall answer 428/412/428 and change nothing", async () => {
      const body = await created(await createJson({ payload: validPayload() }));

      const absent = await publishExpert(body.id, 1, { ifMatch: null });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await publishExpert(body.id, 1, { ifMatch: 'W/"99"' });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");

      const noKey = await publishExpert(body.id, 1, { idempotencyKey: null });
      expect(noKey.statusCode).toBe(428);

      expect(await expertRow(body.id)).toMatchObject({
        status: "draft",
        version: 1,
      });
    });

    it("012 EARS-5.14: when a non-public expert is addressed on the public surface, the system shall answer exactly as it does for an unknown one", async () => {
      const body = await created(await createJson({ payload: validPayload() }));
      const draft = await app.inject({
        method: "GET",
        url: `/v1/public/experts/${body.slug}/projects`,
        headers: device,
      });
      const unknown = await app.inject({
        method: "GET",
        url: `/v1/public/experts/${randomUUID()}/projects`,
        headers: device,
      });
      expect(draft.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
      expect(problem(draft).errorCode).toBe(problem(unknown).errorCode);

      expect((await publishExpert(body.id, 1)).statusCode).toBe(200);
      const visible = await app.inject({
        method: "GET",
        url: `/v1/public/experts/${body.slug}/projects`,
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
