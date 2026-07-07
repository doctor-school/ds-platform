import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { EventLifecycleState } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 007 EARS-5 — OpenRoom / CloseRoom (POST /v1/admin/events/:id/open · /close).
// The director's two air-day actions: OpenRoom transitions `published → live`
// (the 006 room starts admitting registered doctors and presence capture
// starts) and CloseRoom transitions `live → ended` (006 stops admission +
// heartbeat/chat acceptance, bounding the presence window). Both run through the
// shared EARS-7 closed-set guard: open is refused unless `published`, close
// unless `live` — with the state left untouched and NO audit row written on
// refusal. Each successful transition appends exactly one terminal
// `audit_ledger` row (ADR-0003 §6): `event.went_live` for open, `event.ended`
// for close. `platform_admin`-only (EARS-8): a doctor_guest / public caller
// never reaches the command. Runs against dev-stand Postgres + the fake IdP
// session; skips when absent so the shared CI unit job stays green (requirements
// Verification, row 5). 006's own admission/heartbeat/chat refusal logic is out
// of scope — this handler produces the `live` window 006 consumes.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-5 room control open/close transitions (e2e)",
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
      const boundary = `----ds592${Math.random().toString(16).slice(2)}`;
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
      title: "ХСН: room control",
      school: "Кардиология",
      startsAtMsk: "2026-07-17T19:00",
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
          cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; slug: string };
      createdEventIds.push(body.id);
      return { id: body.id, slug: body.slug };
    }

    /** POST a named lifecycle command (`publish` / `open` / `close`). */
    async function command(
      verb: "publish" | "open" | "close",
      cookie: string | undefined,
      id: string,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/${verb}`,
        headers: {
          ...device,
          ...(cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {}),
        },
      });
    }

    async function currentState(id: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ state: string }>(
        "SELECT state FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.state;
    }

    /** Count the terminal audit rows of one type for one aggregate. */
    async function auditCount(id: string, eventType: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_ledger
           WHERE event_type = $1 AND metadata->>'aggregateId' = $2`,
        [eventType, id],
      );
      return Number(rows[0]?.count ?? "0");
    }

    /** Force a persisted lifecycle state (arrange a fixture in a specific state). */
    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [state, id]);
    }

    /** Arrange a `published` event via the real publish command. */
    async function makePublished(cookie: string) {
      const { id, slug } = await createDraft(cookie);
      expect((await command("publish", cookie, id)).statusCode).toBe(200);
      return { id, slug };
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
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      for (const email of createdEmails.splice(0))
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-5.1: opening the room transitions a published event to live (006 admission + presence capture start) and appends one event.went_live audit row", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makePublished(cookie);
      expect(await auditCount(id, "event.went_live")).toBe(0);

      const res = await command("open", cookie, id);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
      // published → live through the EARS-7 guard; the read model now offers
      // only the next currently-valid move (close room → ended).
      expect(body.state).toBe("live");
      expect(body.validTransitions).toEqual(["ended"]);
      expect(await currentState(id)).toBe("live");
      // Exactly one terminal audit_ledger row (ADR-0003 §6).
      expect(await auditCount(id, "event.went_live")).toBe(1);
    });

    it("EARS-5.2: closing the room transitions a live event to ended (006 stops beats/posts, presence window bounded) and appends one event.ended audit row", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makePublished(cookie);
      expect((await command("open", cookie, id)).statusCode).toBe(200);
      expect(await auditCount(id, "event.ended")).toBe(0);

      const res = await command("close", cookie, id);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
      // live → ended through the EARS-7 guard; the read model now offers only
      // the next currently-valid move (archive → archived).
      expect(body.state).toBe("ended");
      expect(body.validTransitions).toEqual(["archived"]);
      expect(await currentState(id)).toBe("ended");
      expect(await auditCount(id, "event.ended")).toBe(1);
    });

    it("EARS-5.3: open is refused for every non-published state, the state is unchanged, and no audit row is written", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      for (const state of ["draft", "live", "ended", "archived"] as const) {
        await forceState(id, state);
        const res = await command("open", cookie, id);
        expect(res.statusCode, `open must be refused from ${state}`).toBe(409);
        expect(await currentState(id)).toBe(state); // unchanged
        expect(await auditCount(id, "event.went_live")).toBe(0); // no terminal row
      }
    });

    it("EARS-5.4: close is refused for every non-live state, the state is unchanged, and no audit row is written", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      for (const state of ["draft", "published", "ended", "archived"] as const) {
        await forceState(id, state);
        const res = await command("close", cookie, id);
        expect(res.statusCode, `close must be refused from ${state}`).toBe(409);
        expect(await currentState(id)).toBe(state); // unchanged
        expect(await auditCount(id, "event.ended")).toBe(0); // no terminal row
      }
    });

    it("EARS-5.5: opening or closing a non-existent event is a 404", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const missing = "00000000-0000-0000-0000-000000000000";
      expect((await command("open", cookie, missing)).statusCode).toBe(404);
      expect((await command("close", cookie, missing)).statusCode).toBe(404);
    });

    it("EARS-8: a doctor_guest is refused (403) on open and close — the command is never reached without platform_admin, state and ledger untouched", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makePublished(admin);
      const doc = await session(uniqueEmail("doc"), "doctor_guest");

      const openRes = await command("open", doc, id);
      expect(openRes.statusCode).toBe(403);
      expect(await currentState(id)).toBe("published");
      expect(await auditCount(id, "event.went_live")).toBe(0);

      // Advance to live as the admin, then confirm close is likewise refused.
      expect((await command("open", admin, id)).statusCode).toBe(200);
      const closeRes = await command("close", doc, id);
      expect(closeRes.statusCode).toBe(403);
      expect(await currentState(id)).toBe("live");
      expect(await auditCount(id, "event.ended")).toBe(0);
    });

    it("EARS-8: an unauthenticated caller is refused (401) on open and close", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makePublished(admin);
      expect((await command("open", undefined, id)).statusCode).toBe(401);
      expect(await currentState(id)).toBe("published");
      expect((await command("close", undefined, id)).statusCode).toBe(401);
    });
  },
);
