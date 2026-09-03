import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { EVENT_LIFECYCLE_STATES, type EventLifecycleState } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { futureMskStart } from "../setup/wall-clock.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";

// 007 EARS-4 — PublishEvent (POST /v1/admin/events/:id/publish). Publishing a
// `draft` event transitions it `draft → published` through the EARS-7 guard,
// making it publicly reachable on the 004 event page (the single visibility
// signal 005 registration gating reads too — EARS-9, one state, no boolean
// flag) and appending exactly one terminal `audit_ledger` row (ADR-0003 §6).
// Publish is refused for any non-`draft` state (the guard) with the state left
// untouched and NO audit row written. `platform_admin`-only (EARS-8): a
// doctor_guest / public caller never reaches the command. Runs against
// dev-stand Postgres + the fake IdP session; skips when absent so the shared CI
// unit job stays green (requirements Verification, row 4).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-4 publish transition (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Register + login; return the session cookie value. `role` is granted before login. */
    async function session(
      email: string,
      role: "doctor_guest" | "platform_admin",
    ): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);

      if (role === "platform_admin") {
        const { rows } = await pool.query<{ zitadel_sub: string }>(
          "SELECT zitadel_sub FROM users WHERE email = $1",
          [email],
        );
        expect(rows[0]).toBeDefined();
        await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      }

      // 011 EARS-2: an admin route authenticates ONLY through
      // __Host-ds_admin_session, so a platform_admin principal holds an ADMIN
      // session here, not the doctor-portal one it borrowed in wave 1.
      if (role === "platform_admin") {
        const admin = await establishAdminSession(app, {
          identifier: email,
          password,
          device,
        });
        return admin.sid;
      }

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      return cookie!.value;
    }

    /** Build a multipart/form-data body from string fields. */
    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds591${Math.random().toString(16).slice(2)}`;
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

    const validPayload = {
      title: "ХСН: publish transition",
      school: "Кардиология",
      // Derived, never pinned: a rotted literal drifts into the past, and a
      // PAST published event legitimately offers the 014 EARS-18 `ended` edge —
      // which would turn this suite red with no production change behind it.
      startsAtMsk: futureMskStart(30, "19:00"),
      durationMin: 90,
      specialties: ["cardiology"],
    };

    /** Create a fresh draft event through the EARS-1 create endpoint; return its id + slug. */
    async function createDraft(
      cookie: string,
    ): Promise<{ id: string; slug: string }> {
      const mp = multipartBody({ payload: JSON.stringify(validPayload) });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...authHeaders(cookie),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; slug: string };
      createdEventIds.push(body.id);
      return { id: body.id, slug: body.slug };
    }

    /**
     * The current `If-Match` validator (#1593) — publish is conditional.
     * Staleness itself is owned by
     * `test/admin/optimistic-concurrency.e2e-spec.ts`.
     */
    async function ifMatch(id: string): Promise<Record<string, string>> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM events WHERE id = $1",
        [id],
      );
      return { "if-match": `"${rows[0]?.version ?? 1}"` };
    }

    /** POST the named publish command. */
    async function publish(cookie: string | undefined, id: string) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/publish`,
        headers: {
          ...device,
          ...(await ifMatch(id)),
          ...(cookie ? { ...authHeaders(cookie) } : {}),
        },
      });
    }

    /** GET the 004 public projection for an event (unauthenticated). */
    async function publicPage(idOrSlug: string) {
      return app.inject({
        method: "GET",
        url: `/v1/public/events/${idOrSlug}`,
      });
    }

    async function currentState(id: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ state: string }>(
        "SELECT state FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.state;
    }

    /** Count the terminal `event.published` audit rows for one aggregate. */
    async function publishAuditCount(id: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_ledger
           WHERE event_type = 'event.published' AND metadata->>'aggregateId' = $1`,
        [id],
      );
      return Number(rows[0]?.count ?? "0");
    }

    /** Force a persisted lifecycle state (arrange a non-draft fixture directly). */
    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [
        state,
        id,
      ]);
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
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      // `audit_ledger` is append-only (ADR-0003 §2.7 — DELETE is trigger-blocked),
      // so its rows are intentionally left behind; they are keyed by a unique
      // per-test aggregate id, so leftover rows never affect a later count.
      for (const id of createdEventIds.splice(0))
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-4: publishing a draft event transitions it to published, makes the 004 public projection reachable, and appends one audit_ledger row", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id, slug } = await createDraft(cookie);

      // A draft event has no public projection (004 EARS-6) and no audit row yet.
      expect((await publicPage(slug)).statusCode).toBe(404);
      expect(await publishAuditCount(id)).toBe(0);

      const res = await publish(cookie, id);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
      // draft → published through the EARS-7 guard; the read model now offers
      // only the next currently-valid move (open room → live).
      expect(body.state).toBe("published");
      expect(body.validTransitions).toEqual(["live"]);
      expect(await currentState(id)).toBe("published");

      // The single visibility signal: the 004 public page is now reachable and
      // reflects `published` — the same state 005 registration gating reads
      // (EARS-9, one source of truth, no second flag).
      const page = await publicPage(slug);
      expect(page.statusCode).toBe(200);
      expect((page.json() as { state: string }).state).toBe("published");

      // Exactly one terminal audit_ledger row (ADR-0003 §6).
      expect(await publishAuditCount(id)).toBe(1);
    });

    it("EARS-4: publish is refused for every non-draft state, the state is unchanged, and no audit row is written", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      for (const state of ["published", "live", "ended", "hidden"] as const) {
        await forceState(id, state);
        const res = await publish(cookie, id);
        expect(res.statusCode, `publish must be refused from ${state}`).toBe(
          409,
        );
        // #1593 — the refusal must carry the STABLE code, not just a 409 and an
        // English sentence. The admin screen keys its recovery off `code`
        // (`lib/lifecycle.lifecycleErrorOutcome`): an unclassified refusal is
        // treated as "no evidence the row is readable" and the screen is left
        // on its stale state, which is precisely the dead end the owner hit at
        // Stage-B. Every other named command answers `INVALID_TRANSITION` here;
        // publish must not be the one that says it differently.
        expect(
          (res.json() as { code?: string }).code,
          `publish refusal from ${state} must name INVALID_TRANSITION`,
        ).toBe("INVALID_TRANSITION");
        expect(await currentState(id)).toBe(state); // unchanged
        expect(await publishAuditCount(id)).toBe(0); // no terminal row
      }
    });

    it("EARS-4: publishing a non-existent event is a 404", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const res = await publish(cookie, "00000000-0000-0000-0000-000000000000");
      expect(res.statusCode).toBe(404);
    });

    it("EARS-8: a doctor_guest is refused (401) — the publish command is never reached without an admin session, state and ledger untouched", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(admin);
      const doc = await session(uniqueEmail("doc"), "doctor_guest");
      const res = await publish(doc, id);
      // 011 EARS-2: refused 401, not 403 — since the admin tier, a doctor-portal cookie authenticates NO admin route, so the request never reaches the role check.
      expect(res.statusCode).toBe(401);
      expect(await currentState(id)).toBe("draft");
      expect(await publishAuditCount(id)).toBe(0);
    });

    it("EARS-8: an unauthenticated caller is refused (401) on the publish command", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(admin);
      const res = await publish(undefined, id);
      expect(res.statusCode).toBe(401);
      expect(await currentState(id)).toBe("draft");
    });

    it("EARS-4: the closed lifecycle enum is unchanged (publish is the only draft-originating command)", () => {
      // Guardrail against an accidental enum edit while wiring the named command.
      // `in_archive` is the LEGACY machine's archive state (014 EARS-23, #1741);
      // no platform command reaches it, and no legacy command reaches any of the
      // five broadcast states — the two machines share the enum, not the edges.
      expect([...EVENT_LIFECYCLE_STATES]).toEqual([
        "draft",
        "published",
        "live",
        "ended",
        "hidden",
        "in_archive",
      ]);
    });
  },
);
