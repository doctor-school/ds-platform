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
import { LIFECYCLE_IMPACT_TOKEN_TTL_MS } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { LifecycleImpactService } from "../../src/taxonomy/lifecycle-impact.service.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 012 EARS-6 (#1288) — the event↔project relationship vertical over the REAL
// stack: Fastify + the 011 admin session + Postgres.
//
// What is genuinely specific to THIS vertical, and therefore what this suite
// spends its assertions on:
//
// 1. **Retained identity.** A relationship is created once and never deleted.
//    Retire and restore move the SAME row, keeping the SAME id — so a create
//    against a retired pair is a 409 that says "restore it", not a second row.
// 2. **The §3.1 lifecycle-impact gate.** A transition cannot be confirmed
//    without a preview: the confirmation quotes a signed token that binds the
//    transition, the target version and a fingerprint of the discovered set.
//    Anything that moved in between is 412 with ZERO mutation — no domain row,
//    no audit row, no idempotency completion.
// 3. **The §5.2 public traversals** in both directions, with exact DTO shapes.
//
// Skips when the stand is absent, exactly as the sibling admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-6 event↔project relationship vertical (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let impact: LifecycleImpactService;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdRelationIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;

    const ADMIN_BASE = "/v1/admin/event-projects";

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
      const email = uniqueEmail("evp-admin");
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

    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds1288${Math.random().toString(16).slice(2)}`;
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

    /**
     * A draft event through the 007 EARS-1 create endpoint. `publish: true`
     * moves it to the publish-visible state the §5.2 traversals require —
     * through the REAL lifecycle command, never a status flipped behind it.
     */
    async function makeEvent(
      publish: boolean,
    ): Promise<{ id: string; slug: string; title: string }> {
      const title = `ХСН ${Math.random().toString(36).slice(2, 8)}`;
      const mp = multipartBody({
        payload: JSON.stringify({
          title,
          school: "Кардиология",
          startsAtMsk: "2026-11-17T19:00",
          durationMin: 90,
          specialties: ["cardiology"],
        }),
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; slug: string; version: number };
      createdEventIds.push(body.id);
      if (publish) {
        const done = await app.inject({
          method: "POST",
          url: `/v1/admin/events/${body.id}/publish`,
          // `publish` is conditional (#1593); the create response is itself a
          // detail read, so it already carries the validator to echo.
          headers: {
            ...device,
            ...adminHeaders(adminSid),
            "if-match": `"${body.version}"`,
          },
        });
        expect(done.statusCode).toBe(200);
      }
      return { id: body.id, slug: body.slug, title };
    }

    /**
     * A project through the 012 EARS-1 create endpoint. It lands `draft`: the
     * project publish command is a later slice (#1294), so a suite that needs a
     * PUBLISHED project sets the column directly. That is fixture setup for
     * ANOTHER aggregate, not a shortcut around this vertical's own contract —
     * every event↔project route under test is exercised through HTTP.
     */
    async function makeProject(
      published: boolean,
    ): Promise<{ id: string; slug: string; title: string }> {
      const title = `Школа ${Math.random().toString(36).slice(2, 8)}`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: {
          kind: "school",
          title,
          description: "Программа для практикующих кардиологов.",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; slug: string };
      createdProjectIds.push(body.id);
      if (published) {
        // `projects_published_has_first_published_at` is a table CHECK: a
        // published row without its first-publication stamp is not a state the
        // schema admits, so the fixture writes the pair the publish command
        // would have written, never a half-state the DB would reject.
        await pool.query(
          "UPDATE projects SET status = 'published', first_published_at = now() WHERE id = $1",
          [body.id],
        );
      }
      return { id: body.id, slug: body.slug, title };
    }

    interface RelationBody {
      id: string;
      eventId: string;
      projectId: string;
      eventTitle: string;
      projectTitle: string;
      status: string;
      version: number;
      [k: string]: unknown;
    }

    async function relate(
      eventId: string,
      projectId: string,
      opts: { idempotencyKey?: string } = {},
    ) {
      return app.inject({
        method: "POST",
        url: ADMIN_BASE,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          ...(opts.idempotencyKey === ""
            ? {}
            : { "idempotency-key": opts.idempotencyKey ?? key() }),
        },
        payload: { eventId, projectId },
      });
    }

    /** Create a relationship and track it for teardown. */
    async function relation(
      eventId: string,
      projectId: string,
    ): Promise<RelationBody> {
      const res = await relate(eventId, projectId);
      expect(res.statusCode).toBe(201);
      const body = res.json() as RelationBody;
      createdRelationIds.push(body.id);
      return body;
    }

    interface Preview {
      transition: string;
      version: number;
      affected: {
        kind: string;
        id: string;
        title: string;
        slug: string | null;
        status: string;
      }[];
      impactToken: string;
    }

    async function preview(id: string, transition: string) {
      return app.inject({
        method: "GET",
        url: `${ADMIN_BASE}/${id}/lifecycle-impact?transition=${transition}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
    }

    async function previewed(id: string, transition: string): Promise<Preview> {
      const res = await preview(id, transition);
      expect(res.statusCode).toBe(200);
      return res.json() as Preview;
    }

    /** Confirm a transition. Every header is individually overridable so a
     * reject branch can omit exactly one of them and nothing else. */
    async function confirm(
      id: string,
      transition: string,
      opts: {
        version?: number;
        ifMatch?: string | null;
        token?: string | null;
        idempotencyKey?: string;
      },
    ) {
      const headers: Record<string, string> = {
        ...device,
        ...adminHeaders(adminSid),
        "content-type": "application/json",
      };
      if (opts.idempotencyKey !== "") {
        headers["idempotency-key"] = opts.idempotencyKey ?? key();
      }
      const ifMatch =
        opts.ifMatch === undefined ? `W/"${opts.version}"` : opts.ifMatch;
      if (ifMatch !== null) headers["if-match"] = ifMatch;
      if (opts.token !== null && opts.token !== undefined) {
        headers["lifecycle-impact-token"] = opts.token;
      }
      return app.inject({
        method: "POST",
        url: `${ADMIN_BASE}/${id}/${transition}`,
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

    /** The signed payload of an impact token, so a test can re-sign a variant. */
    function tokenPayload(token: string): {
      t: string;
      k: string;
      i: string;
      v: number;
      f: string;
    } {
      const [payload] = token.split(".");
      return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    }

    async function relationRow(
      id: string,
    ): Promise<{ status: string; version: number; deleted_at: string | null }> {
      const { rows } = await pool.query<{
        status: string;
        version: number;
        deleted_at: string | null;
      }>(
        "SELECT status, version, deleted_at FROM event_projects WHERE id = $1",
        [id],
      );
      return rows[0]!;
    }

    async function auditCount(id: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        // The 010 trail addresses a row by its `data.<table>.<op>` event type
        // plus the primary key in `metadata -> 'pk'` (the ledger has no
        // per-entity column) — the same shape `test/audit/*` reads.
        `SELECT count(*)::text AS count FROM audit_ledger
          WHERE event_type LIKE 'data.event_projects.%'
            AND metadata -> 'pk' ->> 'id' = $1`,
        [id],
      );
      return Number(rows[0]!.count);
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
      impact = app.get(LifecycleImpactService);
      adminSid = await adminSession();
    });

    afterEach(async () => {
      // Relationships first: they hold RESTRICT references into both endpoints.
      for (const id of createdRelationIds.splice(0)) {
        await pool.query("DELETE FROM event_projects WHERE id = $1", [id]);
      }
      for (const id of createdEventIds.splice(0)) {
        await deleteEventFixture(pool, id);
      }
      for (const id of createdProjectIds.splice(0)) {
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
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

    it("012 EARS-6: when a platform_admin relates a project to an event, the system shall persist one active relationship at version 1 with both endpoints' display forms and an ETag", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);

      const res = await relate(event.id, project.id);
      expect(res.statusCode).toBe(201);
      const body = res.json() as RelationBody;
      createdRelationIds.push(body.id);

      expect(body).toMatchObject({
        eventId: event.id,
        eventTitle: event.title,
        eventSlug: event.slug,
        projectId: project.id,
        projectTitle: project.title,
        projectSlug: project.slug,
        status: "active",
        version: 1,
      });
      expect(res.headers.etag).toBe('W/"1"');
      expect(res.headers.location).toBe(`${ADMIN_BASE}/${body.id}`);

      // The SAME row is what the detail read renders — no second copy.
      const detail = await app.inject({
        method: "GET",
        url: `${ADMIN_BASE}/${body.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as RelationBody).id).toBe(body.id);
      expect(detail.headers.etag).toBe('W/"1"');
    });

    it("012 EARS-6: when a relationship between two publicly visible endpoints is previewed for retirement, the system shall list it as affected with a non-null title and hand back a signed impact token", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const p = await previewed(rel.id, "retire");
      expect(p.transition).toBe("retire");
      expect(p.version).toBe(1);
      expect(p.impactToken).toBeTypeOf("string");
      expect(p.affected).toHaveLength(1);
      expect(p.affected[0]).toMatchObject({
        kind: "event↔project",
        id: rel.id,
        slug: null,
        status: "active",
      });
      // §3.1: the display title is never null — an operator confirming a
      // consequence must be able to read WHICH relationship it is.
      expect(p.affected[0]!.title).toContain(event.title);
      expect(p.affected[0]!.title).toContain(project.title);
    });

    it("012 EARS-6: when a previewed retirement is confirmed and then restored, the system shall move the SAME relationship row and keep its id, never re-inserting a second one", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const retired = await move(rel.id, "retire");
      expect(retired.statusCode).toBe(200);
      expect((retired.json() as RelationBody).id).toBe(rel.id);
      expect((retired.json() as RelationBody).status).toBe("retired");
      expect(retired.headers.etag).toBe('W/"2"');
      expect(await relationRow(rel.id)).toMatchObject({
        status: "retired",
        version: 2,
      });
      expect((await relationRow(rel.id)).deleted_at).not.toBeNull();

      const restored = await move(rel.id, "restore");
      expect(restored.statusCode).toBe(200);
      const back = restored.json() as RelationBody;
      // The identity a sponsor report or an audit trail already cites survives.
      expect(back.id).toBe(rel.id);
      expect(back.status).toBe("active");
      expect(back.version).toBe(3);
      expect(restored.headers.etag).toBe('W/"3"');
      expect((await relationRow(rel.id)).deleted_at).toBeNull();

      // Exactly one row for this pair has ever existed.
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_projects WHERE event_id = $1 AND project_id = $2",
        [event.id, project.id],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("012 EARS-6: when a publicly visible event is traversed, the system shall answer exactly the PublicProjectSummary page of its publicly visible projects", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      await relation(event.id, project.id);

      for (const url of [
        `/v1/public/events/${event.id}/projects`,
        `/v1/public/events/${event.slug}/projects`,
      ]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode).toBe(200);
        const page = res.json() as {
          data: Record<string, unknown>[];
          pagination: { nextCursor: string | null; hasMore: boolean };
        };
        expect(page.pagination).toEqual({ nextCursor: null, hasMore: false });
        expect(page.data).toHaveLength(1);
        // DTO exactness: the disclosure boundary is the key SET, not a subset.
        expect(Object.keys(page.data[0]!).sort()).toEqual(
          [
            "coverUrl",
            "description",
            "id",
            "kind",
            "primaryPartner",
            "slug",
            "title",
          ].sort(),
        );
        expect(page.data[0]).toMatchObject({
          id: project.id,
          slug: project.slug,
          title: project.title,
          kind: "school",
          // `project_partners` (#1291) does not exist yet, so no project HAS a
          // partner — null is the truthful value, not a placeholder.
          primaryPartner: null,
        });
      }
    });

    it("012 EARS-6: when a published project is traversed, the system shall answer exactly the PublicEventSummary page of its publicly visible events", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      await relation(event.id, project.id);

      for (const url of [
        `/v1/public/projects/${project.id}/events`,
        `/v1/public/projects/${project.slug}/events`,
      ]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode).toBe(200);
        const page = res.json() as { data: Record<string, unknown>[] };
        expect(page.data).toHaveLength(1);
        expect(Object.keys(page.data[0]!).sort()).toEqual(
          ["id", "school", "slug", "startsAt", "state", "title"].sort(),
        );
        expect(page.data[0]).toMatchObject({
          id: event.id,
          slug: event.slug,
          title: event.title,
          state: "published",
        });
      }
    });

    it("012 EARS-6: when a publicly visible event has no relationships, the system shall answer an empty page rather than a not-found", async () => {
      const event = await makeEvent(true);
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.slug}/projects`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it("012 EARS-6: when a relationship is retired, the system shall drop it from BOTH public traversals while keeping it addressable to an admin", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);
      expect((await move(rel.id, "retire")).statusCode).toBe(200);

      const forward = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.id}/projects`,
      });
      expect((forward.json() as { data: unknown[] }).data).toHaveLength(0);
      const reverse = await app.inject({
        method: "GET",
        url: `/v1/public/projects/${project.id}/events`,
      });
      expect((reverse.json() as { data: unknown[] }).data).toHaveLength(0);

      const detail = await app.inject({
        method: "GET",
        url: `${ADMIN_BASE}/${rel.id}`,
        headers: { ...device, ...adminHeaders(adminSid) },
      });
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as RelationBody).status).toBe("retired");
    });

    // ── Reject branches ────────────────────────────────────────────────────

    it("012 EARS-6: when a draft endpoint is traversed publicly, the system shall answer 404, indistinguishable from an unknown one", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);
      await relation(event.id, project.id);

      const draftSource = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.id}/projects`,
      });
      expect(draftSource.statusCode).toBe(404);
      const unknownSource = await app.inject({
        method: "GET",
        url: `/v1/public/events/${randomUUID()}/projects`,
      });
      expect(unknownSource.statusCode).toBe(404);

      // Indistinguishable means the REFUSAL is identical. `instance` echoes the
      // URL the caller themselves asked for and `traceId` is per-request — both
      // are already known to the caller, so neither can disclose whether the id
      // exists. Everything else must match byte for byte: a draft event that
      // answered with a different title, type or errorCode would be an existence
      // oracle for unpublished content.
      const shape = (raw: unknown): Record<string, unknown> => {
        const {
          instance: _i,
          traceId: _t,
          ...rest
        } = raw as Record<string, unknown>;
        return rest;
      };
      expect(shape(draftSource.json())).toEqual(shape(unknownSource.json()));
      expect(shape(draftSource.json())).toEqual({
        type: "https://docs.doctor.school/errors/resource-not-found",
        title: "Not found",
        status: 404,
        errorCode: "RESOURCE_NOT_FOUND",
      });
      // The echoed instance is the caller's own path and carries nothing else.
      expect((draftSource.json() as { instance?: string }).instance).toBe(
        `/v1/public/events/${event.id}/projects`,
      );
    });

    it("012 EARS-6: when the same pair is related twice, the system shall refuse the second with 409 and persist no second row", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);
      await relation(event.id, project.id);

      const again = await relate(event.id, project.id);
      expect(again.statusCode).toBe(409);
      expect((again.json() as { errorCode?: string }).errorCode).toBe(
        "RELATIONSHIP_CONFLICT",
      );
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_projects WHERE event_id = $1 AND project_id = $2",
        [event.id, project.id],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("012 EARS-6: when a RETIRED pair is related again, the system shall refuse with 409 and tell the operator to restore the existing relationship", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);
      const rel = await relation(event.id, project.id);
      expect((await move(rel.id, "retire")).statusCode).toBe(200);

      const again = await relate(event.id, project.id);
      expect(again.statusCode).toBe(409);
      const body = again.json() as { errorCode?: string; detail?: string };
      expect(body.errorCode).toBe("RELATIONSHIP_CONFLICT");
      expect(String(body.detail)).toContain("restore");
      // Refusing is not enough: the retired row must be untouched.
      expect(await relationRow(rel.id)).toMatchObject({
        status: "retired",
        version: 2,
      });
    });

    it("012 EARS-6: when a transition is confirmed without a Lifecycle-Impact-Token, the system shall answer 428 and change nothing", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const before = await auditCount(rel.id);
      const res = await confirm(rel.id, "retire", { version: 1, token: null });
      expect(res.statusCode).toBe(428);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "LIFECYCLE_IMPACT_REQUIRED",
      );
      expect(await relationRow(rel.id)).toMatchObject({
        status: "active",
        version: 1,
      });
      expect(await auditCount(rel.id)).toBe(before);
    });

    it("012 EARS-6: when a transition is confirmed without an If-Match, the system shall answer 428 before it ever looks at the impact token", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const res = await confirm(rel.id, "retire", {
        ifMatch: null,
        token: null,
      });
      expect(res.statusCode).toBe(428);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "PRECONDITION_REQUIRED",
      );
    });

    it("012 EARS-6: when a transition quotes an unusable If-Match, the system shall answer 412 rather than treating it as no precondition", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);
      const p = await previewed(rel.id, "retire");

      const res = await confirm(rel.id, "retire", {
        ifMatch: "not-an-etag",
        token: p.impactToken,
      });
      expect(res.statusCode).toBe(412);
      expect(await relationRow(rel.id)).toMatchObject({
        status: "active",
        version: 1,
      });
    });

    it("012 EARS-6: when the discovered set changes between preview and confirmation, the system shall answer 412 LIFECYCLE_IMPACT_STALE with zero domain and zero audit mutation", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const p = await previewed(rel.id, "retire");
      // A SECOND relationship on the same event: the transition's discovered
      // set is every relation sharing either endpoint, so the operator is now
      // looking at a screen that no longer describes the consequences.
      const other = await makeProject(true);
      await relation(event.id, other.id);

      const before = await auditCount(rel.id);
      const res = await confirm(rel.id, "retire", {
        version: p.version,
        token: p.impactToken,
      });
      expect(res.statusCode).toBe(412);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "LIFECYCLE_IMPACT_STALE",
      );
      expect(await relationRow(rel.id)).toMatchObject({
        status: "active",
        version: 1,
      });
      expect(await auditCount(rel.id)).toBe(before);

      // And the refusal is not a dead end: a fresh preview confirms cleanly.
      expect((await move(rel.id, "retire")).statusCode).toBe(200);
    });

    it("012 EARS-6: when a token issued for the OTHER transition is presented, the system shall answer 412 and change nothing", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const p = await previewed(rel.id, "retire");
      // Re-sign the identical discovered set under the restore transition — the
      // envelope binds WHICH move it authorizes, not merely which rows moved.
      const forged = impact.issue({
        transition: "restore",
        targetKind: "event↔project",
        targetId: rel.id,
        targetVersion: p.version,
        fingerprint: tokenPayload(p.impactToken).f,
      });

      const res = await confirm(rel.id, "retire", {
        version: p.version,
        token: forged,
      });
      expect(res.statusCode).toBe(412);
      expect(await relationRow(rel.id)).toMatchObject({
        status: "active",
        version: 1,
      });
    });

    it("012 EARS-6: when an expired impact token is presented, the system shall answer 412 — a preview an operator read an hour ago no longer describes anything", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const p = await previewed(rel.id, "retire");
      const payload = tokenPayload(p.impactToken);
      const stale = impact.issue(
        {
          transition: "retire",
          targetKind: "event↔project",
          targetId: rel.id,
          targetVersion: p.version,
          fingerprint: payload.f,
        },
        Date.now() - LIFECYCLE_IMPACT_TOKEN_TTL_MS - 60_000,
      );

      const res = await confirm(rel.id, "retire", {
        version: p.version,
        token: stale,
      });
      expect(res.statusCode).toBe(412);
      expect(await relationRow(rel.id)).toMatchObject({
        status: "active",
        version: 1,
      });
    });

    it("012 EARS-6: when a tampered impact token is presented, the system shall answer 412 with the SAME undifferentiated refusal as a stale one", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);
      const p = await previewed(rel.id, "retire");

      const [payload, sig] = p.impactToken.split(".");
      const flipped = `${payload}.${sig!.slice(0, -1)}${
        sig!.endsWith("A") ? "B" : "A"
      }`;
      const res = await confirm(rel.id, "retire", {
        version: p.version,
        token: flipped,
      });
      expect(res.statusCode).toBe(412);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "LIFECYCLE_IMPACT_STALE",
      );
    });

    it("012 EARS-6: when the transition already in effect is previewed, the system shall answer 409 rather than treating it as a no-op", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      const rel = await relation(event.id, project.id);

      const res = await preview(rel.id, "restore");
      expect(res.statusCode).toBe(409);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "INVALID_TRANSITION",
      );
    });

    it("012 EARS-6: when a relationship is created without an Idempotency-Key, the system shall refuse before persisting anything", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);

      const res = await relate(event.id, project.id, { idempotencyKey: "" });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_projects WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("012 EARS-17: when the identical create is retried under the same Idempotency-Key, the system shall replay the stored outcome instead of relating twice", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);
      const k = key();

      const first = await relate(event.id, project.id, { idempotencyKey: k });
      expect(first.statusCode).toBe(201);
      const body = first.json() as RelationBody;
      createdRelationIds.push(body.id);

      const replay = await relate(event.id, project.id, { idempotencyKey: k });
      expect(replay.statusCode).toBe(201);
      expect((replay.json() as RelationBody).id).toBe(body.id);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_projects WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("012 EARS-6: when a relationship names an absent or retired endpoint, the system shall refuse and persist nothing", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);

      const absentEvent = await relate(randomUUID(), project.id);
      expect(absentEvent.statusCode).toBe(404);
      const absentProject = await relate(event.id, randomUUID());
      expect(absentProject.statusCode).toBe(404);

      // `projects_retired_iff_deleted` — retirement is the status AND the
      // soft-delete stamp together; the fixture may not invent a half-retired row.
      await pool.query(
        "UPDATE projects SET status = 'retired', deleted_at = now() WHERE id = $1",
        [project.id],
      );
      const retiredProject = await relate(event.id, project.id);
      expect(retiredProject.statusCode).toBe(409);

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_projects WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("012 EARS-6: the relationship surface shall expose no PATCH route — the join carries no attribute to edit", async () => {
      const event = await makeEvent(false);
      const project = await makeProject(false);
      const rel = await relation(event.id, project.id);

      const res = await app.inject({
        method: "PATCH",
        url: `${ADMIN_BASE}/${rel.id}`,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
          "if-match": 'W/"1"',
        },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it("012 EARS-6: when a public traversal quotes a cursor this API never issued, the system shall refuse it rather than silently trusting it", async () => {
      const event = await makeEvent(true);
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.id}/projects?cursor=not-a-cursor`,
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "CURSOR_INVALID",
      );
    });

    it("012 EARS-6: when a public traversal quotes a DECODABLE cursor carrying values this API never issues, the system shall still refuse it as CURSOR_INVALID rather than fail on the query", async () => {
      const event = await makeEvent(true);
      const project = await makeProject(true);
      await relation(event.id, project.id);

      // A hand-edited cursor decodes fine; its VALUES are what reach SQL. A
      // non-UUID id would hit a `uuid` column as pg `22P02`, and a bogus
      // instant would blow up the driver's `toISOString()` — both 500s on a
      // ZERO-AUTH route unless the tuple is parsed before any query runs.
      const forge = (value: Record<string, string>): string =>
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

      const cases: { url: string; cursor: string }[] = [
        {
          url: `/v1/public/events/${event.id}/projects`,
          cursor: forge({ title: "anything", id: "not-a-uuid" }),
        },
        {
          url: `/v1/public/events/${event.id}/projects`,
          cursor: forge({
            startsAt: "nope",
            id: "0f4c1b6e-9d2a-4a3b-8c11-2f5e7a9b0c31",
          }),
        },
        {
          url: `/v1/public/projects/${project.id}/events`,
          cursor: forge({ startsAt: "2026-01-01T00:00:00.000Z", id: "x" }),
        },
        {
          url: `/v1/public/projects/${project.id}/events`,
          cursor: forge({
            startsAt: "nope",
            id: "0f4c1b6e-9d2a-4a3b-8c11-2f5e7a9b0c31",
          }),
        },
      ];

      for (const { url, cursor } of cases) {
        const res = await app.inject({
          method: "GET",
          url: `${url}?cursor=${encodeURIComponent(cursor)}`,
        });
        expect(res.statusCode).toBe(400);
        expect((res.json() as { errorCode?: string }).errorCode).toBe(
          "CURSOR_INVALID",
        );
      }
    });
  },
);
