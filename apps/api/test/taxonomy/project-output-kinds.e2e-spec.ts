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
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

// 030 EARS-3 / EARS-18 (#3503, V-3, V-7) — the «Виды результатов» reference
// book over the REAL stack: list with result counts, add, rename, retire
// refused with 409 OUTPUT_KIND_IN_USE while a draft or published project's
// result holds the kind, restore under the same id, and the platform_admin +
// second factor + CSRF + idempotency + If-Match + 010 audit floor of every
// route. Mirrors `organisation-roles.e2e-spec.ts` (032, #3492).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "030 EARS-3 output-kind reference book (e2e)",
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
    const createdKindIds: string[] = [];
    const createdProjectIds: string[] = [];
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
        nextEmail: () => uniqueEmail("outkind-admin"),
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
      const email = uniqueEmail("outkind-doctor");
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

    function writeHeaders(extra: Record<string, string> = {}) {
      return {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
        "idempotency-key": key(),
        ...extra,
      };
    }

    async function createKind(
      title: string,
      headers: Record<string, string> = {},
    ) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/project-output-kinds",
        headers: writeHeaders(headers),
        payload: { title },
      });
      if (res.statusCode === 201) {
        createdKindIds.push((JSON.parse(res.payload) as { id: string }).id);
      }
      return res;
    }

    async function newKind(): Promise<{ id: string; slug: string }> {
      const res = await createKind(`Вид ${tag()}`);
      expect(res.statusCode, res.payload).toBe(201);
      return JSON.parse(res.payload) as { id: string; slug: string };
    }

    async function renameKind(id: string, version: number, title: string) {
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/project-output-kinds/${id}`,
        headers: writeHeaders({ "if-match": `W/"${version}"` }),
        payload: { title },
      });
    }

    async function transition(
      id: string,
      verb: "retire" | "restore",
      version: number,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/project-output-kinds/${id}/${verb}`,
        headers: writeHeaders({ "if-match": `W/"${version}"` }),
        payload: {},
      });
    }

    async function listKinds(query = "") {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/project-output-kinds${query}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(res.statusCode, res.payload).toBe(200);
      return JSON.parse(res.payload) as {
        data: {
          id: string;
          slug: string;
          title: string;
          status: string;
          resultCount: number;
          version: number;
        }[];
        total: number;
      };
    }

    function problem(res: { payload: string }): {
      errorCode: string;
      errors?: { path: string; message: string }[];
    } {
      return JSON.parse(res.payload) as {
        errorCode: string;
        errors?: { path: string; message: string }[];
      };
    }

    async function kindCount(): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM project_output_kinds",
      );
      return Number(rows[0]!.n);
    }

    /** A project in `status` holding one result of `kindId`, written as SQL. */
    async function projectHolding(
      kindId: string,
      status: "draft" | "published" | "retired",
    ): Promise<{ id: string; title: string }> {
      const title = `Проект ${status} ${tag()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO projects (slug, stage, title, description, default_audience, status, first_published_at, deleted_at)
         VALUES ($1, 'running', $2, 'Описание', 'doctors', $3, $4, $5) RETURNING id`,
        [
          `e2e-outkind-${tag()}`,
          title,
          status,
          status === "draft" ? null : new Date(),
          status === "retired" ? new Date() : null,
        ],
      );
      const id = rows[0]!.id;
      createdProjectIds.push(id);
      await pool.query(
        `INSERT INTO project_results (project_id, output_kind_id, position, title) VALUES ($1, $2, 0, 'Итог')`,
        [id, kindId],
      );
      return { id, title };
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
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      adminSid = await adminSession();
    });

    afterEach(async () => {
      for (const id of createdProjectIds.splice(0)) {
        await pool.query("DELETE FROM project_results WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const id of createdKindIds.splice(0)) {
        await pool.query(
          "DELETE FROM project_results WHERE output_kind_id = $1",
          [id],
        );
        await pool.query("DELETE FROM project_output_kinds WHERE id = $1", [
          id,
        ]);
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

    it("030 EARS-3: the book lists the six seed kinds as ordinary active rows", async () => {
      const { data } = await listKinds();
      const seeds = data.filter((k) =>
        ["shkola", "kurs", "podkast", "sobytie", "kongress", "klub"].includes(
          k.slug,
        ),
      );
      expect(seeds.map((k) => [k.title, k.status]).sort()).toEqual(
        [
          ["Школа", "active"],
          ["Курс", "active"],
          ["Подкаст", "active"],
          ["Событие", "active"],
          ["Конгресс", "active"],
          ["Клуб", "active"],
        ].sort(),
      );
    });

    it("030 EARS-3: when a platform_admin adds a kind, the system shall persist one row with a system slug and version 1, offered at once by the active list", async () => {
      const title = `Вебинар ${tag()}`;
      const res = await createKind(`  ${title}  `);
      expect(res.statusCode, res.payload).toBe(201);
      const body = JSON.parse(res.payload) as { id: string; slug: string };
      expect(body).toMatchObject({
        title,
        status: "active",
        version: 1,
        resultCount: 0,
      });
      expect(body.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(
        `/v1/admin/project-output-kinds/${body.id}`,
      );
      const active = await listKinds("?status=active");
      expect(active.data.map((k) => k.id)).toContain(body.id);
    });

    it("030 EARS-3: the list shall count every result holding each kind", async () => {
      const kind = await newKind();
      for (const status of ["draft", "published", "retired"] as const) {
        await projectHolding(kind.id, status);
      }
      const listed = (await listKinds()).data.find((k) => k.id === kind.id);
      expect(listed?.resultCount).toBe(3);
    });

    it("030 EARS-3: when a kind is renamed with a matching If-Match, the system shall keep its id and slug and bump its version; a stale If-Match is 412", async () => {
      const kind = await newKind();
      const title = `Новый вид ${tag()}`;
      const res = await renameKind(kind.id, 1, title);
      expect(res.statusCode, res.payload).toBe(200);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: kind.id,
        slug: kind.slug,
        title,
        version: 2,
      });
      const stale = await renameKind(kind.id, 1, `Ещё ${tag()}`);
      expect(stale.statusCode).toBe(412);
    });

    it("030 EARS-3: when a title duplicates an active kind case-insensitively, the system shall refuse it with a title field error and change nothing", async () => {
      const before = await kindCount();
      const dup = await createKind("  курс ");
      expect(dup.statusCode).toBe(400);
      expect(problem(dup).errorCode).toBe("VALIDATION_FAILED");
      expect(problem(dup).errors?.map((e) => e.path)).toContain("title");
      expect(await kindCount()).toBe(before);
      const mine = await newKind();
      const rename = await renameKind(mine.id, 1, "ПОДКАСТ");
      expect(rename.statusCode).toBe(400);
      expect(problem(rename).errors?.map((e) => e.path)).toContain("title");
    });

    it("030 EARS-3: when a kind held by a draft or published project's result is retired, the system shall refuse with 409 OUTPUT_KIND_IN_USE listing those projects and change nothing", async () => {
      const kind = await newKind();
      const draft = await projectHolding(kind.id, "draft");
      const published = await projectHolding(kind.id, "published");
      const retired = await projectHolding(kind.id, "retired");
      const res = await transition(kind.id, "retire", 1);
      expect(res.statusCode, res.payload).toBe(409);
      const body = problem(res);
      expect(body.errorCode).toBe("OUTPUT_KIND_IN_USE");
      expect(body.errors?.map((e) => e.path).sort()).toEqual(
        [`projects.${draft.id}`, `projects.${published.id}`].sort(),
      );
      expect(body.errors?.map((e) => e.path)).not.toContain(
        `projects.${retired.id}`,
      );
      const { rows } = await pool.query<{ status: string; version: number }>(
        "SELECT status::text AS status, version FROM project_output_kinds WHERE id = $1",
        [kind.id],
      );
      expect(rows[0]).toEqual({ status: "active", version: 1 });
    });

    it("030 EARS-3: when an unheld kind is retired and then restored, the system shall leave the active list and return to it under the same id", async () => {
      const kind = await newKind();
      // A retired project's result does not hold the kind against retirement.
      await projectHolding(kind.id, "retired");
      const retire = await transition(kind.id, "retire", 1);
      expect(retire.statusCode, retire.payload).toBe(200);
      expect(JSON.parse(retire.payload)).toMatchObject({
        id: kind.id,
        status: "retired",
        version: 2,
      });
      const active = await listKinds("?status=active");
      expect(active.data.map((k) => k.id)).not.toContain(kind.id);
      const restore = await transition(kind.id, "restore", 2);
      expect(restore.statusCode, restore.payload).toBe(200);
      expect(JSON.parse(restore.payload)).toMatchObject({
        id: kind.id,
        slug: kind.slug,
        status: "active",
        version: 3,
      });
    });

    it("030 EARS-18: a caller without the admin session is refused on every output-kind route and nothing is written", async () => {
      const before = await kindCount();
      const cookie = await doctorCookie();
      const someId = randomUUID();
      for (const [method, url] of [
        ["GET", "/v1/admin/project-output-kinds"],
        ["POST", "/v1/admin/project-output-kinds"],
        ["PATCH", `/v1/admin/project-output-kinds/${someId}`],
        ["POST", `/v1/admin/project-output-kinds/${someId}/retire`],
        ["POST", `/v1/admin/project-output-kinds/${someId}/restore`],
      ] as const) {
        const payload = method === "GET" ? undefined : { title: "Т" };
        const anon = await app.inject({
          method,
          url,
          headers: { ...device, "content-type": "application/json" },
          payload,
        });
        expect(anon.statusCode, `${method} ${url}`).toBe(401);
        const doctor = await app.inject({
          method,
          url,
          headers: { ...device, "content-type": "application/json" },
          cookies: { [SESSION_COOKIE_NAME]: cookie },
          payload,
        });
        expect([401, 403], `${method} ${url}`).toContain(doctor.statusCode);
      }
      expect(await kindCount()).toBe(before);
    });

    it("030 EARS-18: a write without a canonical Idempotency-Key, or a rename or retire without If-Match, is refused", async () => {
      const before = await kindCount();
      const noKey = await app.inject({
        method: "POST",
        url: "/v1/admin/project-output-kinds",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
        },
        payload: { title: `Т ${tag()}` },
      });
      expect(noKey.statusCode).toBe(428);
      const badKey = await createKind(`Т ${tag()}`, {
        "idempotency-key": "nope",
      });
      expect(badKey.statusCode).toBe(400);
      expect(await kindCount()).toBe(before);

      const kind = await newKind();
      const noIfMatchRename = await app.inject({
        method: "PATCH",
        url: `/v1/admin/project-output-kinds/${kind.id}`,
        headers: writeHeaders(),
        payload: { title: `Т ${tag()}` },
      });
      expect(noIfMatchRename.statusCode).toBe(428);
      const noIfMatchRetire = await app.inject({
        method: "POST",
        url: `/v1/admin/project-output-kinds/${kind.id}/retire`,
        headers: writeHeaders(),
        payload: {},
      });
      expect(noIfMatchRetire.statusCode).toBe(428);
    });

    it("030 EARS-18: an exact retry replays the stored outcome instead of creating a second kind", async () => {
      const k = key();
      const title = `Повтор ${tag()}`;
      const first = await createKind(title, { "idempotency-key": k });
      const second = await createKind(title, { "idempotency-key": k });
      expect(second.statusCode).toBe(201);
      expect(JSON.parse(second.payload).id).toBe(JSON.parse(first.payload).id);
      const { rows } = await pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM project_output_kinds WHERE title = $1",
        [title],
      );
      expect(rows[0]!.n).toBe("1");
    });

    it("030 EARS-18: every kind change leaves one 010 audit row attributed to the acting administrator", async () => {
      const kind = await newKind();
      await renameKind(kind.id, 1, `Аудит ${tag()}`);
      await transition(kind.id, "retire", 2);
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE metadata->>'table' = 'project_output_kinds' AND metadata->'pk'->>'id' = $1
          ORDER BY created_at`,
        [kind.id],
      );
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.project_output_kinds.insert",
        "data.project_output_kinds.update",
        "data.project_output_kinds.update",
      ]);
      expect(rows.every((r) => r.subject_id !== null)).toBe(true);
    });
  },
);
