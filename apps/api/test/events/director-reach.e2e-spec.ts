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
import { scanRealRouteSet } from "../../src/authz/authz.gate.js";
import {
  type AdminSessionHandle,
  establishAdminSession,
} from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassification } from "../setup/event-classification.js";
import { futureMskStart } from "../setup/wall-clock.js";

const DIRECTOR = "broadcast_director";

/**
 * 049 EARS-7 — V-6. The broadcast director's server reach is exactly the
 * «Director reach» rows of `049-design.md`: the admin event list and card,
 * create and edit, the stream config, the 007 lifecycle commands, the event's
 * experts / projects / directions links and the list (and project / expert
 * detail) reads the event screens make. Every other admin endpoint refuses it
 * with `403`; its lifecycle transitions carry its subject in `audit_ledger`;
 * once the IdP withdraws the grant, a live director row answers
 * `403 BROADCAST_DIRECTOR_REQUIRED`.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "049 EARS-7 — broadcast director reach (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    let routes: { endpoint: string; roles: readonly string[] | undefined }[];
    const password = "Aa1!ufficiently-long-pw";
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEvents: string[] = [];
    const createdExperts: string[] = [];
    const createdProjects: string[] = [];
    const createdDirections: string[] = [];
    const usedKeys: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `ears049-7-${prefix}-${Date.now()}-${Math.random()
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

    /**
     * An admin session for a principal holding exactly `roles` at the IdP —
     * the registration cascade's `doctor_guest` is revoked, so nothing passes
     * on the visitor role.
     */
    async function staff(
      prefix: string,
      roles: readonly string[],
    ): Promise<AdminSessionHandle> {
      const email = uniqueEmail(prefix);
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
      const sub = rows[0]!.zitadel_sub;
      await fake.revokeProjectRole(sub, "doctor_guest");
      for (const role of roles) await fake.grantProjectRole(sub, role);
      return establishAdminSession(app, { identifier: email, password });
    }

    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds3743${Math.random().toString(16).slice(2)}`;
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

    async function ifMatch(id: string): Promise<Record<string, string>> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM events WHERE id = $1",
        [id],
      );
      return { "if-match": `"${rows[0]!.version}"` };
    }

    function json(op: AdminSessionHandle): Record<string, string> {
      return {
        ...op.headers,
        "content-type": "application/json",
        "idempotency-key": key(),
      };
    }

    async function insertExpert(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (slug, family_name, given_name, status, first_published_at)
         VALUES ($1, 'Иванова', 'И. И.', 'published', now()) RETURNING id`,
        [`x-3743-${randomUUID()}`],
      );
      createdExperts.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function makeProject(admin: AdminSessionHandle): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: json(admin),
        payload: {
          stage: "running",
          defaultAudience: "doctors",
          title: `Школа ${Math.random().toString(36).slice(2, 8)}`,
          description: "Программа для практикующих кардиологов.",
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };
      createdProjects.push(id);
      return id;
    }

    async function makeDirection(admin: AdminSessionHandle): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/directions",
        headers: json(admin),
        payload: {
          title: `Аритмология ${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };
      createdDirections.push(id);
      return id;
    }

    /** A concrete URL for a route template: every path parameter is an absent id. */
    function concreteUrl(endpoint: string): { method: string; url: string } {
      const [method, template] = endpoint.split(" ") as [string, string];
      return {
        method,
        url: template.replace(/:[A-Za-z]+/g, randomUUID()),
      };
    }

    beforeAll(async () => {
      fake = new FakeIdpClient();
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
      const scan = await scanRealRouteSet();
      routes = scan.rows
        .filter(
          (r) =>
            r.endpoint.includes(" /v1/admin/") &&
            r.meta.access === "authenticated",
        )
        .map((r) => ({ endpoint: r.endpoint, roles: r.meta.roles }));
    }, 60_000);

    afterEach(async () => {
      for (const id of createdEvents.splice(0)) {
        for (const table of [
          "event_experts",
          "event_projects",
          "event_directions",
        ])
          await pool.query(`DELETE FROM ${table} WHERE event_id = $1`, [id]);
        await deleteEventFixture(pool, id);
      }
      for (const id of createdExperts.splice(0))
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      for (const id of createdProjects.splice(0))
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      for (const id of createdDirections.splice(0))
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      for (const k of usedKeys.splice(0))
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("049 EARS-7: a director creates, edits, configures the stream of, publishes, opens, closes and hides an event; the lifecycle audit rows carry its subject", async () => {
      const director = await staff("dir", [DIRECTOR]);

      const mp = multipartBody({
        payload: JSON.stringify({
          title: "Эфир режиссёра",
          school: "Кардиология",
          startsAtMsk: futureMskStart(30, "19:00"),
          ...eventClassification(),
          durationMin: 90,
          specialties: ["cardiology"],
        }),
      });
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: { ...director.headers, "content-type": mp.contentType },
        payload: mp.body,
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };
      createdEvents.push(id);

      const list = await app.inject({
        method: "GET",
        url: "/v1/admin/events",
        headers: director.headers,
      });
      expect(list.statusCode).toBe(200);
      const card = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${id}`,
        headers: director.headers,
      });
      expect(card.statusCode).toBe(200);
      expect(card.headers.etag).toBeDefined();

      const edit = multipartBody({
        payload: JSON.stringify({ title: "Эфир режиссёра — правка" }),
      });
      const edited = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${id}`,
        headers: {
          ...director.headers,
          ...(await ifMatch(id)),
          "content-type": edit.contentType,
        },
        payload: edit.body,
      });
      expect(edited.statusCode).toBe(200);
      expect((edited.json() as { title: string }).title).toBe(
        "Эфир режиссёра — правка",
      );

      const stream = await app.inject({
        method: "PUT",
        url: `/v1/admin/events/${id}/stream`,
        headers: {
          ...director.headers,
          ...(await ifMatch(id)),
          "content-type": "application/json",
        },
        payload: {
          provider: "rutube",
          embedRef: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
        },
      });
      expect(stream.statusCode).toBe(200);

      for (const [verb, state] of [
        ["publish", "published"],
        ["open", "live"],
        ["close", "ended"],
        ["hide", "hidden"],
      ] as const) {
        const res = await app.inject({
          method: "POST",
          url: `/v1/admin/events/${id}/${verb}`,
          headers: { ...director.headers, ...(await ifMatch(id)) },
        });
        expect(res.statusCode, verb).toBe(200);
        expect((res.json() as { state: string }).state, verb).toBe(state);
      }

      const { rows } = await pool.query<{
        event_type: string;
        subject_id: string | null;
      }>(
        `SELECT event_type, subject_id FROM audit_ledger
           WHERE metadata->>'aggregateId' = $1
             AND event_type IN ('event.published', 'event.went_live', 'event.ended', 'event.hidden')`,
        [id],
      );
      expect(rows.map((r) => r.event_type).sort()).toEqual([
        "event.ended",
        "event.hidden",
        "event.published",
        "event.went_live",
      ]);
      for (const row of rows) expect(row.subject_id).toBe(director.sub);
    }, 60_000);

    it("049 EARS-7: a director edits the event's experts, projects and directions links and makes the event screens' dictionary reads", async () => {
      const admin = await staff("pa", ["platform_admin"]);
      const director = await staff("dir", [DIRECTOR]);
      const mp = multipartBody({
        payload: JSON.stringify({
          title: "Эфир со связями",
          school: "Кардиология",
          startsAtMsk: futureMskStart(30, "19:00"),
          ...eventClassification(),
          durationMin: 90,
          specialties: ["cardiology"],
        }),
      });
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: { ...director.headers, "content-type": mp.contentType },
        payload: mp.body,
      });
      expect(created.statusCode).toBe(201);
      const eventId = (created.json() as { id: string }).id;
      createdEvents.push(eventId);
      const expertId = await insertExpert();
      const projectId = await makeProject(admin);
      const directionId = await makeDirection(admin);

      // Experts: link, reorder, retire, restore.
      const linked = await app.inject({
        method: "POST",
        url: "/v1/admin/event-experts",
        headers: json(director),
        payload: { eventId, expertId, role: "Спикер", position: 0 },
      });
      expect(linked.statusCode).toBe(201);
      const linkId = (linked.json() as { id: string }).id;
      let etag = linked.headers.etag as string;
      const moved = await app.inject({
        method: "PATCH",
        url: `/v1/admin/event-experts/${linkId}`,
        headers: { ...json(director), "if-match": etag },
        payload: { position: 1 },
      });
      expect(moved.statusCode).toBe(200);
      etag = moved.headers.etag as string;
      for (const verb of ["retire", "restore"] as const) {
        const res = await app.inject({
          method: "POST",
          url: `/v1/admin/event-experts/${linkId}/${verb}`,
          headers: { ...json(director), "if-match": etag },
          payload: {},
        });
        expect(res.statusCode, verb).toBe(200);
        etag = res.headers.etag as string;
      }

      // Projects and directions: link, then the panels' reads.
      const project = await app.inject({
        method: "POST",
        url: "/v1/admin/event-projects",
        headers: json(director),
        payload: { eventId, projectId },
      });
      expect(project.statusCode).toBe(201);
      const projectLinkId = (project.json() as { id: string }).id;
      const direction = await app.inject({
        method: "POST",
        url: "/v1/admin/event-directions",
        headers: json(director),
        payload: { eventId, directionId },
      });
      expect(direction.statusCode).toBe(201);
      const directionLinkId = (direction.json() as { id: string }).id;

      for (const url of [
        `/v1/admin/event-experts?eventId=${eventId}`,
        `/v1/admin/event-experts/${linkId}`,
        `/v1/admin/event-projects?eventId=${eventId}`,
        `/v1/admin/event-projects/${projectLinkId}`,
        `/v1/admin/event-projects/${projectLinkId}/lifecycle-impact?transition=retire`,
        `/v1/admin/event-directions?eventId=${eventId}`,
        `/v1/admin/event-directions/${directionLinkId}`,
        `/v1/admin/event-directions/${directionLinkId}/lifecycle-impact?transition=retire`,
        "/v1/admin/event-kinds",
        "/v1/admin/projects",
        `/v1/admin/projects/${projectId}`,
        "/v1/admin/experts",
        `/v1/admin/experts/${expertId}`,
        "/v1/admin/directions",
      ]) {
        const res = await app.inject({
          method: "GET",
          url,
          headers: director.headers,
        });
        expect(res.statusCode, url).toBe(200);
      }
    }, 60_000);

    it("049 EARS-7: a director is refused with 403 on every admin endpoint outside its reach — legacy broadcasts, recordings and dictionary writes included", async () => {
      const director = await staff("dir", [DIRECTOR]);
      const outside = routes.filter((r) => !r.roles?.includes(DIRECTOR));
      // The refusal set is the real route set minus the director rows, so it
      // names the legacy-broadcast, recordings and dictionary writes.
      for (const endpoint of [
        "POST /v1/admin/legacy-broadcasts",
        "POST /v1/admin/events/:id/archive-legacy",
        "POST /v1/admin/events/:id/hide-legacy",
        "POST /v1/admin/projects",
        "PATCH /v1/admin/experts/:id",
        "POST /v1/admin/directions",
        "GET /v1/admin/staff-access",
      ])
        expect(outside.map((r) => r.endpoint)).toContain(endpoint);
      expect(outside.some((r) => r.endpoint.includes("/recordings"))).toBe(
        true,
      );

      for (const { endpoint } of outside) {
        const { method, url } = concreteUrl(endpoint);
        const res = await app.inject({
          method: method as "GET",
          url,
          headers: { ...director.headers, "idempotency-key": key() },
          payload: method === "GET" ? undefined : {},
        });
        expect(res.statusCode, endpoint).toBe(403);
      }
    }, 120_000);

    it("049 EARS-7: once the IdP has withdrawn the director grant, a director-only live write answers 403 BROADCAST_DIRECTOR_REQUIRED", async () => {
      const admin = await staff("pa", ["platform_admin"]);
      const director = await staff("dir", [DIRECTOR]);
      const mp = multipartBody({
        payload: JSON.stringify({
          title: "Эфир без режиссёра",
          school: "Кардиология",
          startsAtMsk: futureMskStart(30, "19:00"),
          ...eventClassification(),
          durationMin: 90,
          specialties: ["cardiology"],
        }),
      });
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: { ...admin.headers, "content-type": mp.contentType },
        payload: mp.body,
      });
      expect(created.statusCode).toBe(201);
      const eventId = (created.json() as { id: string }).id;
      createdEvents.push(eventId);
      const expertId = await insertExpert();

      const held = (await fake.getProjectGrant(director.sub))!;
      await fake.updateProjectGrantRoles(
        director.sub,
        held.grantId,
        held.roleKeys.filter((role) => role !== DIRECTOR),
      );
      const refused = await app.inject({
        method: "POST",
        url: "/v1/admin/event-experts",
        headers: json(director),
        payload: { eventId, expertId, role: "Спикер", position: 0 },
      });
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as { errorCode: string }).errorCode).toBe(
        "BROADCAST_DIRECTOR_REQUIRED",
      );
      const { rows } = await pool.query(
        "SELECT 1 FROM event_experts WHERE event_id = $1",
        [eventId],
      );
      expect(rows).toHaveLength(0);
    }, 60_000);
  },
);
