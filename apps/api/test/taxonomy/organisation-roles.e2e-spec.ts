import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

// 032 EARS-3 / EARS-13 (#3492) — the organisation-role reference book over the
// REAL stack: list with holder counts, «Добавить роль», rename, the
// case-insensitive active-title uniqueness, and the platform_admin + second
// factor + CSRF + idempotency + If-Match + 010 audit floor of every route.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "032 EARS-3 organisation-role reference book (e2e)",
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
    const createdRoleIds: string[] = [];
    const createdOrgIds: string[] = [];
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

    function tag(): string {
      return Math.random().toString(36).slice(2, 8);
    }

    async function adminSession(): Promise<string> {
      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("orgrole-admin"),
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

    async function doctorCookie(): Promise<string> {
      const email = uniqueEmail("orgrole-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      return signIn(app, email, password, { device });
    }

    async function createRole(
      title: string,
      headers: Record<string, string> = {},
    ) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/organisation-roles",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          ...headers,
        },
        payload: { title },
      });
      if (res.statusCode === 201) {
        createdRoleIds.push((JSON.parse(res.payload) as { id: string }).id);
      }
      return res;
    }

    async function renameRole(id: string, version: number, title: string) {
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/organisation-roles/${id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": `W/"${version}"`,
        },
        payload: { title },
      });
    }

    async function listRoles(query = "") {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/organisation-roles${query}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      return JSON.parse(res.payload) as {
        data: {
          id: string;
          slug: string;
          title: string;
          status: string;
          organisationCount: number;
        }[];
        total: number;
      };
    }

    function problem(res: { payload: string }): {
      errorCode: string;
      errors?: { path: string }[];
    } {
      return JSON.parse(res.payload) as {
        errorCode: string;
        errors?: { path: string }[];
      };
    }

    async function roleCount(): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM organisation_roles",
      );
      return Number(rows[0]!.n);
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
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await adminSession();
    });

    afterEach(async () => {
      for (const id of createdOrgIds.splice(0)) {
        await pool.query(
          "DELETE FROM organisation_role_assignments WHERE organisation_id = $1",
          [id],
        );
        await pool.query("DELETE FROM organisations WHERE id = $1", [id]);
      }
      for (const id of createdRoleIds.splice(0)) {
        await pool.query(
          "DELETE FROM organisation_role_assignments WHERE role_id = $1",
          [id],
        );
        await pool.query("DELETE FROM organisation_roles WHERE id = $1", [id]);
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

    it("032 EARS-3: the book lists the three seed roles as ordinary active rows, with no employer, sponsor or advertiser role", async () => {
      const { data } = await listRoles();
      const seeds = data.filter((r) =>
        ["investor", "clinical-base", "educational-licensee"].includes(r.slug),
      );
      expect(seeds.map((r) => [r.slug, r.title, r.status]).sort()).toEqual(
        [
          ["clinical-base", "Клиническая площадка", "active"],
          ["educational-licensee", "Образовательный лицензиат", "active"],
          ["investor", "Инвестор", "active"],
        ].sort(),
      );
      const titles = data.map((r) => r.title);
      for (const banned of ["Работодатель", "Спонсор", "Рекламодатель"]) {
        expect(titles).not.toContain(banned);
      }
    });

    it("032 EARS-3: when a platform_admin adds a role, the system shall persist one row with a system slug and version 1, and every organisation form read shall offer it at once", async () => {
      const title = `Партнёр по данным ${tag()}`;
      const res = await createRole(`  ${title}  `);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload) as {
        id: string;
        slug: string;
        version: number;
        status: string;
        organisationCount: number;
      };
      expect(body).toMatchObject({
        title,
        status: "active",
        version: 1,
        organisationCount: 0,
      });
      expect(body.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(
        `/v1/admin/organisation-roles/${body.id}`,
      );
      const active = await listRoles("?status=active");
      expect(active.data.map((r) => r.id)).toContain(body.id);
    });

    it("032 EARS-3: the list shall count every organisation holding each role, a retired (withdrawn) holder included", async () => {
      const role = JSON.parse(
        (await createRole(`Счётная ${tag()}`)).payload,
      ) as {
        id: string;
      };
      for (const status of ["draft", "published", "retired"] as const) {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO organisations (slug, title, status, first_published_at, deleted_at)
           VALUES ($1, 'Орг', $2, $3, $4) RETURNING id`,
          [
            `e2e-orgrole-${tag()}`,
            status,
            status === "draft" ? null : new Date(),
            status === "retired" ? new Date() : null,
          ],
        );
        createdOrgIds.push(rows[0]!.id);
        await pool.query(
          "INSERT INTO organisation_role_assignments (organisation_id, role_id) VALUES ($1, $2)",
          [rows[0]!.id, role.id],
        );
      }
      const listed = (await listRoles()).data.find((r) => r.id === role.id);
      expect(listed?.organisationCount).toBe(3);
    });

    it("032 EARS-3: when a role is renamed with a matching If-Match, the system shall keep its id and slug and bump its version", async () => {
      const created = JSON.parse(
        (await createRole(`Старое ${tag()}`)).payload,
      ) as {
        id: string;
        slug: string;
      };
      const title = `Новое ${tag()}`;
      const res = await renameRole(created.id, 1, title);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: created.id,
        slug: created.slug,
        title,
        version: 2,
      });
      const stale = await renameRole(created.id, 1, `Ещё ${tag()}`);
      expect(stale.statusCode).toBe(412);
    });

    it("032 EARS-3: when a title duplicates an active role case-insensitively, the system shall refuse it with a title field error and change nothing", async () => {
      const before = await roleCount();
      const dup = await createRole("  инвестор ");
      expect(dup.statusCode).toBe(400);
      expect(problem(dup).errorCode).toBe("VALIDATION_FAILED");
      expect(problem(dup).errors?.map((e) => e.path)).toContain("title");
      expect(await roleCount()).toBe(before);

      const mine = JSON.parse(
        (await createRole(`Уникальная ${tag()}`)).payload,
      ) as {
        id: string;
      };
      const rename = await renameRole(mine.id, 1, "КЛИНИЧЕСКАЯ ПЛОЩАДКА");
      expect(rename.statusCode).toBe(400);
      expect(problem(rename).errors?.map((e) => e.path)).toContain("title");
    });

    it("032 EARS-3: a retired role's title does not block a new active role", async () => {
      const t = `Снятая ${tag()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO organisation_roles (slug, title, status, deleted_at)
         VALUES ($1, $2, 'retired', now()) RETURNING id`,
        [`e2e-retired-${tag()}`, t],
      );
      createdRoleIds.push(rows[0]!.id);
      const res = await createRole(t);
      expect(res.statusCode).toBe(201);
      const active = await listRoles("?status=active");
      expect(active.data.map((r) => r.id)).not.toContain(rows[0]!.id);
    });

    it("032 EARS-3: a title outside 1–80 or an authored slug is refused", async () => {
      const before = await roleCount();
      expect((await createRole("")).statusCode).toBe(400);
      expect((await createRole("р".repeat(81))).statusCode).toBe(400);
      const slugged = await app.inject({
        method: "POST",
        url: "/v1/admin/organisation-roles",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { title: `Т ${tag()}`, slug: "x" },
      });
      expect(slugged.statusCode).toBe(400);
      expect(await roleCount()).toBe(before);
    });

    it("032 EARS-13: a caller without the admin session is refused on every role route and nothing is written", async () => {
      const before = await roleCount();
      const cookie = await doctorCookie();
      const someId = randomUUID();
      for (const [method, url] of [
        ["GET", "/v1/admin/organisation-roles"],
        ["POST", "/v1/admin/organisation-roles"],
        ["PATCH", `/v1/admin/organisation-roles/${someId}`],
      ] as const) {
        const anon = await app.inject({
          method,
          url,
          headers: { ...device, "content-type": "application/json" },
          payload: method === "GET" ? undefined : { title: "Т" },
        });
        expect(anon.statusCode, `${method} ${url}`).toBe(401);
        const doctor = await app.inject({
          method,
          url,
          headers: { ...device, "content-type": "application/json" },
          cookies: { [SESSION_COOKIE_NAME]: cookie },
          payload: method === "GET" ? undefined : { title: "Т" },
        });
        expect([401, 403], `${method} ${url}`).toContain(doctor.statusCode);
      }
      expect(await roleCount()).toBe(before);
    });

    it("032 EARS-13: a write without a canonical Idempotency-Key, or a rename without If-Match, is refused", async () => {
      const before = await roleCount();
      const noKey = await app.inject({
        method: "POST",
        url: "/v1/admin/organisation-roles",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
        },
        payload: { title: `Т ${tag()}` },
      });
      expect(noKey.statusCode).toBe(428);
      const badKey = await createRole(`Т ${tag()}`, {
        "idempotency-key": "nope",
      });
      expect(badKey.statusCode).toBe(400);
      expect(await roleCount()).toBe(before);

      const role = JSON.parse((await createRole(`Т ${tag()}`)).payload) as {
        id: string;
      };
      const noIfMatch = await app.inject({
        method: "PATCH",
        url: `/v1/admin/organisation-roles/${role.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { title: `Т ${tag()}` },
      });
      expect(noIfMatch.statusCode).toBe(428);
    });

    it("032 EARS-13: an exact retry replays the stored outcome instead of creating a second role", async () => {
      const k = key();
      const title = `Повтор ${tag()}`;
      const first = await createRole(title, { "idempotency-key": k });
      const second = await createRole(title, { "idempotency-key": k });
      expect(second.statusCode).toBe(201);
      expect(JSON.parse(second.payload).id).toBe(JSON.parse(first.payload).id);
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM organisation_roles WHERE title = $1",
        [title],
      );
      expect(rows[0]!.n).toBe("1");
    });

    it("032 EARS-13: every role change leaves a 010 audit row attributed to the acting administrator", async () => {
      const role = JSON.parse((await createRole(`Аудит ${tag()}`)).payload) as {
        id: string;
      };
      await renameRole(role.id, 1, `Аудит ${tag()}`);
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->>'table' = 'organisation_roles' AND metadata->'pk'->>'id' = $1
          ORDER BY event_type`,
        [role.id],
      );
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.organisation_roles.insert",
        "data.organisation_roles.update",
      ]);
      expect(rows.every((r) => r.subject_id !== null)).toBe(true);
    });
  },
);
