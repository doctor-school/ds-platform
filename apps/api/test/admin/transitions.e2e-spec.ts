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
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 007 EARS-7 — the single closed-set lifecycle state machine, server-enforced.
// The transition guard permits ONLY draft→published→live→ended→archived; every
// invalid jump (skip-forward, backward, reopen archived, the published→draft
// unpublish the PRD names none) is refused directly against the API with a 4xx,
// not merely hidden in the admin UI. The read models carry `validTransitions`
// derived from the current state so the UI offers only the currently-valid move.
// Runs against dev-stand Postgres + the fake IdP session; skips when absent so
// the shared CI unit job stays green (requirements Verification, row 7).
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-7 lifecycle transition guard (e2e)",
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
      const boundary = `----ds594${Math.random().toString(16).slice(2)}`;
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
      title: "ХСН: closed-set lifecycle",
      school: "Кардиология",
      startsAtMsk: "2026-07-17T19:00",
      durationMin: 90,
      specialties: ["cardiology"],
    };

    /** Create a fresh draft event through the EARS-1 create endpoint; return its id. */
    async function createDraft(cookie: string): Promise<string> {
      const mp = multipartBody({ payload: JSON.stringify(validPayload) });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { id: string }).id;
      createdEventIds.push(id);
      return id;
    }

    /** POST a transition command against the guard. */
    async function transition(
      cookie: string,
      id: string,
      to: EventLifecycleState,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/transition`,
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
          "content-type": "application/json",
        },
        payload: { to },
      });
    }

    /** Force a persisted lifecycle state (arrange a mid-lifecycle fixture without the sibling commands). */
    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [state, id]);
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
      for (const id of createdEventIds.splice(0))
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-7.1: the guard permits the four legal forward moves in order (draft→published→live→ended→archived)", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie);

      const order: EventLifecycleState[] = [
        "published",
        "live",
        "ended",
        "archived",
      ];
      let previous: EventLifecycleState = "draft";
      for (const to of order) {
        const res = await transition(cookie, id, to);
        expect(res.statusCode, `${previous}→${to} should be permitted`).toBe(200);
        const body = res.json() as {
          state: EventLifecycleState;
          validTransitions: EventLifecycleState[];
        };
        expect(body.state).toBe(to);
        // The read model offers only the next currently-valid move.
        const expectedNext =
          to === "published"
            ? ["live"]
            : to === "live"
              ? ["ended"]
              : to === "ended"
                ? ["archived"]
                : [];
        expect(body.validTransitions).toEqual(expectedNext);

        const { rows } = await pool.query<{ state: string }>(
          "SELECT state FROM events WHERE id = $1",
          [id],
        );
        expect(rows[0]?.state).toBe(to);
        previous = to;
      }
    });

    it("EARS-7.2: every skip-forward jump is refused server-side with a 4xx and the state is unchanged", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie);

      // From draft, only `published` is legal — a skip to live/ended/archived is refused.
      for (const to of ["live", "ended", "archived"] as EventLifecycleState[]) {
        const res = await transition(cookie, id, to);
        expect(res.statusCode, `draft→${to} must be refused`).toBe(409);
        const { rows } = await pool.query<{ state: string }>(
          "SELECT state FROM events WHERE id = $1",
          [id],
        );
        expect(rows[0]?.state).toBe("draft"); // unchanged
      }

      // From published, a skip to ended/archived is refused.
      await forceState(id, "published");
      for (const to of ["ended", "archived"] as EventLifecycleState[]) {
        const res = await transition(cookie, id, to);
        expect(res.statusCode, `published→${to} must be refused`).toBe(409);
      }
    });

    it("EARS-7.3: every backward move is refused (no published→draft unpublish, no archived reopen)", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie);

      // No unpublish: published→draft is refused.
      await forceState(id, "published");
      const unpublish = await transition(cookie, id, "draft");
      expect(unpublish.statusCode).toBe(409);
      expect(
        (
          await pool.query<{ state: string }>(
            "SELECT state FROM events WHERE id = $1",
            [id],
          )
        ).rows[0]?.state,
      ).toBe("published");

      // No reopen: archived→published / archived→ended are refused.
      await forceState(id, "archived");
      for (const to of ["ended", "published", "draft"] as EventLifecycleState[]) {
        const res = await transition(cookie, id, to);
        expect(res.statusCode, `archived→${to} must be refused`).toBe(409);
      }
    });

    it("EARS-7.4: a self-transition is refused from every state", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie);
      for (const s of EVENT_LIFECYCLE_STATES) {
        await forceState(id, s);
        const res = await transition(cookie, id, s);
        expect(res.statusCode, `${s}→${s} must be refused`).toBe(409);
      }
    });

    it("EARS-7: a target outside the closed state enum is a 400 (validation), not a 409", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(cookie);
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/transition`,
        headers: {
          ...device,
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
          "content-type": "application/json",
        },
        payload: { to: "cancelled" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("EARS-7: a transition against a non-existent event is a 404", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const res = await transition(
        cookie,
        "00000000-0000-0000-0000-000000000000",
        "published",
      );
      expect(res.statusCode).toBe(404);
    });

    it("EARS-8: a doctor_guest is refused (403) on the transition command — the guard is never reachable without platform_admin", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(admin);
      const doc = await session(uniqueEmail("doc"), "doctor_guest");
      const res = await transition(doc, id, "published");
      expect(res.statusCode).toBe(403);
      expect(
        (
          await pool.query<{ state: string }>(
            "SELECT state FROM events WHERE id = $1",
            [id],
          )
        ).rows[0]?.state,
      ).toBe("draft");
    });

    it("EARS-8: an unauthenticated caller is refused (401) on the transition command", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const id = await createDraft(admin);
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/transition`,
        headers: { ...device, "content-type": "application/json" },
        payload: { to: "published" },
      });
      expect(res.statusCode).toBe(401);
    });
  },
);
