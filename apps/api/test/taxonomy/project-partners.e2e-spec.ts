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
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

// 012 EARS-10 (#1292) — the project↔partner relationship and the PRIMARY slot
// over the REAL stack: Fastify + the 011 admin session + Postgres.
//
// Two product rules justify this suite, both from 012-design §3.2/§5.2:
//
//   1. a project has AT MOST ONE active primary partner. Half of that is a
//      partial unique index; the half that decides what a client SEES is the
//      service, which must answer 409 `RELATIONSHIP_CONFLICT` and leave the
//      incumbent untouched — no row mutation and, because feature-010 audits in
//      the SAME transaction, no ledger row either. A refusal that still wrote an
//      audit entry would mean the transaction reached the write and rolled back
//      only partly;
//   2. `PublicProjectSummary.primaryPartner` is populated EVERYWHERE that DTO is
//      emitted. Three public routes emit it — `/public/events/:key/projects`,
//      `/public/experts/:key/projects` and `/public/partners/:key/projects` —
//      and the regression this vertical is most exposed to is exactly one of
//      them keeping a private mapper and reporting `null` forever. Asserting all
//      three is what makes `PublicProjectSummaryService` load-bearing rather
//      than merely present.
//
// Skips when the stand is absent, exactly as the sibling admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-10 project↔partner relationship and the primary slot (e2e)",
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
    const createdProjectIds: string[] = [];
    const createdPartnerIds: string[] = [];
    const createdExpertIds: string[] = [];
    const createdEventIds: string[] = [];
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

    async function adminSession(): Promise<string> {
      const email = uniqueEmail("pp-admin");
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

    // ── Fixtures ───────────────────────────────────────────────────────────

    /** A DRAFT project by default — the state in which relations are authored. */
    async function insertProject(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: `p-1292-${randomUUID()}`,
        kind: "school",
        title: `Школа ${Math.random().toString(36).slice(2, 8)}`,
        description: "Описание проекта",
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO projects (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      createdProjectIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /** By default a PUBLISHED partner — the only lifecycle §5.2 discloses. */
    async function insertPartner(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: `pt-1292-${randomUUID()}`,
        title: `Партнёр ${Math.random().toString(36).slice(2, 8)}`,
        website_url: "https://partner.example",
        status: "published",
        first_published_at: new Date(),
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO partners (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      createdPartnerIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertExpert(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts
           (slug, family_name, given_name, professional_role, credentials, affiliation, status,
            first_published_at)
         VALUES ($1, 'Иванова', 'И. И.', 'Кардиолог', 'д.м.н.', 'НМИЦ',
                 'published', now())
         RETURNING id`,
        [`x-1292-${randomUUID()}`],
      );
      createdExpertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /**
     * A PUBLICLY VISIBLE event: `/public/events/:key/projects` answers only for
     * `PUBLIC_EVENT_STATES` (`published | live | ended`), and the column
     * defaults to `draft`.
     */
    async function insertEvent(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, state)
         VALUES ($1, 'ХСН 1292', 'Кардиология', now(), 90, 'published')
         RETURNING id`,
        [`e-1292-${randomUUID()}`],
      );
      createdEventIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /** Flip a draft project to published WITHOUT going through #1287. */
    async function publishProject(id: string): Promise<void> {
      await pool.query(
        `UPDATE projects SET status = 'published', first_published_at = now()
          WHERE id = $1`,
        [id],
      );
    }

    async function relationRow(
      id: string,
    ): Promise<{ is_primary: boolean; status: string; version: number }> {
      const { rows } = await pool.query<{
        is_primary: boolean;
        status: string;
        version: number;
      }>(
        "SELECT is_primary, status, version FROM project_partners WHERE id = $1",
        [id],
      );
      return rows[0]!;
    }

    /** How many ledger rows this relation has — the "zero audit row" assertion. */
    async function auditRows(relationId: string): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_ledger
          WHERE metadata -> 'pk' ->> 'id' = $1`,
        [relationId],
      );
      return Number(rows[0]!.n);
    }

    // ── Request helpers ────────────────────────────────────────────────────

    interface Mutation {
      payload?: Record<string, unknown>;
      idempotencyKey?: string;
      ifMatch?: string;
    }

    function mutationHeaders({ idempotencyKey, ifMatch }: Mutation) {
      return {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
        ...(idempotencyKey === undefined
          ? { "idempotency-key": key() }
          : idempotencyKey === ""
            ? {}
            : { "idempotency-key": idempotencyKey }),
        ...(ifMatch === undefined ? {} : { "if-match": ifMatch }),
      };
    }

    function createRelation(opts: Mutation) {
      return app.inject({
        method: "POST",
        url: "/v1/admin/project-partners",
        headers: mutationHeaders(opts),
        payload: opts.payload ?? {},
      });
    }

    function patchRelation(id: string, opts: Mutation) {
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/project-partners/${id}`,
        headers: mutationHeaders(opts),
        payload: opts.payload ?? {},
      });
    }

    function transitionRelation(
      id: string,
      transition: "retire" | "restore",
      opts: Mutation,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/project-partners/${id}/${transition}`,
        headers: mutationHeaders(opts),
        payload: {},
      });
    }

    function readRelation(id: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/project-partners/${id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
    }

    function adminList(query: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/project-partners?${query}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
    }

    function publicGet(url: string) {
      return app.inject({ method: "GET", url, headers: { ...device } });
    }

    interface RelationDetail {
      id: string;
      projectId: string;
      projectTitle: string;
      projectSlug: string;
      partnerId: string;
      partnerTitle: string;
      partnerSlug: string;
      isPrimary: boolean;
      status: "active" | "retired";
      version: number;
      createdAt: string;
      updatedAt: string;
    }

    function body(res: { payload: string }): RelationDetail {
      return JSON.parse(res.payload) as RelationDetail;
    }

    function page(res: { payload: string }): {
      data: Array<Record<string, unknown>>;
      pagination: { nextCursor: string | null; hasMore: boolean };
    } {
      return JSON.parse(res.payload) as {
        data: Array<Record<string, unknown>>;
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
    }

    function problem(res: { payload: string }): {
      errorCode: string;
      status: number;
    } {
      return JSON.parse(res.payload) as { errorCode: string; status: number };
    }

    /** Create one relation and return its detail plus its ETag. */
    async function seedRelation(
      projectId: string,
      partnerId: string,
      isPrimary = false,
    ) {
      const res = await createRelation({
        payload: { projectId, partnerId, isPrimary },
      });
      expect(res.statusCode, res.payload).toBe(201);
      return { detail: body(res), etag: res.headers.etag as string };
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
      // Children first — every FK is RESTRICT by design.
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_projects WHERE event_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of createdProjectIds.splice(0)) {
        await pool.query("DELETE FROM project_partners WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM project_experts WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM event_projects WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const id of createdPartnerIds.splice(0)) {
        await pool.query("DELETE FROM project_partners WHERE partner_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM partners WHERE id = $1", [id]);
      }
      for (const id of createdExpertIds.splice(0)) {
        await pool.query("DELETE FROM project_experts WHERE expert_id = $1", [
          id,
        ]);
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

    // ── Authoring ──────────────────────────────────────────────────────────

    it("012 EARS-10: when a platform_admin attaches a partner to a project, the system shall persist one retained active relation at version 1 with an ETag, a Location and the exact admin DTO", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner();
      const res = await createRelation({ payload: { projectId, partnerId } });
      expect(res.statusCode, res.payload).toBe(201);
      const detail = body(res);
      expect(detail).toMatchObject({
        projectId,
        partnerId,
        // §5.1 declares `isPrimary` OPTIONAL on the wire and false by default:
        // an operator who says nothing has NOT claimed the primary slot.
        isPrimary: false,
        status: "active",
        version: 1,
      });
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(
        `/v1/admin/project-partners/${detail.id}`,
      );
      // The admin projection is a CLOSED shape: a column added later cannot
      // leak onto the wire unnoticed.
      expect(Object.keys(detail).sort()).toEqual([
        "createdAt",
        "id",
        "isPrimary",
        "partnerId",
        "partnerSlug",
        "partnerTitle",
        "projectId",
        "projectSlug",
        "projectTitle",
        "status",
        "updatedAt",
        "version",
      ]);

      const read = await readRelation(detail.id);
      expect(read.statusCode).toBe(200);
      expect(body(read)).toEqual(detail);
      expect(read.headers.etag).toBe('W/"1"');
    });

    it("012 EARS-10: when the same partner is already attached to the project, the system shall refuse a second relation and point at the restore instead — retired holders included", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner();
      const { detail, etag } = await seedRelation(projectId, partnerId);

      const duplicate = await createRelation({
        payload: { projectId, partnerId },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(problem(duplicate).errorCode).toBe("RELATIONSHIP_CONFLICT");

      // The pair-unique index spans RETAINED rows, so retiring does not free the
      // pair — a retired relation is restored, never re-created, which is what
      // keeps the relation's id (and its audit trail) stable.
      const retired = await transitionRelation(detail.id, "retire", {
        ifMatch: etag,
      });
      expect(retired.statusCode, retired.payload).toBe(200);
      const afterRetire = await createRelation({
        payload: { projectId, partnerId },
      });
      expect(afterRetire.statusCode).toBe(409);
      expect(problem(afterRetire).errorCode).toBe("RELATIONSHIP_CONFLICT");
    });

    // ── The primary slot ───────────────────────────────────────────────────

    it("012 EARS-10: when a second active primary partner would exist on a project, the system shall refuse it with ZERO row mutation and ZERO audit row", async () => {
      const projectId = await insertProject();
      const incumbentPartner = await insertPartner();
      const challengerPartner = await insertPartner();
      const incumbent = await seedRelation(projectId, incumbentPartner, true);
      const before = await relationRow(incumbent.detail.id);
      const auditBefore = await auditRows(incumbent.detail.id);

      const res = await createRelation({
        payload: { projectId, partnerId: challengerPartner, isPrimary: true },
      });
      expect(res.statusCode, res.payload).toBe(409);
      expect(problem(res).errorCode).toBe("RELATIONSHIP_CONFLICT");

      // Refused, not "resolved by demoting the incumbent": the operator decides
      // who loses the slot, never the API.
      expect(await relationRow(incumbent.detail.id)).toEqual(before);
      // feature-010 audits inside the SAME transaction, so a refusal that left a
      // ledger row would mean the write partially committed.
      expect(await auditRows(incumbent.detail.id)).toBe(auditBefore);
      const { rows } = await pool.query(
        "SELECT id FROM project_partners WHERE partner_id = $1",
        [challengerPartner],
      );
      expect(rows).toHaveLength(0);
    });

    it("012 EARS-10: the same refusal shall apply to PATCH-ing the flag on and to RESTORING a retired relation that still carries it", async () => {
      const projectId = await insertProject();
      const incumbent = await seedRelation(
        projectId,
        await insertPartner(),
        true,
      );
      const other = await seedRelation(projectId, await insertPartner(), false);

      const patched = await patchRelation(other.detail.id, {
        payload: { isPrimary: true },
        ifMatch: other.etag,
      });
      expect(patched.statusCode, patched.payload).toBe(409);
      expect(problem(patched).errorCode).toBe("RELATIONSHIP_CONFLICT");
      expect(await relationRow(other.detail.id)).toMatchObject({
        is_primary: false,
        version: 1,
      });

      // A retired row KEEPS its flag (the partial unique excludes it), so the
      // conflict surfaces on the way back in rather than being silently cleared.
      const thirdProject = await insertProject();
      const partner = await insertPartner();
      const retiredPrimary = await seedRelation(thirdProject, partner, true);
      const retire = await transitionRelation(
        retiredPrimary.detail.id,
        "retire",
        {
          ifMatch: retiredPrimary.etag,
        },
      );
      expect(retire.statusCode, retire.payload).toBe(200);
      expect(await relationRow(retiredPrimary.detail.id)).toMatchObject({
        is_primary: true,
        status: "retired",
      });
      const replacement = await seedRelation(
        thirdProject,
        await insertPartner(),
        true,
      );
      expect(replacement.detail.isPrimary).toBe(true);

      const restore = await transitionRelation(
        retiredPrimary.detail.id,
        "restore",
        {
          ifMatch: `"${(await relationRow(retiredPrimary.detail.id)).version}"`,
        },
      );
      expect(restore.statusCode, restore.payload).toBe(409);
      expect(problem(restore).errorCode).toBe("RELATIONSHIP_CONFLICT");
      expect(await relationRow(retiredPrimary.detail.id)).toMatchObject({
        status: "retired",
      });
      // The incumbent of the FIRST project is untouched by all of this.
      expect(await relationRow(incumbent.detail.id)).toMatchObject({
        is_primary: true,
        status: "active",
      });
    });

    it("012 EARS-10: clearing the flag first shall be the legal way to hand the primary slot over", async () => {
      const projectId = await insertProject();
      const incumbent = await seedRelation(
        projectId,
        await insertPartner(),
        true,
      );
      const successor = await seedRelation(
        projectId,
        await insertPartner(),
        false,
      );

      const cleared = await patchRelation(incumbent.detail.id, {
        payload: { isPrimary: false },
        ifMatch: incumbent.etag,
      });
      expect(cleared.statusCode, cleared.payload).toBe(200);
      expect(body(cleared)).toMatchObject({ isPrimary: false, version: 2 });

      const promoted = await patchRelation(successor.detail.id, {
        payload: { isPrimary: true },
        ifMatch: successor.etag,
      });
      expect(promoted.statusCode, promoted.payload).toBe(200);
      expect(body(promoted)).toMatchObject({ isPrimary: true, version: 2 });

      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM project_partners
          WHERE project_id = $1 AND is_primary AND status = 'active'`,
        [projectId],
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("012 EARS-10: the primary slot shall be per PROJECT — the same partner may be primary on several projects at once", async () => {
      const partnerId = await insertPartner();
      const first = await insertProject();
      const second = await insertProject();
      expect(
        (await seedRelation(first, partnerId, true)).detail.isPrimary,
      ).toBe(true);
      expect(
        (await seedRelation(second, partnerId, true)).detail.isPrimary,
      ).toBe(true);
    });

    // ── EARS-16 / EARS-17 cross-cutting ────────────────────────────────────

    it("012 EARS-10: when a create is replayed with the same Idempotency-Key, the system shall answer the stored outcome without a second relation", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner();
      const k = key();
      const payload = { projectId, partnerId, isPrimary: true };
      const first = await createRelation({ payload, idempotencyKey: k });
      expect(first.statusCode, first.payload).toBe(201);
      const replay = await createRelation({ payload, idempotencyKey: k });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(first));
      expect(replay.headers.etag).toBe(first.headers.etag);
      expect(replay.headers.location).toBe(first.headers.location);
      const { rows } = await pool.query(
        "SELECT id FROM project_partners WHERE project_id = $1",
        [projectId],
      );
      expect(rows).toHaveLength(1);
    });

    it("012 EARS-10: when a mutation carries no Idempotency-Key, the system shall refuse it before touching the payload", async () => {
      const res = await createRelation({
        // Deliberately invalid payload too: the key check must answer FIRST.
        payload: { projectId: "nope", partnerId: "nope", isPrimary: "yes" },
        idempotencyKey: "",
      });
      expect(res.statusCode).toBe(428);
      expect(problem(res).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("012 EARS-10: when the payload is outside its §5.1 shape, the system shall refuse it before any write", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner();
      const bad: Array<Record<string, unknown>> = [
        { isPrimary: "yes" },
        { projectId: "not-a-uuid" },
        // Strict objects: a misspelled key is a contract mismatch, not a value
        // to ignore silently.
        { partnerID: randomUUID() },
        { status: "active" },
        { role: "curator" },
      ];
      for (const override of bad) {
        const res = await createRelation({
          payload: { projectId, partnerId, ...override },
        });
        expect(res.statusCode, JSON.stringify(override)).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      }
      const { rows } = await pool.query(
        "SELECT id FROM project_partners WHERE project_id = $1",
        [projectId],
      );
      expect(rows).toHaveLength(0);
    });

    it("012 EARS-10: when an edit carries no If-Match or a stale one, the system shall refuse it", async () => {
      const projectId = await insertProject();
      const { detail, etag } = await seedRelation(
        projectId,
        await insertPartner(),
      );
      const absent = await patchRelation(detail.id, {
        payload: { isPrimary: true },
      });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await patchRelation(detail.id, {
        payload: { isPrimary: true },
        ifMatch: '"99"',
      });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");

      const fresh = await patchRelation(detail.id, {
        payload: { isPrimary: true },
        ifMatch: etag,
      });
      expect(fresh.statusCode, fresh.payload).toBe(200);
      expect(body(fresh)).toMatchObject({ isPrimary: true, version: 2 });
    });

    it("012 EARS-10: an absent or non-UUID relation id shall be indistinguishable from a real one that is not there", async () => {
      const absent = await readRelation(randomUUID());
      expect(absent.statusCode).toBe(404);
      expect(problem(absent).errorCode).toBe("RESOURCE_NOT_FOUND");
      const nonUuid = await readRelation("not-a-uuid");
      expect(nonUuid.statusCode).toBe(404);
      expect(problem(nonUuid).errorCode).toBe("RESOURCE_NOT_FOUND");
    });

    it("012 EARS-10: the admin list shall filter by project and by partner, with retired relations excluded by default", async () => {
      const projectId = await insertProject();
      const firstPartner = await insertPartner();
      const a = await seedRelation(projectId, firstPartner, true);
      const b = await seedRelation(projectId, await insertPartner(), false);
      await transitionRelation(b.detail.id, "retire", { ifMatch: b.etag });

      const listed = await adminList(`projectId=${projectId}`);
      expect(listed.statusCode).toBe(200);
      const first = JSON.parse(listed.payload) as {
        data: RelationDetail[];
        total: number;
      };
      expect(first.data.map((r) => r.id)).toEqual([a.detail.id]);
      expect(first.total).toBe(1);

      const withRetired = await adminList(
        `projectId=${projectId}&includeRetired=true`,
      );
      expect(
        (JSON.parse(withRetired.payload) as { data: RelationDetail[] }).data
          .map((r) => r.id)
          .sort(),
      ).toEqual([a.detail.id, b.detail.id].sort());

      const byPartner = await adminList(`partnerId=${firstPartner}`);
      expect(
        (JSON.parse(byPartner.payload) as { data: RelationDetail[] }).data.map(
          (r) => r.id,
        ),
      ).toEqual([a.detail.id]);
    });

    // ── §5.2 public traversals ─────────────────────────────────────────────

    it("012 EARS-10: the public project→partners read shall answer exactly PublicPartnerSummary + isPrimary, in a stable cursor-paged order", async () => {
      const projectId = await insertProject();
      const first = await insertPartner({ title: "Альфа-Фарм" });
      const second = await insertPartner({ title: "Яндекс-Здоровье" });
      await seedRelation(projectId, first, true);
      await seedRelation(projectId, second, false);
      await publishProject(projectId);
      const { rows } = await pool.query<{ slug: string }>(
        "SELECT slug FROM projects WHERE id = $1",
        [projectId],
      );

      const res = await publicGet(
        `/v1/public/projects/${projectId}/partners?limit=1`,
      );
      expect(res.statusCode, res.payload).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=30");
      const firstPage = page(res);
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.data[0]).toMatchObject({
        id: first,
        title: "Альфа-Фарм",
        isPrimary: true,
        websiteUrl: "https://partner.example",
      });
      // The §5.2 shape is CLOSED — no status, no relation id, no admin field.
      expect(Object.keys(firstPage.data[0]!).sort()).toEqual([
        "id",
        "isPrimary",
        "logoUrl",
        "slug",
        "title",
        "websiteUrl",
      ]);
      expect(firstPage.pagination.hasMore).toBe(true);

      const next = await publicGet(
        `/v1/public/projects/${projectId}/partners?limit=1&cursor=${encodeURIComponent(
          firstPage.pagination.nextCursor!,
        )}`,
      );
      const secondPage = page(next);
      expect(secondPage.data[0]).toMatchObject({
        id: second,
        isPrimary: false,
      });
      expect(secondPage.pagination.hasMore).toBe(false);

      // The slug resolves to the same page as the id.
      const bySlug = await publicGet(
        `/v1/public/projects/${rows[0]!.slug}/partners`,
      );
      expect(page(bySlug).data.map((r) => r.id)).toEqual([first, second]);
    });

    it("012 EARS-10: the public partner→projects read shall answer exactly PublicProjectSummary + isPrimary, with the primary partner embedded", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner({ title: "Альфа-Фарм" });
      await seedRelation(projectId, partnerId, true);
      await publishProject(projectId);

      const res = await publicGet(`/v1/public/partners/${partnerId}/projects`);
      expect(res.statusCode, res.payload).toBe(200);
      const item = page(res).data[0]!;
      expect(item).toMatchObject({
        id: projectId,
        kind: "school",
        isPrimary: true,
        primaryPartner: {
          id: partnerId,
          title: "Альфа-Фарм",
          logoUrl: null,
          websiteUrl: "https://partner.example",
        },
      });
      expect(Object.keys(item).sort()).toEqual([
        "coverUrl",
        "description",
        "id",
        "isPrimary",
        "kind",
        "primaryPartner",
        "slug",
        "title",
      ]);
    });

    it("012 EARS-10: primaryPartner shall be populated on EVERY route that emits PublicProjectSummary, not just the partner one", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner({ title: "Альфа-Фарм" });
      await seedRelation(projectId, partnerId, true);
      await publishProject(projectId);

      // …reached through an EVENT (EARS-6's route),
      const eventId = await insertEvent();
      await pool.query(
        "INSERT INTO event_projects (event_id, project_id) VALUES ($1, $2)",
        [eventId, projectId],
      );
      // …and through an EXPERT (EARS-9's route).
      const expertId = await insertExpert();
      await seedExpertRelation(projectId, expertId);

      for (const url of [
        `/v1/public/events/${eventId}/projects`,
        `/v1/public/experts/${expertId}/projects`,
        `/v1/public/partners/${partnerId}/projects`,
      ]) {
        const res = await publicGet(url);
        expect(res.statusCode, `${url} → ${res.payload}`).toBe(200);
        const item = page(res).data[0];
        expect(item, url).toBeDefined();
        expect(item!.primaryPartner, url).toMatchObject({
          id: partnerId,
          slug: expect.any(String) as unknown as string,
          title: "Альфа-Фарм",
        });
      }
    });

    it("012 EARS-10: a primary partner that is not itself public shall report primaryPartner: null rather than leak a draft organization", async () => {
      const projectId = await insertProject();
      const draftPartner = await insertPartner({
        status: "draft",
        first_published_at: null,
      });
      await seedRelation(projectId, draftPartner, true);
      await publishProject(projectId);
      const expertId = await insertExpert();
      await seedExpertRelation(projectId, expertId);

      const res = await publicGet(`/v1/public/experts/${expertId}/projects`);
      expect(res.statusCode, res.payload).toBe(200);
      expect(page(res).data[0]).toMatchObject({
        id: projectId,
        primaryPartner: null,
      });
    });

    it("012 EARS-10: a not-publicly-eligible endpoint shall be 404 on both directions, while an eligible one with no relations is an ordinary EMPTY page", async () => {
      // A draft leaks no "exists but private" oracle: the answer is exactly the
      // answer an unknown id gets.
      const draftProject = await insertProject();
      const draftPartner = await insertPartner({
        status: "draft",
        first_published_at: null,
      });
      await seedRelation(draftProject, draftPartner, true);

      for (const url of [
        `/v1/public/projects/${draftProject}/partners`,
        `/v1/public/projects/${randomUUID()}/partners`,
        `/v1/public/partners/${draftPartner}/projects`,
        `/v1/public/partners/${randomUUID()}/projects`,
      ]) {
        const res = await publicGet(url);
        expect(res.statusCode, url).toBe(404);
        expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      }

      const emptyProject = await insertProject();
      await publishProject(emptyProject);
      const empty = await publicGet(
        `/v1/public/projects/${emptyProject}/partners`,
      );
      expect(empty.statusCode).toBe(200);
      expect(JSON.parse(empty.payload)).toMatchObject({
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it("012 EARS-10: a cursor this API did not issue shall be refused as a 400, never reach the query as an operand", async () => {
      // The cursor is caller-supplied bytes on a ZERO-AUTH route: a decoded
      // non-UUID `id` would hit a `uuid` column as Postgres 22P02 — a 500 for
      // what EARS-16 contracts as a 400.
      const projectId = await insertProject();
      await publishProject(projectId);
      const tampered = Buffer.from(
        JSON.stringify({ title: "", id: "'; DROP TABLE project_partners; --" }),
        "utf8",
      ).toString("base64url");

      for (const cursor of [tampered, "not-base64url-json"]) {
        const res = await publicGet(
          `/v1/public/projects/${projectId}/partners?cursor=${encodeURIComponent(
            cursor,
          )}`,
        );
        expect(res.statusCode, cursor).toBe(400);
        expect(problem(res).errorCode).toBe("CURSOR_INVALID");
      }
    });

    /** An EARS-9 relation — the cheapest way to reach EARS-9's public route. */
    async function seedExpertRelation(
      projectId: string,
      expertId: string,
    ): Promise<void> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/project-experts",
        headers: mutationHeaders({}),
        payload: { projectId, expertId, role: "curator" },
      });
      expect(res.statusCode, res.payload).toBe(201);
    }
  },
);
