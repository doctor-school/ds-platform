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

// 012 EARS-9 (#1291) — the project↔expert relationship over the REAL stack:
// Fastify + the 011 admin session + Postgres.
//
// The product rule this suite exists to prove is 012-design §3.2: a PUBLISHED
// project carries EXACTLY ONE active curator, and that curator's expert is
// published and non-retired. Half of it is an index (at most one); the other
// half spans `project_experts` and `experts` and therefore lives in the service.
// Three consequences are asserted here, because each is a way the rule is
// normally broken:
//
//   1. the lower bound cannot be crossed by ANY command — retiring the sole
//      curator and demoting them to `member` are the same refusal, with zero
//      row, version and audit mutation;
//   2. the upper bound is refused with a 409 rather than by the immediate
//      partial unique index, which would surface as a 500-shaped fault;
//   3. `replace-curator` is ATOMIC and demotes FIRST. Promote-then-demote would
//      collide with the immediate index mid-transaction even though the end
//      state is legal — so the ordering is not a style choice, and a candidate
//      that stops being eligible between the seed read and the lock loses the
//      whole transaction, leaving the incumbent in the seat.
//
// Skips when the stand is absent, exactly as the sibling admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-9 project↔expert relationship and the curator seat (e2e)",
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
    const createdExpertIds: string[] = [];
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
      const email = uniqueEmail("pe-admin");
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
        slug: `p-1291-${randomUUID()}`,
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

    /** By default a PUBLISHED expert — the only lifecycle that may curate. */
    async function insertExpert(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: `x-1291-${randomUUID()}`,
        name: "Иванова И. И.",
        professional_role: "Кардиолог",
        credentials: "д.м.н.",
        affiliation: "НМИЦ",
        status: "published",
        first_published_at: new Date(),
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      createdExpertIds.push(rows[0]!.id);
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

    async function projectVersion(id: string): Promise<number> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM projects WHERE id = $1",
        [id],
      );
      return rows[0]!.version;
    }

    async function relationRow(
      id: string,
    ): Promise<{ role: string; status: string; version: number }> {
      const { rows } = await pool.query<{
        role: string;
        status: string;
        version: number;
      }>("SELECT role, status, version FROM project_experts WHERE id = $1", [
        id,
      ]);
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
        url: "/v1/admin/project-experts",
        headers: mutationHeaders(opts),
        payload: opts.payload ?? {},
      });
    }

    function patchRelation(id: string, opts: Mutation) {
      return app.inject({
        method: "PATCH",
        url: `/v1/admin/project-experts/${id}`,
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
        url: `/v1/admin/project-experts/${id}/${transition}`,
        headers: mutationHeaders(opts),
        payload: {},
      });
    }

    function replaceCurator(projectId: string, opts: Mutation) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/projects/${projectId}/replace-curator`,
        headers: mutationHeaders(opts),
        payload: opts.payload ?? {},
      });
    }

    function readRelation(id: string) {
      return app.inject({
        method: "GET",
        url: `/v1/admin/project-experts/${id}`,
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
      expertId: string;
      expertName: string | null;
      expertSlug: string;
      role: "curator" | "member";
      status: "active" | "retired";
      version: number;
      createdAt: string;
      updatedAt: string;
    }

    function body(res: { payload: string }): RelationDetail {
      return JSON.parse(res.payload) as RelationDetail;
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
      expertId: string,
      role: "curator" | "member" = "member",
    ) {
      const res = await createRelation({
        payload: { projectId, expertId, role },
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
      for (const id of createdProjectIds.splice(0)) {
        await pool.query("DELETE FROM project_experts WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM project_partners WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
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

    it("012 EARS-9: when a platform_admin lists an expert on a project, the system shall persist one retained active relation at version 1 with an ETag, a Location and the exact admin DTO", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      const res = await createRelation({
        payload: { projectId, expertId, role: "member" },
      });
      expect(res.statusCode, res.payload).toBe(201);
      const detail = body(res);
      expect(detail).toMatchObject({
        projectId,
        expertId,
        role: "member",
        status: "active",
        version: 1,
        expertName: "Иванова И. И.",
      });
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(
        `/v1/admin/project-experts/${detail.id}`,
      );
      // The admin projection is a CLOSED shape: a column added later cannot
      // leak onto the wire unnoticed.
      expect(Object.keys(detail).sort()).toEqual([
        "createdAt",
        "expertId",
        "expertName",
        "expertSlug",
        "id",
        "projectId",
        "projectSlug",
        "projectTitle",
        "role",
        "status",
        "updatedAt",
        "version",
      ]);

      const read = await readRelation(detail.id);
      expect(read.statusCode).toBe(200);
      expect(body(read)).toEqual(detail);
      expect(read.headers.etag).toBe('W/"1"');
    });

    it("012 EARS-9: when the same expert is already listed on the project, the system shall refuse a second relation and point at the restore instead — retired holders included", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      const { detail, etag } = await seedRelation(projectId, expertId);

      const duplicate = await createRelation({
        payload: { projectId, expertId, role: "curator" },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(problem(duplicate).errorCode).toBe("RELATIONSHIP_CONFLICT");

      await transitionRelation(detail.id, "retire", { ifMatch: etag });
      const afterRetire = await createRelation({
        payload: { projectId, expertId, role: "member" },
      });
      expect(afterRetire.statusCode).toBe(409);
      expect(problem(afterRetire).errorCode).toBe("RELATIONSHIP_CONFLICT");
    });

    it("012 EARS-9: when a second active curator would exist on any project, draft ones included, the system shall refuse it as a 409 rather than let the immediate index fire", async () => {
      // The upper bound. Refusing HERE is what turns a `23505` — a 500-shaped
      // fault — into the contract's 409, and it holds on a DRAFT project too,
      // because the index does not look at the project's lifecycle.
      const projectId = await insertProject();
      await seedRelation(projectId, await insertExpert(), "curator");

      const second = await createRelation({
        payload: {
          projectId,
          expertId: await insertExpert(),
          role: "curator",
        },
      });
      expect(second.statusCode).toBe(409);
      expect(problem(second).errorCode).toBe("RELATIONSHIP_CONFLICT");

      // A `member` is unbounded, and PROMOTING it over the occupied seat is the
      // same refusal — the seat is MOVED by replace-curator, never won by a race.
      const member = await seedRelation(
        projectId,
        await insertExpert(),
        "member",
      );
      const promote = await patchRelation(member.detail.id, {
        payload: { role: "curator" },
        ifMatch: member.etag,
      });
      expect(promote.statusCode).toBe(409);
      expect(problem(promote).errorCode).toBe("RELATIONSHIP_CONFLICT");
      expect((await relationRow(member.detail.id)).version).toBe(1);
    });

    it("012 EARS-9: when the sole curator of a PUBLISHED project would be retired or demoted, the system shall refuse with zero row, version and audit mutation", async () => {
      // The lower bound, and the assertion that the refusal costs nothing: the
      // transaction never writes, so neither the version nor the ledger moves.
      const projectId = await insertProject();
      const curator = await seedRelation(
        projectId,
        await insertExpert(),
        "curator",
      );
      await publishProject(projectId);
      const before = await auditRows(curator.detail.id);

      const retired = await transitionRelation(curator.detail.id, "retire", {
        ifMatch: curator.etag,
      });
      expect(retired.statusCode).toBe(409);
      expect(problem(retired).errorCode).toBe(
        "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      );

      const demoted = await patchRelation(curator.detail.id, {
        payload: { role: "member" },
        ifMatch: curator.etag,
      });
      expect(demoted.statusCode).toBe(409);
      expect(problem(demoted).errorCode).toBe(
        "PUBLISHED_PROJECT_REQUIRES_CURATOR",
      );

      expect(await relationRow(curator.detail.id)).toMatchObject({
        role: "curator",
        status: "active",
        version: 1,
      });
      expect(await auditRows(curator.detail.id)).toBe(before);
    });

    it("012 EARS-9: when the curator of a published project stops being publicly eligible, the system shall refuse the commit rather than publish a project with an invisible curator", async () => {
      // The half of §3.2 no index can express: it spans `project_experts` and
      // `experts`. A member added AFTER the curator's expert was retired must
      // not commit, because committing would leave the published project with
      // zero ELIGIBLE curators.
      const projectId = await insertProject();
      const curatorExpert = await insertExpert();
      await seedRelation(projectId, curatorExpert, "curator");
      await publishProject(projectId);
      await pool.query(
        `UPDATE experts SET status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [curatorExpert],
      );

      const res = await createRelation({
        payload: {
          projectId,
          expertId: await insertExpert(),
          role: "member",
        },
      });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("PUBLISHED_PROJECT_REQUIRES_CURATOR");
    });

    // ── replace-curator ────────────────────────────────────────────────────

    it("012 EARS-9: when the operator hands the curator seat over, the system shall demote the incumbent and promote the candidate in one transaction and bump the PROJECT's version", async () => {
      const projectId = await insertProject();
      const incumbentExpert = await insertExpert();
      const incumbent = await seedRelation(
        projectId,
        incumbentExpert,
        "curator",
      );
      await publishProject(projectId);
      const candidateExpert = await insertExpert();

      const res = await replaceCurator(projectId, {
        payload: { expertId: candidateExpert },
        ifMatch: `"${await projectVersion(projectId)}"`,
      });
      expect(res.statusCode, res.payload).toBe(200);
      const detail = body(res);
      expect(detail).toMatchObject({
        projectId,
        expertId: candidateExpert,
        role: "curator",
        status: "active",
      });
      // The ETag is the PROJECT's — the client asserted the project's version,
      // so the validator it echoes next has to be the project's too.
      expect(res.headers.etag).toBe(`W/"${await projectVersion(projectId)}"`);

      // Demote-FIRST is what let both writes live in one transaction: the
      // immediate partial unique index never saw two curators.
      expect(await relationRow(incumbent.detail.id)).toMatchObject({
        role: "member",
        status: "active",
        version: 2,
      });
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM project_experts
          WHERE project_id = $1 AND status = 'active' AND role = 'curator'`,
        [projectId],
      );
      expect(rows[0]!.n).toBe("1");
    });

    it("012 EARS-9: when the candidate already has a RETIRED relation, the handover shall restore and promote that row rather than fork the pair", async () => {
      const projectId = await insertProject();
      await seedRelation(projectId, await insertExpert(), "curator");
      const candidateExpert = await insertExpert();
      const past = await seedRelation(projectId, candidateExpert, "member");
      await transitionRelation(past.detail.id, "retire", { ifMatch: past.etag });
      await publishProject(projectId);

      const res = await replaceCurator(projectId, {
        payload: { expertId: candidateExpert },
        ifMatch: `"${await projectVersion(projectId)}"`,
      });
      expect(res.statusCode, res.payload).toBe(200);
      // The SAME row: the relation's history is not forked by a second insert.
      expect(body(res).id).toBe(past.detail.id);
      expect(await relationRow(past.detail.id)).toMatchObject({
        role: "curator",
        status: "active",
      });
    });

    it("012 EARS-9: when the candidate stops being eligible before the handover takes its locks, the system shall abort the whole transaction and leave exactly one eligible curator", async () => {
      // The Issue-named race, made deterministic: the candidate's expert is
      // retired between the seed read and the command, so the in-transaction
      // re-read finds it ineligible. Because the demote is written FIRST, the
      // only thing standing between that and a curator-less published project
      // is the rollback — this asserts the rollback, not the check.
      const projectId = await insertProject();
      const incumbentExpert = await insertExpert();
      const incumbent = await seedRelation(
        projectId,
        incumbentExpert,
        "curator",
      );
      await publishProject(projectId);
      const candidateExpert = await insertExpert();
      await pool.query(
        `UPDATE experts SET status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [candidateExpert],
      );

      const res = await replaceCurator(projectId, {
        payload: { expertId: candidateExpert },
        ifMatch: `"${await projectVersion(projectId)}"`,
      });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("PUBLISHED_PROJECT_REQUIRES_CURATOR");

      // Rollback restored the incumbent: still the curator, still at version 1,
      // and the candidate has no relation row at all.
      expect(await relationRow(incumbent.detail.id)).toMatchObject({
        role: "curator",
        status: "active",
        version: 1,
      });
      const { rows } = await pool.query(
        "SELECT id FROM project_experts WHERE expert_id = $1",
        [candidateExpert],
      );
      expect(rows).toHaveLength(0);
    });

    it("012 EARS-9: the handover shall assert the PROJECT's version, and refuse a missing or stale one", async () => {
      const projectId = await insertProject();
      await seedRelation(projectId, await insertExpert(), "curator");
      await publishProject(projectId);
      const candidateExpert = await insertExpert();

      const absent = await replaceCurator(projectId, {
        payload: { expertId: candidateExpert },
      });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await replaceCurator(projectId, {
        payload: { expertId: candidateExpert },
        ifMatch: '"99"',
      });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");
    });

    it("012 EARS-9: handing the seat to the expert who already holds it shall be refused as an invalid transition", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      await seedRelation(projectId, expertId, "curator");
      await publishProject(projectId);

      const res = await replaceCurator(projectId, {
        payload: { expertId },
        ifMatch: `"${await projectVersion(projectId)}"`,
      });
      expect(res.statusCode).toBe(409);
      expect(problem(res).errorCode).toBe("INVALID_TRANSITION");
    });

    // ── EARS-16 / EARS-17 cross-cutting ────────────────────────────────────

    it("012 EARS-9: when a create is replayed with the same Idempotency-Key, the system shall answer the stored outcome without a second relation", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      const k = key();
      const payload = { projectId, expertId, role: "member" };
      const first = await createRelation({ payload, idempotencyKey: k });
      expect(first.statusCode).toBe(201);
      const replay = await createRelation({ payload, idempotencyKey: k });
      expect(replay.statusCode).toBe(201);
      expect(body(replay)).toEqual(body(first));
      expect(replay.headers.etag).toBe(first.headers.etag);
      expect(replay.headers.location).toBe(first.headers.location);
      const { rows } = await pool.query(
        "SELECT id FROM project_experts WHERE project_id = $1",
        [projectId],
      );
      expect(rows).toHaveLength(1);
    });

    it("012 EARS-9: when a mutation carries no Idempotency-Key, the system shall refuse it before touching the payload", async () => {
      const res = await createRelation({
        // Deliberately invalid payload too: the key check must answer FIRST.
        payload: { projectId: "nope", expertId: "nope", role: "boss" },
        idempotencyKey: "",
      });
      expect(res.statusCode).toBe(428);
      expect(problem(res).errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("012 EARS-9: when the payload is outside its §5.1 shape, the system shall refuse it before any write", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      const bad: Array<Record<string, unknown>> = [
        { role: "boss" },
        { role: "" },
        { projectId: "not-a-uuid" },
        // Strict objects: a misspelled key is a contract mismatch, not a value
        // to ignore silently.
        { expertID: randomUUID() },
        { status: "active" },
      ];
      for (const override of bad) {
        const res = await createRelation({
          payload: { projectId, expertId, role: "member", ...override },
        });
        expect(res.statusCode, JSON.stringify(override)).toBe(400);
        expect(problem(res).errorCode).toBe("VALIDATION_FAILED");
      }
      const { rows } = await pool.query(
        "SELECT id FROM project_experts WHERE project_id = $1",
        [projectId],
      );
      expect(rows).toHaveLength(0);
    });

    it("012 EARS-9: when an edit carries no If-Match or a stale one, the system shall refuse it", async () => {
      const projectId = await insertProject();
      const { detail, etag } = await seedRelation(
        projectId,
        await insertExpert(),
        "member",
      );
      const absent = await patchRelation(detail.id, {
        payload: { role: "curator" },
      });
      expect(absent.statusCode).toBe(428);
      expect(problem(absent).errorCode).toBe("PRECONDITION_REQUIRED");

      const stale = await patchRelation(detail.id, {
        payload: { role: "curator" },
        ifMatch: '"99"',
      });
      expect(stale.statusCode).toBe(412);
      expect(problem(stale).errorCode).toBe("PRECONDITION_FAILED");

      const fresh = await patchRelation(detail.id, {
        payload: { role: "curator" },
        ifMatch: etag,
      });
      expect(fresh.statusCode, fresh.payload).toBe(200);
      expect(body(fresh)).toMatchObject({ role: "curator", version: 2 });
    });

    it("012 EARS-9: an absent or non-UUID relation id shall be indistinguishable from a real one that is not there", async () => {
      const absent = await readRelation(randomUUID());
      expect(absent.statusCode).toBe(404);
      expect(problem(absent).errorCode).toBe("RESOURCE_NOT_FOUND");
      const nonUuid = await readRelation("not-a-uuid");
      expect(nonUuid.statusCode).toBe(404);
      expect(problem(nonUuid).errorCode).toBe("RESOURCE_NOT_FOUND");
    });

    it("012 EARS-9: the admin list shall filter by project, by expert and by role, with retired relations excluded by default", async () => {
      const projectId = await insertProject();
      const firstExpert = await insertExpert();
      const a = await seedRelation(projectId, firstExpert, "curator");
      const b = await seedRelation(projectId, await insertExpert(), "member");
      await transitionRelation(b.detail.id, "retire", { ifMatch: b.etag });

      const listed = await app.inject({
        method: "GET",
        url: `/v1/admin/project-experts?projectId=${projectId}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(listed.statusCode).toBe(200);
      const page = JSON.parse(listed.payload) as {
        data: RelationDetail[];
        total: number;
      };
      expect(page.data.map((r) => r.id)).toEqual([a.detail.id]);
      expect(page.total).toBe(1);

      const withRetired = await app.inject({
        method: "GET",
        url: `/v1/admin/project-experts?projectId=${projectId}&includeRetired=true`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(withRetired.payload) as { data: RelationDetail[] }).data
          .map((r) => r.id)
          .sort(),
      ).toEqual([a.detail.id, b.detail.id].sort());

      const byExpert = await app.inject({
        method: "GET",
        url: `/v1/admin/project-experts?expertId=${firstExpert}&role=curator`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(
        (JSON.parse(byExpert.payload) as { data: RelationDetail[] }).data.map(
          (r) => r.id,
        ),
      ).toEqual([a.detail.id]);
    });

    // ── §5.2 public traversals ─────────────────────────────────────────────

    it("012 EARS-9: the public project→experts read shall answer exactly PublicExpertSummary + role, in a stable cursor-paged name order", async () => {
      const projectId = await insertProject();
      const first = await insertExpert({ name: "Аронов А. А." });
      const second = await insertExpert({ name: "Яковлев Я. Я." });
      await seedRelation(projectId, first, "curator");
      await seedRelation(projectId, second, "member");
      await publishProject(projectId);
      const { rows } = await pool.query<{ slug: string }>(
        "SELECT slug FROM projects WHERE id = $1",
        [projectId],
      );

      const page = await publicGet(
        `/v1/public/projects/${projectId}/experts?limit=1`,
      );
      expect(page.statusCode, page.payload).toBe(200);
      expect(page.headers["cache-control"]).toBe("public, max-age=30");
      const first_ = JSON.parse(page.payload) as {
        data: Array<Record<string, unknown>>;
        pagination: { nextCursor: string | null; hasMore: boolean };
      };
      expect(first_.data).toHaveLength(1);
      expect(first_.data[0]).toMatchObject({
        id: first,
        name: "Аронов А. А.",
        role: "curator",
      });
      // The §5.2 shape is CLOSED — no status, no relation id, no admin field.
      expect(Object.keys(first_.data[0]!).sort()).toEqual([
        "affiliation",
        "credentials",
        "id",
        "name",
        "photoUrl",
        "professionalRole",
        "role",
        "slug",
      ]);
      expect(first_.pagination.hasMore).toBe(true);

      const next = await publicGet(
        `/v1/public/projects/${projectId}/experts?limit=1&cursor=${encodeURIComponent(
          first_.pagination.nextCursor!,
        )}`,
      );
      const second_ = JSON.parse(next.payload) as {
        data: Array<Record<string, unknown>>;
        pagination: { hasMore: boolean };
      };
      expect(second_.data[0]).toMatchObject({ id: second, role: "member" });
      expect(second_.pagination.hasMore).toBe(false);

      // The slug resolves to the same page as the id.
      const bySlug = await publicGet(
        `/v1/public/projects/${rows[0]!.slug}/experts`,
      );
      expect(
        (JSON.parse(bySlug.payload) as { data: Array<{ id: string }> }).data.map(
          (r) => r.id,
        ),
      ).toEqual([first, second]);
    });

    it("012 EARS-9: the public expert→projects read shall answer exactly PublicProjectSummary + role", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      await seedRelation(projectId, expertId, "curator");
      await publishProject(projectId);

      const res = await publicGet(`/v1/public/experts/${expertId}/projects`);
      expect(res.statusCode, res.payload).toBe(200);
      const page = JSON.parse(res.payload) as {
        data: Array<Record<string, unknown>>;
      };
      expect(page.data[0]).toMatchObject({
        id: projectId,
        kind: "school",
        role: "curator",
        // Populated by the ONE shared summary mapper; null until #1292's
        // relation makes it non-null.
        primaryPartner: null,
      });
      expect(Object.keys(page.data[0]!).sort()).toEqual([
        "coverUrl",
        "description",
        "id",
        "kind",
        "primaryPartner",
        "role",
        "slug",
        "title",
      ]);
    });

    it("012 EARS-9: a not-publicly-eligible endpoint shall be 404 on both directions, while an eligible one with no relations is an ordinary EMPTY page", async () => {
      // A draft leaks no "exists but private" oracle: the answer is exactly the
      // answer an unknown id gets.
      const draftProject = await insertProject();
      const draftExpert = await insertExpert({
        status: "draft",
        first_published_at: null,
      });
      await seedRelation(draftProject, draftExpert, "member");

      for (const url of [
        `/v1/public/projects/${draftProject}/experts`,
        `/v1/public/projects/${randomUUID()}/experts`,
        `/v1/public/experts/${draftExpert}/projects`,
        `/v1/public/experts/${randomUUID()}/projects`,
      ]) {
        const res = await publicGet(url);
        expect(res.statusCode, url).toBe(404);
        expect(problem(res).errorCode).toBe("RESOURCE_NOT_FOUND");
      }

      const emptyProject = await insertProject();
      await publishProject(emptyProject);
      const empty = await publicGet(
        `/v1/public/projects/${emptyProject}/experts`,
      );
      expect(empty.statusCode).toBe(200);
      expect(JSON.parse(empty.payload)).toMatchObject({
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it("012 EARS-9: a cursor this API did not issue shall be refused as a 400, never reach the query as an operand", async () => {
      // The cursor is caller-supplied bytes on a ZERO-AUTH route: a decoded
      // non-UUID `id` would hit a `uuid` column as Postgres 22P02 — a 500 for
      // what EARS-16 contracts as a 400.
      const projectId = await insertProject();
      await publishProject(projectId);
      const tampered = Buffer.from(
        JSON.stringify({ name: "", id: "'; DROP TABLE project_experts; --" }),
        "utf8",
      ).toString("base64url");

      for (const cursor of [tampered, "not-base64url-json"]) {
        const res = await publicGet(
          `/v1/public/projects/${projectId}/experts?cursor=${encodeURIComponent(
            cursor,
          )}`,
        );
        expect(res.statusCode, cursor).toBe(400);
        expect(problem(res).errorCode).toBe("CURSOR_INVALID");
      }
    });
  },
);
