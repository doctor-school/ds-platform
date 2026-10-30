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
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

// 048 (#3512) — the «Материалы» admin API over the REAL stack (Fastify + the
// 011 admin session + Postgres): V-2 (create / edit, EARS-1, EARS-2, EARS-19),
// V-3 (publish / edit / unpublish and the feed entry, EARS-4…EARS-6), EARS-7
// (the admin list) and V-5 (authz, idempotency, If-Match, 010 audit, EARS-8).
// Mirrors the 032 organisation suite. Skips when the stand is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "048 materials admin API (e2e)",
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
    const materialIds: string[] = [];
    const expertIds: string[] = [];
    const organisationIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;
    let adminSub: string;

    const text = (s: string) => ({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: s }] }],
    });
    const emptyBody = { type: "doc", content: [{ type: "paragraph" }] };

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

    const marker = () => Math.random().toString(36).slice(2, 8);

    async function adminSession(): Promise<{ sid: string; sub: string }> {
      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("mat-admin"),
        password,
        consent,
      });
      await fake.grantProjectRole(sub, "platform_admin");
      const { sid } = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return { sid, sub };
    }

    async function expert(
      status: "draft" | "published" | "retired",
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (slug, family_name, given_name, patronymic, status, first_published_at, deleted_at)
         VALUES ($1, 'Страхов', 'Михаил', 'Андреевич', $2::taxonomy_status,
                 CASE WHEN $2::text = 'draft' THEN NULL ELSE now() END,
                 CASE WHEN $2::text = 'retired' THEN now() ELSE NULL END)
         RETURNING id`,
        [`mat-expert-${marker()}`, status],
      );
      expertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function organisation(
      status: "draft" | "published" | "retired",
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO organisations (slug, title, status, first_published_at, deleted_at)
         VALUES ($1, $2, $3::taxonomy_status,
                 CASE WHEN $3::text = 'draft' THEN NULL ELSE now() END,
                 CASE WHEN $3::text = 'retired' THEN now() ELSE NULL END)
         RETURNING id`,
        [`mat-org-${marker()}`, `Партнёр ${marker()}`, status],
      );
      organisationIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    interface Call {
      payload?: Record<string, unknown>;
      sid?: string;
      ifMatch?: string | null;
      idempotencyKey?: string | null;
    }

    function call(method: "POST" | "PATCH" | "GET", url: string, c: Call = {}) {
      const idem = c.idempotencyKey === undefined ? key() : c.idempotencyKey;
      return app.inject({
        method,
        url,
        headers: {
          ...device,
          ...adminHeaders(c.sid ?? adminSid),
          ...(c.payload ? { "content-type": "application/json" } : {}),
          ...(method !== "GET" && idem !== null
            ? { "idempotency-key": idem }
            : {}),
          ...(c.ifMatch ? { "if-match": c.ifMatch } : {}),
        },
        ...(c.payload ? { payload: c.payload } : {}),
      });
    }

    type Detail = {
      id: string;
      slug: string;
      kind: string;
      title: string;
      authorLine: string;
      status: string;
      version: number;
      firstPublishedAt: string | null;
      expert: { id: string } | null;
      partner: { id: string } | null;
    };
    const json = (res: { payload: string }) => JSON.parse(res.payload);

    async function create(payload: Record<string, unknown>): Promise<Detail> {
      const res = await call("POST", "/v1/admin/materials", { payload });
      expect(res.statusCode, res.payload).toBe(201);
      const body = json(res) as Detail;
      materialIds.push(body.id);
      return body;
    }

    const news = (overrides: Record<string, unknown> = {}) => ({
      kind: "news",
      title: `Новость ${marker()}`,
      body: text("Текст новости"),
      ...overrides,
    });

    const patch = (
      m: { id: string; version: number },
      payload: Record<string, unknown>,
      c: Call = {},
    ) =>
      call("PATCH", `/v1/admin/materials/${m.id}`, {
        payload,
        ifMatch: `W/"${m.version}"`,
        ...c,
      });
    const publish = (m: { id: string; version: number }, c: Call = {}) =>
      call("POST", `/v1/admin/materials/${m.id}/publish`, {
        ifMatch: `W/"${m.version}"`,
        ...c,
      });
    const unpublish = (m: { id: string; version: number }, c: Call = {}) =>
      call("POST", `/v1/admin/materials/${m.id}/unpublish`, {
        ifMatch: `W/"${m.version}"`,
        ...c,
      });

    async function row(id: string) {
      const { rows } = await pool.query<{
        title: string;
        status: string;
        version: number;
        author_line: string;
        expert_id: string | null;
        partner_organisation_id: string | null;
        first_published_at: Date | null;
      }>("SELECT * FROM materials WHERE id = $1", [id]);
      return rows[0];
    }

    async function entries(id: string) {
      const { rows } = await pool.query<{
        kind: string;
        title: string;
        source_name: string | null;
        author_expert_id: string | null;
        partner_organisation_id: string | null;
        href: string;
        published_at: Date;
      }>(
        "SELECT * FROM feed_entries WHERE source_platform = 'academy' AND source_ref = $1",
        [id],
      );
      return rows;
    }

    async function materialAudit(id: string) {
      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
          WHERE event_type LIKE 'data.materials.%' AND metadata->'pk'->>'id' = $1`,
        [id],
      );
      return rows;
    }

    const problem = (res: { payload: string }) =>
      json(res) as {
        errorCode: string;
        errors?: { path: string; message: string }[];
      };
    const fieldPaths = (res: { payload: string }) =>
      (problem(res).errors ?? []).map((e) => e.path);

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
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      ({ sid: adminSid, sub: adminSub } = await adminSession());
    });

    afterEach(async () => {
      for (const id of materialIds.splice(0)) {
        await pool.query("DELETE FROM feed_entries WHERE material_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM materials WHERE id = $1", [id]);
      }
      for (const id of expertIds.splice(0)) {
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
      for (const id of organisationIds.splice(0)) {
        await pool.query("DELETE FROM organisations WHERE id = $1", [id]);
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

    // ── V-2: create / edit (EARS-1, EARS-2, EARS-19) ─────────────────────

    it("048 EARS-1: when a platform administrator creates a news item, the system shall persist a draft with its author line, a slug from the title and an ETag", async () => {
      const res = await call("POST", "/v1/admin/materials", {
        payload: news({ title: "Грипп  сезон 2026", authorLine: " Редакция " }),
      });
      expect(res.statusCode, res.payload).toBe(201);
      const body = json(res) as Detail;
      materialIds.push(body.id);
      expect(body).toMatchObject({
        kind: "news",
        title: "Грипп  сезон 2026",
        authorLine: "Редакция",
        status: "draft",
        version: 1,
        firstPublishedAt: null,
        expert: null,
        partner: null,
      });
      expect(body.slug).toMatch(/^gripp/);
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`/v1/admin/materials/${body.id}`);
      expect(await entries(body.id)).toHaveLength(0);

      const detail = await call("GET", `/v1/admin/materials/${body.id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.headers.etag).toBe('W/"1"');
      expect(json(detail)).toMatchObject({
        id: body.id,
        body: text("Текст новости"),
      });
    });

    it("048 EARS-1: when a column is created with a non-retired expert, the system shall store the expert and an empty author line", async () => {
      const expertId = await expert("draft");
      const body = await create({
        kind: "column",
        title: `Колонка ${marker()}`,
        expertId,
        authorLine: "Игнорируется",
        body: text("Мнение"),
      });
      expect(body.expert).toMatchObject({ id: expertId });
      expect(body.authorLine).toBe("");
      expect((await row(body.id))!.author_line).toBe("");
    });

    it("048 EARS-1: when a column names no expert, a retired one or an unknown one, the system shall refuse on `expertId` and store nothing", async () => {
      const retired = await expert("retired");
      const { rows: before } = await pool.query(
        "SELECT count(*) FROM materials",
      );
      for (const expertId of [undefined, retired, randomUUID()]) {
        const res = await call("POST", "/v1/admin/materials", {
          payload: {
            kind: "column",
            title: `Колонка ${marker()}`,
            ...(expertId ? { expertId } : {}),
          },
        });
        expect(res.statusCode, res.payload).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
        expect(fieldPaths(res)).toContain("expertId");
      }
      const { rows: after } = await pool.query(
        "SELECT count(*) FROM materials",
      );
      expect(after[0].count).toBe(before[0].count);
    });

    it("048 EARS-1: when a title or author line breaks its bounds, the system shall refuse on that field and change nothing", async () => {
      const m = await create(news());
      for (const [payload, path] of [
        [{ title: "   " }, "title"],
        [{ title: "я".repeat(161) }, "title"],
        [{ authorLine: "а".repeat(121) }, "authorLine"],
      ] as const) {
        const res = await patch(m, payload);
        expect(res.statusCode, res.payload).toBe(400);
        expect(fieldPaths(res)).toContain(path);
      }
      expect((await row(m.id))!.version).toBe(1);
    });

    it("048 EARS-2: when a body carries a node outside the allowlist, the system shall refuse on `body` and store nothing", async () => {
      const m = await create(news());
      const res = await patch(m, {
        body: {
          type: "doc",
          content: [{ type: "image", attrs: { src: "x" } }],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(fieldPaths(res).some((p) => p.startsWith("body"))).toBe(true);
      expect((await row(m.id))!.version).toBe(1);
    });

    it("048 EARS-1: when a news item becomes a column, the system shall empty its author line; a news item keeps its line on edit", async () => {
      const m = await create(news({ authorLine: "Редакция" }));
      const edited = await patch(m, { title: `Правка ${marker()}` });
      expect(edited.statusCode, edited.payload).toBe(200);
      expect(json(edited).authorLine).toBe("Редакция");
      expect(edited.headers.etag).toBe('W/"2"');

      const expertId = await expert("published");
      const column = await patch(json(edited), { kind: "column", expertId });
      expect(column.statusCode, column.payload).toBe(200);
      expect(json(column)).toMatchObject({ kind: "column", authorLine: "" });
      expect((await row(m.id))!.expert_id).toBe(expertId);
    });

    it("048 EARS-19: when a partner is set and then cleared, the system shall store and drop the reference; a retired or unknown one is refused on `partnerOrganisationId`", async () => {
      const partner = await organisation("published");
      const m = await create(news({ partnerOrganisationId: partner }));
      expect(m.partner).toMatchObject({ id: partner });

      for (const bad of [await organisation("retired"), randomUUID()]) {
        const res = await patch(m, { partnerOrganisationId: bad });
        expect(res.statusCode, res.payload).toBe(400);
        expect(fieldPaths(res)).toContain("partnerOrganisationId");
      }
      expect((await row(m.id))!.partner_organisation_id).toBe(partner);

      const cleared = await patch(m, { partnerOrganisationId: null });
      expect(cleared.statusCode, cleared.payload).toBe(200);
      expect(json(cleared).partner).toBeNull();
      expect((await row(m.id))!.partner_organisation_id).toBeNull();
    });

    // ── V-3: publish / edit / unpublish (EARS-4…EARS-6) ───────────────────

    it("048 EARS-4: when a draft lacks the body text or a column's published expert, the system shall refuse with 409 naming each item and write no entry", async () => {
      const draftExpert = await expert("draft");
      const m = await create({
        kind: "column",
        title: `Колонка ${marker()}`,
        expertId: draftExpert,
        body: emptyBody,
      });
      const res = await publish(m);
      expect(res.statusCode, res.payload).toBe(409);
      expect(problem(res).errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      expect(fieldPaths(res).sort()).toEqual(["body", "expertId"]);
      expect(await row(m.id)).toMatchObject({ status: "draft", version: 1 });
      expect(await entries(m.id)).toHaveLength(0);
    });

    it("048 EARS-4: when a complete draft is published, the system shall set first_published_at once, publish it and write exactly one feed entry", async () => {
      const partner = await organisation("published");
      const m = await create(news({ partnerOrganisationId: partner }));
      const res = await publish(m);
      expect(res.statusCode, res.payload).toBe(200);
      const body = json(res) as Detail;
      expect(body.status).toBe("published");
      expect(body.firstPublishedAt).not.toBeNull();
      expect(res.headers.etag).toBe('W/"2"');
      const rows = await entries(m.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "news",
        title: m.title,
        source_name: "Академия",
        author_expert_id: null,
        partner_organisation_id: partner,
        href: `/materials/${m.slug}`,
      });
      expect(rows[0]!.published_at.toISOString()).toBe(body.firstPublishedAt);

      const again = await publish(body);
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");
    });

    it("048 EARS-5: when a published material is edited, the system shall rewrite its entry and keep the card date; emptying the body is refused and changes nothing", async () => {
      const m = await create(news());
      const published = json(await publish(m)) as Detail;
      const firstDate = published.firstPublishedAt;
      const partner = await organisation("published");
      const edited = await patch(published, {
        title: `Новый заголовок ${marker()}`,
        partnerOrganisationId: partner,
      });
      expect(edited.statusCode, edited.payload).toBe(200);
      const after = json(edited) as Detail;
      const [entry] = await entries(m.id);
      expect(entry).toMatchObject({
        title: after.title,
        partner_organisation_id: partner,
      });
      expect(entry!.published_at.toISOString()).toBe(firstDate);
      expect(after.slug).toBe(m.slug);

      const emptied = await patch(after, { body: emptyBody });
      expect(emptied.statusCode, emptied.payload).toBe(409);
      expect(problem(emptied).errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      expect(fieldPaths(emptied)).toEqual(["body"]);
      expect((await row(m.id))!.version).toBe(after.version);
      expect((await entries(m.id))[0]!.title).toBe(after.title);
    });

    it("048 EARS-5: when a published column whose expert is no longer published is edited, the system shall accept the edit; the list marks it off the site", async () => {
      const expertId = await expert("published");
      const m = await create({
        kind: "column",
        title: `Колонка ${marker()}`,
        expertId,
        body: text("Мнение"),
      });
      const published = json(await publish(m)) as Detail;
      await pool.query("UPDATE experts SET status = 'draft' WHERE id = $1", [
        expertId,
      ]);
      const edited = await patch(published, { title: `Правка ${marker()}` });
      expect(edited.statusCode, edited.payload).toBe(200);
      const [entry] = await entries(m.id);
      expect(entry).toMatchObject({
        kind: "column",
        source_name: null,
        author_expert_id: expertId,
      });

      // EARS-7 — «Не на сайте: эксперт не опубликован».
      const list = await call(
        "GET",
        `/v1/admin/materials?q=${encodeURIComponent(json(edited).title)}`,
      );
      expect(list.statusCode).toBe(200);
      const item = (json(list).data as { id: string }[]).find(
        (r) => r.id === m.id,
      );
      expect(item).toMatchObject({
        kind: "column",
        status: "published",
        author: "Страхов Михаил Андреевич",
        expertNotPublished: true,
      });
    });

    it("048 EARS-6: when a published material is unpublished and published again, the system shall remove the entry, return it to draft and restore the first date", async () => {
      const m = await create(news());
      const published = json(await publish(m)) as Detail;
      const res = await unpublish(published);
      expect(res.statusCode, res.payload).toBe(200);
      const draft = json(res) as Detail;
      expect(draft).toMatchObject({
        status: "draft",
        title: m.title,
        firstPublishedAt: published.firstPublishedAt,
      });
      expect(await entries(m.id)).toHaveLength(0);

      const again = await unpublish(draft);
      expect(again.statusCode).toBe(409);
      expect(problem(again).errorCode).toBe("INVALID_TRANSITION");

      const republished = json(await publish(draft)) as Detail;
      expect(republished.firstPublishedAt).toBe(published.firstPublishedAt);
      const rows = await entries(m.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.published_at.toISOString()).toBe(
        published.firstPublishedAt,
      );
    });

    // ── EARS-7: the admin list ────────────────────────────────────────────

    it("048 EARS-7: when «Материалы» is listed, the system shall return title, kind, status, first date and author, most recently changed first, filtered by kind and status", async () => {
      const tag = marker();
      const a = await create(
        news({ title: `Список ${tag} A`, authorLine: "Редакция" }),
      );
      const b = await create(news({ title: `Список ${tag} B` }));
      await publish(b);
      const list = await call(
        "GET",
        `/v1/admin/materials?q=${encodeURIComponent(`Список ${tag}`)}`,
      );
      expect(list.statusCode, list.payload).toBe(200);
      const body = json(list) as {
        data: { id: string; author: string | null; status: string }[];
        total: number;
      };
      expect(body.data.map((r) => r.id)).toEqual([b.id, a.id]);
      expect(body.total).toBe(2);
      expect(body.data[1]).toMatchObject({
        author: "Редакция",
        status: "draft",
      });

      const published = await call(
        "GET",
        `/v1/admin/materials?q=${encodeURIComponent(`Список ${tag}`)}&status=published&kind=news`,
      );
      expect(
        (json(published).data as { id: string }[]).map((r) => r.id),
      ).toEqual([b.id]);
      const columns = await call(
        "GET",
        `/v1/admin/materials?q=${encodeURIComponent(`Список ${tag}`)}&kind=column`,
      );
      expect(json(columns).total).toBe(0);
      const bad = await call("GET", "/v1/admin/materials?status=retired");
      expect(bad.statusCode).toBe(400);
    });

    // ── V-5: authz, idempotency, If-Match, audit (EARS-8) ────────────────

    it("048 EARS-8: when the caller has no admin session or only a portal session, every material endpoint shall refuse it and write nothing", async () => {
      const m = await create(news());
      const email = uniqueEmail("mat-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      const portal = login.cookies.find(
        (c) => c.name === SESSION_COOKIE_NAME,
      )!.value;
      const routes: [string, string][] = [
        ["GET", "/v1/admin/materials"],
        ["POST", "/v1/admin/materials"],
        ["GET", `/v1/admin/materials/${m.id}`],
        ["PATCH", `/v1/admin/materials/${m.id}`],
        ["POST", `/v1/admin/materials/${m.id}/publish`],
        ["POST", `/v1/admin/materials/${m.id}/unpublish`],
      ];
      for (const [method, url] of routes) {
        for (const cookie of [undefined, `${SESSION_COOKIE_NAME}=${portal}`]) {
          const res = await app.inject({
            method: method as "GET",
            url,
            headers: {
              ...device,
              "content-type": "application/json",
              "idempotency-key": randomUUID(),
              "if-match": 'W/"1"',
              ...(cookie ? { cookie } : {}),
            },
            payload: method === "GET" ? undefined : news(),
          });
          expect(res.statusCode, `${method} ${url}`).toBe(401);
        }
      }
      expect(await row(m.id)).toMatchObject({ version: 1, status: "draft" });
    });

    it("048 EARS-8: when an admin session no longer holds platform_admin, a material write shall be refused with 403", async () => {
      const other = await adminSession();
      await fake.revokeProjectRole(other.sub, "platform_admin");
      const res = await call("POST", "/v1/admin/materials", {
        payload: news(),
        sid: other.sid,
      });
      expect(res.statusCode, res.payload).toBe(403);
    });

    it("048 EARS-8: when a write carries no idempotency key or a stale If-Match, the system shall refuse it and change nothing", async () => {
      const missingKey = await call("POST", "/v1/admin/materials", {
        payload: news(),
        idempotencyKey: null,
      });
      expect(missingKey.statusCode).toBe(428);
      expect(problem(missingKey).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");

      const m = await create(news());
      const edited = json(
        await patch(m, { title: `Правка ${marker()}` }),
      ) as Detail;
      for (const res of [
        await patch(m, { title: "Устаревшая" }),
        await publish(m),
        await call("POST", `/v1/admin/materials/${m.id}/unpublish`, {
          ifMatch: 'W/"1"',
        }),
      ]) {
        expect(res.statusCode, res.payload).toBe(412);
        expect(problem(res).errorCode).toBe("PRECONDITION_FAILED");
      }
      const noIfMatch = await call("PATCH", `/v1/admin/materials/${m.id}`, {
        payload: { title: "Без версии" },
      });
      expect(noIfMatch.statusCode).toBe(428);
      for (const path of ["", "/publish"]) {
        const res = await call(
          path ? "POST" : "PATCH",
          `/v1/admin/materials/${m.id}${path}`,
          {
            ifMatch: `W/"${edited.version}"`,
            idempotencyKey: null,
            payload: {},
          },
        );
        expect(res.statusCode).toBe(428);
      }
      expect(await row(m.id)).toMatchObject({
        version: edited.version,
        title: edited.title,
        status: "draft",
      });
    });

    it("048 EARS-8: when the same key is retried with identical input, the system shall replay the response and create no second row", async () => {
      const k = key();
      const payload = news();
      const first = await call("POST", "/v1/admin/materials", {
        payload,
        idempotencyKey: k,
      });
      expect(first.statusCode).toBe(201);
      materialIds.push(json(first).id);
      const replay = await call("POST", "/v1/admin/materials", {
        payload,
        idempotencyKey: k,
      });
      expect(replay.statusCode).toBe(201);
      expect(json(replay).id).toBe(json(first).id);
    });

    it("048 EARS-8: when a material is created, edited, published and unpublished, each write shall leave exactly one 010 audit row under the acting administrator", async () => {
      const m = await create(news());
      expect(await materialAudit(m.id)).toHaveLength(1);
      const edited = json(
        await patch(m, { title: `Правка ${marker()}` }),
      ) as Detail;
      expect(await materialAudit(m.id)).toHaveLength(2);
      const published = json(await publish(edited)) as Detail;
      expect(await materialAudit(m.id)).toHaveLength(3);
      await unpublish(published);
      const rows = await materialAudit(m.id);
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.materials.insert",
        "data.materials.update",
        "data.materials.update",
        "data.materials.update",
      ]);
      // `subject_id` is the acting administrator's opaque IdP `sub`.
      for (const r of rows) expect(r.subject_id).toBe(adminSub);
    });
  },
);
