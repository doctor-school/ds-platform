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

// 012 EARS-11 (#1293) — the event↔topic classification vertical over the REAL
// stack: Fastify + the 011 admin session + Postgres.
//
// It is the structural twin of the event↔project suite (#1288): same retained
// identity, same §3.1 lifecycle-impact gate, same §5.2 traversals. What is
// specific to THIS vertical, and therefore what the extra assertions here spend
// themselves on:
//
// 1. **Existing non-retired topics only, no inline creation.** The create body
//    carries two ids and nothing a topic could be minted from, so an unknown id
//    is a 404 and a retired one a 409 — never a topic quietly created on the fly.
// 2. **The two axes never synchronize.** `events.specialties[]` is a separate
//    classification axis; relating an event to a topic and retiring that link
//    again must leave the array byte-for-byte identical as the event resource
//    itself renders it.
//
// Skips when the stand is absent, exactly as the sibling admin suites do.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-11 event↔topic classification vertical (e2e)",
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
    const createdTopicIds: string[] = [];
    const createdRelationIds: string[] = [];
    const usedKeys: string[] = [];
    let adminSid: string;

    const ADMIN_BASE = "/v1/admin/event-topics";

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
      const email = uniqueEmail("evt-admin");
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
      const boundary = `----ds1293${Math.random().toString(16).slice(2)}`;
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
     *
     * `specialties` is set deliberately and non-trivially: it is the OTHER axis,
     * and the invariant test below reads it back through the event resource.
     */
    async function makeEvent(
      publish: boolean,
      specialties: string[] = ["cardiology", "therapy"],
    ): Promise<{ id: string; slug: string; title: string }> {
      const title = `ХСН ${Math.random().toString(36).slice(2, 8)}`;
      const mp = multipartBody({
        payload: JSON.stringify({
          title,
          school: "Кардиология",
          startsAtMsk: "2026-11-17T19:00",
          durationMin: 90,
          specialties,
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
      const body = res.json() as { id: string; slug: string };
      createdEventIds.push(body.id);
      if (publish) {
        const done = await app.inject({
          method: "POST",
          url: `/v1/admin/events/${body.id}/publish`,
          headers: { ...device, ...adminHeaders(adminSid) },
        });
        expect(done.statusCode).toBe(200);
      }
      return { id: body.id, slug: body.slug, title };
    }

    /**
     * A topic through the 012 EARS-3 create endpoint. It lands `draft`: the
     * topic publish command is a later slice, so a test that needs a PUBLISHED
     * topic sets the columns the publish command would have written. That is
     * fixture setup for ANOTHER aggregate, not a shortcut around this vertical's
     * own contract — every event↔topic route under test is exercised over HTTP.
     */
    async function makeTopic(
      published: boolean,
    ): Promise<{ id: string; slug: string; title: string }> {
      const title = `Аритмология ${Math.random().toString(36).slice(2, 8)}`;
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/directions",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { title },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; slug: string };
      createdTopicIds.push(body.id);
      if (published) {
        // `topics_published_has_first_published_at` is a table CHECK: a
        // published row without its first-publication stamp is not a state the
        // schema admits, so the fixture writes the pair the publish command
        // would have written, never a half-state the DB would reject.
        await pool.query(
          "UPDATE directions SET status = 'published', first_published_at = now() WHERE id = $1",
          [body.id],
        );
      }
      return { id: body.id, slug: body.slug, title };
    }

    interface RelationBody {
      id: string;
      eventId: string;
      topicId: string;
      eventTitle: string;
      topicTitle: string;
      status: string;
      version: number;
      [k: string]: unknown;
    }

    async function relate(
      eventId: string,
      topicId: string,
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
        payload: { eventId, topicId },
      });
    }

    /** Create a classification and track it for teardown. */
    async function relation(
      eventId: string,
      topicId: string,
    ): Promise<RelationBody> {
      const res = await relate(eventId, topicId);
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
      }>("SELECT status, version, deleted_at FROM event_topics WHERE id = $1", [
        id,
      ]);
      return rows[0]!;
    }

    async function auditCount(id: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        // The 010 trail addresses a row by its `data.<table>.<op>` event type
        // plus the primary key in `metadata -> 'pk'` (the ledger has no
        // per-entity column) — the same shape `test/audit/*` reads.
        `SELECT count(*)::text AS count FROM audit_ledger
          WHERE event_type LIKE 'data.event_topics.%'
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
      // Classifications first: they hold RESTRICT references into both endpoints.
      for (const id of createdRelationIds.splice(0)) {
        await pool.query("DELETE FROM event_topics WHERE id = $1", [id]);
      }
      for (const id of createdEventIds.splice(0)) {
        await deleteEventFixture(pool, id);
      }
      for (const id of createdTopicIds.splice(0)) {
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

    it("012 EARS-11: when a platform_admin classifies an event under a topic, the system shall persist one active relationship at version 1 with both endpoints' display forms and an ETag", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);

      const res = await relate(event.id, topic.id);
      expect(res.statusCode).toBe(201);
      const body = res.json() as RelationBody;
      createdRelationIds.push(body.id);

      expect(body).toMatchObject({
        eventId: event.id,
        eventTitle: event.title,
        eventSlug: event.slug,
        topicId: topic.id,
        topicTitle: topic.title,
        topicSlug: topic.slug,
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

    it("012 EARS-11: when an event is classified and the classification is then retired, the system shall leave events.specialties byte-for-byte unchanged — the two axes never synchronize", async () => {
      const specialties = ["cardiology", "therapy"];
      const event = await makeEvent(true, specialties);
      const topic = await makeTopic(true);

      // Read the array as the EVENT RESOURCE renders it, so the assertion covers
      // the whole write path (service, repository, trigger), not merely a column
      // no code in this vertical touches.
      const readSpecialties = async (): Promise<unknown> => {
        const res = await app.inject({
          method: "GET",
          url: `/v1/admin/events/${event.id}`,
          headers: { ...device, ...adminHeaders(adminSid) },
        });
        expect(res.statusCode).toBe(200);
        return (res.json() as { specialties: unknown }).specialties;
      };

      const before = await readSpecialties();
      expect(before).toEqual(specialties);
      // The serialized form, not a deep-equal: a reorder, a re-case or an
      // appended topic slug would survive a looser comparison.
      const beforeJson = JSON.stringify(before);

      const rel = await relation(event.id, topic.id);
      expect(JSON.stringify(await readSpecialties())).toBe(beforeJson);

      expect((await move(rel.id, "retire")).statusCode).toBe(200);
      expect(JSON.stringify(await readSpecialties())).toBe(beforeJson);

      expect((await move(rel.id, "restore")).statusCode).toBe(200);
      expect(JSON.stringify(await readSpecialties())).toBe(beforeJson);
    });

    it("012 EARS-11: when a classification between two publicly visible endpoints is previewed for retirement, the system shall list it as affected with a non-null title and hand back a signed impact token", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

      const p = await previewed(rel.id, "retire");
      expect(p.transition).toBe("retire");
      expect(p.version).toBe(1);
      expect(p.impactToken).toBeTypeOf("string");
      expect(p.affected).toHaveLength(1);
      expect(p.affected[0]).toMatchObject({
        kind: "event↔direction",
        id: rel.id,
        slug: null,
        status: "active",
      });
      // §3.1: the display title is never null — an operator confirming a
      // consequence must be able to read WHICH classification it is.
      expect(p.affected[0]!.title).toContain(event.title);
      expect(p.affected[0]!.title).toContain(topic.title);
    });

    it("012 EARS-11: when a previewed retirement is confirmed and then restored, the system shall move the SAME row and keep its id, never re-inserting a second one", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

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
        "SELECT count(*)::text AS count FROM event_topics WHERE event_id = $1 AND topic_id = $2",
        [event.id, topic.id],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("012 EARS-11: when a publicly visible event is traversed, the system shall answer exactly the PublicTopicSummary page of its publicly visible topics", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      await relation(event.id, topic.id);

      for (const url of [
        `/v1/public/events/${event.id}/topics`,
        `/v1/public/events/${event.slug}/topics`,
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
          ["id", "slug", "title"].sort(),
        );
        expect(page.data[0]).toMatchObject({
          id: topic.id,
          slug: topic.slug,
          title: topic.title,
        });
      }
    });

    it("012 EARS-11: when a published topic is traversed, the system shall answer exactly the PublicEventSummary page of its publicly visible events", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      await relation(event.id, topic.id);

      for (const url of [
        `/v1/public/topics/${topic.id}/events`,
        `/v1/public/topics/${topic.slug}/events`,
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
        // The public event summary is the 007 DTO and carries no `specialties`
        // — the topic axis is what this traversal discloses, never the other one.
        expect(page.data[0]).not.toHaveProperty("specialties");
      }
    });

    it("012 EARS-11: when a publicly visible event has no classifications, the system shall answer an empty page rather than a not-found", async () => {
      const event = await makeEvent(true);
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.slug}/topics`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: [],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it("012 EARS-11: when a classification is retired, the system shall drop it from BOTH public traversals while keeping it addressable to an admin", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);
      expect((await move(rel.id, "retire")).statusCode).toBe(200);

      const forward = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.id}/topics`,
      });
      expect((forward.json() as { data: unknown[] }).data).toHaveLength(0);
      const reverse = await app.inject({
        method: "GET",
        url: `/v1/public/topics/${topic.id}/events`,
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

    it("012 EARS-11: when the admin list is scoped by either endpoint, the system shall answer the classifications of that endpoint and exclude retired ones unless asked", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);
      const other = await makeTopic(false);
      const rel = await relation(event.id, topic.id);
      await relation(event.id, other.id);
      expect((await move(rel.id, "retire")).statusCode).toBe(200);

      const list = async (query: string) => {
        const res = await app.inject({
          method: "GET",
          url: `${ADMIN_BASE}?${query}`,
          headers: { ...device, ...adminHeaders(adminSid) },
        });
        expect(res.statusCode).toBe(200);
        return res.json() as { data: RelationBody[]; total: number };
      };

      const active = await list(`eventId=${event.id}`);
      expect(active.data.map((r) => r.topicId)).toEqual([other.id]);

      const all = await list(`eventId=${event.id}&includeRetired=true`);
      expect(all.data.map((r) => r.topicId).sort()).toEqual(
        [topic.id, other.id].sort(),
      );

      // The reverse scope reads the same route — one join surface, two lenses.
      const byTopic = await list(`topicId=${other.id}`);
      expect(byTopic.data.map((r) => r.eventId)).toEqual([event.id]);
    });

    // ── Reject branches ────────────────────────────────────────────────────

    it("012 EARS-11: when a draft endpoint is traversed publicly, the system shall answer 404, indistinguishable from an unknown one", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);
      await relation(event.id, topic.id);

      const draftSource = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.id}/topics`,
      });
      expect(draftSource.statusCode).toBe(404);
      const unknownSource = await app.inject({
        method: "GET",
        url: `/v1/public/events/${randomUUID()}/topics`,
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
        `/v1/public/events/${event.id}/topics`,
      );
    });

    it("012 EARS-11: when the same pair is classified twice, the system shall refuse the second with 409 and persist no second row", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);
      await relation(event.id, topic.id);

      const again = await relate(event.id, topic.id);
      expect(again.statusCode).toBe(409);
      expect((again.json() as { errorCode?: string }).errorCode).toBe(
        "RELATIONSHIP_CONFLICT",
      );
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_topics WHERE event_id = $1 AND topic_id = $2",
        [event.id, topic.id],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("012 EARS-11: when a RETIRED pair is classified again, the system shall refuse with 409 and tell the operator to restore the existing classification", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);
      const rel = await relation(event.id, topic.id);
      expect((await move(rel.id, "retire")).statusCode).toBe(200);

      const again = await relate(event.id, topic.id);
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

    it("012 EARS-11: when a classification names an unknown or RETIRED topic, the system shall refuse and create no topic on the fly", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);

      const absentEvent = await relate(randomUUID(), topic.id);
      expect(absentEvent.statusCode).toBe(404);
      const absentTopic = await relate(event.id, randomUUID());
      expect(absentTopic.statusCode).toBe(404);

      // `topics_retired_iff_deleted` — retirement is the status AND the
      // soft-delete stamp together; the fixture may not invent a half-retired row.
      await pool.query(
        "UPDATE directions SET status = 'retired', deleted_at = now() WHERE id = $1",
        [topic.id],
      );
      const retiredTopic = await relate(event.id, topic.id);
      expect(retiredTopic.statusCode).toBe(409);

      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_topics WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("012 EARS-11: when a create body carries a topic TITLE instead of an id, the system shall refuse it rather than mint a topic inline", async () => {
      const event = await makeEvent(false);
      const before = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM directions",
      );

      for (const payload of [
        { eventId: event.id, topicTitle: "Совершенно новая тема" },
        {
          eventId: event.id,
          topicId: randomUUID(),
          topicTitle: "Совершенно новая тема",
        },
      ]) {
        const res = await app.inject({
          method: "POST",
          url: ADMIN_BASE,
          headers: {
            ...device,
            ...adminHeaders(adminSid),
            "content-type": "application/json",
            "idempotency-key": key(),
          },
          payload,
        });
        expect(res.statusCode).toBe(400);
        expect((res.json() as { errorCode?: string }).errorCode).toBe(
          "VALIDATION_FAILED",
        );
      }

      // `.strict()` is only meaningful if nothing was created behind it.
      const after = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM directions",
      );
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    });

    it("012 EARS-11: when a create body tries to set lifecycle fields directly, the system shall refuse rather than silently ignore them", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);

      const res = await app.inject({
        method: "POST",
        url: ADMIN_BASE,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: {
          eventId: event.id,
          topicId: topic.id,
          status: "retired",
          version: 7,
        },
      });
      expect(res.statusCode).toBe(400);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_topics WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("012 EARS-11: when a transition is confirmed without a Lifecycle-Impact-Token, the system shall answer 428 and change nothing", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

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

    it("012 EARS-11: when a transition is confirmed without an If-Match, the system shall answer 428 before it ever looks at the impact token", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

      const res = await confirm(rel.id, "retire", {
        ifMatch: null,
        token: null,
      });
      expect(res.statusCode).toBe(428);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "PRECONDITION_REQUIRED",
      );
    });

    it("012 EARS-11: when a transition quotes an unusable If-Match, the system shall answer 412 rather than treating it as no precondition", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);
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

    it("012 EARS-11: when the discovered set changes between preview and confirmation, the system shall answer 412 LIFECYCLE_IMPACT_STALE with zero domain and zero audit mutation", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

      const p = await previewed(rel.id, "retire");
      // A SECOND classification on the same event: the transition's discovered
      // set is every relation sharing either endpoint, so the operator is now
      // looking at a screen that no longer describes the consequences.
      const other = await makeTopic(true);
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

    it("012 EARS-11: when a token issued for the OTHER transition is presented, the system shall answer 412 and change nothing", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

      const p = await previewed(rel.id, "retire");
      // Re-sign the identical discovered set under the restore transition — the
      // envelope binds WHICH move it authorizes, not merely which rows moved.
      const forged = impact.issue({
        transition: "restore",
        targetKind: "event↔topic",
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

    it("012 EARS-11: when an expired impact token is presented, the system shall answer 412 — a preview an operator read an hour ago no longer describes anything", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

      const p = await previewed(rel.id, "retire");
      const payload = tokenPayload(p.impactToken);
      const stale = impact.issue(
        {
          transition: "retire",
          targetKind: "event↔topic",
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

    it("012 EARS-11: when a tampered impact token is presented, the system shall answer 412 with the SAME undifferentiated refusal as a stale one", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);
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

    it("012 EARS-11: when the transition already in effect is previewed, the system shall answer 409 rather than treating it as a no-op", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      const rel = await relation(event.id, topic.id);

      const res = await preview(rel.id, "restore");
      expect(res.statusCode).toBe(409);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "INVALID_TRANSITION",
      );
    });

    it("012 EARS-11: when a classification is created without an Idempotency-Key, the system shall refuse before persisting anything", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);

      const res = await relate(event.id, topic.id, { idempotencyKey: "" });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_topics WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("0");
    });

    it("012 EARS-17: when the identical create is retried under the same Idempotency-Key, the system shall replay the stored outcome instead of classifying twice", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);
      const k = key();

      const first = await relate(event.id, topic.id, { idempotencyKey: k });
      expect(first.statusCode).toBe(201);
      const body = first.json() as RelationBody;
      createdRelationIds.push(body.id);

      const replay = await relate(event.id, topic.id, { idempotencyKey: k });
      expect(replay.statusCode).toBe(201);
      expect((replay.json() as RelationBody).id).toBe(body.id);
      const { rows } = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM event_topics WHERE event_id = $1",
        [event.id],
      );
      expect(rows[0]!.count).toBe("1");
    });

    it("012 EARS-11: the classification surface shall expose no PATCH route — the join carries no attribute to edit", async () => {
      const event = await makeEvent(false);
      const topic = await makeTopic(false);
      const rel = await relation(event.id, topic.id);

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

    it("012 EARS-11: when a public traversal quotes a cursor this API never issued, the system shall refuse it rather than silently trusting it", async () => {
      const event = await makeEvent(true);
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${event.id}/topics?cursor=not-a-cursor`,
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { errorCode?: string }).errorCode).toBe(
        "CURSOR_INVALID",
      );
    });

    it("012 EARS-11: when a public traversal quotes a DECODABLE cursor carrying values this API never issues, the system shall still refuse it as CURSOR_INVALID rather than fail on the query", async () => {
      const event = await makeEvent(true);
      const topic = await makeTopic(true);
      await relation(event.id, topic.id);

      // A hand-edited cursor decodes fine; its VALUES are what reach SQL. A
      // non-UUID id would hit a `uuid` column as pg `22P02`, and a bogus
      // instant would blow up the driver's `toISOString()` — both 500s on a
      // ZERO-AUTH route unless the tuple is parsed before any query runs.
      const forge = (value: Record<string, string>): string =>
        Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

      const cases: { url: string; cursor: string }[] = [
        {
          url: `/v1/public/events/${event.id}/topics`,
          cursor: forge({ title: "anything", id: "not-a-uuid" }),
        },
        {
          url: `/v1/public/events/${event.id}/topics`,
          cursor: forge({
            startsAt: "nope",
            id: "0f4c1b6e-9d2a-4a3b-8c11-2f5e7a9b0c31",
          }),
        },
        {
          url: `/v1/public/topics/${topic.id}/events`,
          cursor: forge({ startsAt: "2026-01-01T00:00:00.000Z", id: "x" }),
        },
        {
          url: `/v1/public/topics/${topic.id}/events`,
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
