import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type {
  EventLifecycleState,
  PublicEventPage,
  UpcomingBroadcastCard,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 007 EARS-6 — ArchiveEvent (POST /v1/admin/events/:id/archive). The operator's
// post-broadcast action that transitions an `ended` event `ended → archived`,
// after which the event leaves all public surfaces: the 004 upcoming listing
// drops it (state filter) and the 004 public event page reflects `archived`
// (the archived-notice body, never a 404). Runs through the shared EARS-7
// closed-set guard: archive is refused unless the event is `ended` — with the
// state left untouched and NO audit row written on refusal. Each successful
// transition appends exactly one terminal `audit_ledger` row (ADR-0003 §6):
// `event.archived`. `platform_admin`-only (EARS-8): a doctor_guest / public
// caller never reaches the command. Archive is a MANUAL operator action — LD-2:
// no scheduler, no time-based automation fires it in wave 1 (asserted at the
// transition level below). Runs against dev-stand Postgres + the fake IdP
// session; skips when absent so the shared CI unit job stays green (requirements
// Verification, row 6). The 004 archived-notice rendering is a consumer slice
// (004 EARS-5) — out of scope here; 007 produces the `archived` state it reads.

// LD-2 — no scheduler, no time-based automation. This assertion runs
// unconditionally (no DB needed): the 007 events module must carry NO
// time-based automation primitive that could fire the `ended → archived`
// transition without an explicit operator command. A scheduler creeping in
// later would violate LD-2 silently; this fails the build the moment it does.
describe("007 EARS-6 archive is manual — no scheduler / time-based path (LD-2)", () => {
  it("EARS-6: no time-based automation primitive exists in the 007 events module that could fire the transition", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const eventsDir = join(here, "..", "..", "src", "events");
    const sources = readdirSync(eventsDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
      .map((f) => readFileSync(join(eventsDir, f), "utf8"));

    // Scheduler / timer primitives that would let the transition fire on a
    // clock rather than an explicit operator command (LD-2 — wave-2 candidate).
    const forbidden = [
      "@nestjs/schedule",
      "@Cron",
      "@Interval",
      "@Timeout",
      "SchedulerRegistry",
      "setInterval",
      "setTimeout",
    ];
    for (const source of sources) {
      for (const token of forbidden) {
        expect(
          source.includes(token),
          `007 events module must not use ${token} (LD-2: archive is manual, no scheduler)`,
        ).toBe(false);
      }
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007 EARS-6 archive transition (ended → archived) (e2e)",
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
      const boundary = `----ds593${Math.random().toString(16).slice(2)}`;
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
      title: "ХСН: archive path",
      school: "Кардиология",
      // A future МСК instant so a published event lands on the upcoming listing
      // (004 EARS-7) — the before-state of the "leaves public surfaces" drop.
      startsAtMsk: "2026-12-17T19:00",
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

    /** POST a named lifecycle command (`publish` / `open` / `close` / `archive`). */
    async function command(
      verb: "publish" | "open" | "close" | "archive",
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

    /** Drive the real create → publish → open → close arc to an `ended` event. */
    async function makeEnded(
      cookie: string,
    ): Promise<{ id: string; slug: string }> {
      const { id, slug } = await createDraft(cookie);
      expect((await command("publish", cookie, id)).statusCode).toBe(200);
      expect((await command("open", cookie, id)).statusCode).toBe(200);
      expect((await command("close", cookie, id)).statusCode).toBe(200);
      expect(await currentState(id)).toBe("ended");
      return { id, slug };
    }

    /** Whether the public upcoming listing (004 EARS-7) contains this event. */
    async function isOnUpcomingListing(id: string): Promise<boolean> {
      const res = await app.inject({ method: "GET", url: "/v1/public/events" });
      expect(res.statusCode).toBe(200);
      const cards = res.json() as UpcomingBroadcastCard[];
      return cards.some((c) => c.id === id);
    }

    /** The public event-page body (004 EARS-1), or the HTTP status when not 200. */
    async function publicPage(
      slug: string,
    ): Promise<{ statusCode: number; body: PublicEventPage | null }> {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      return {
        statusCode: res.statusCode,
        body: res.statusCode === 200 ? (res.json() as PublicEventPage) : null,
      };
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

    it("EARS-6.1: archiving an ended event transitions it to archived and appends one event.archived audit row", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makeEnded(cookie);
      expect(await auditCount(id, "event.archived")).toBe(0);

      const res = await command("archive", cookie, id);
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
      // ended → archived through the EARS-7 guard; `archived` is terminal so the
      // read model offers no further move.
      expect(body.state).toBe("archived");
      expect(body.validTransitions).toEqual([]);
      expect(await currentState(id)).toBe("archived");
      // Exactly one terminal audit_ledger row (ADR-0003 §6).
      expect(await auditCount(id, "event.archived")).toBe(1);
    });

    it("EARS-6.2: an archived event leaves all public surfaces — the 004 listing drops it and the public page reflects archived", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id, slug } = await createDraft(cookie);
      // Published + future-dated ⇒ on the upcoming listing and the public page is
      // live (the before-state of the drop).
      expect((await command("publish", cookie, id)).statusCode).toBe(200);
      expect(await isOnUpcomingListing(id)).toBe(true);
      const beforePage = await publicPage(slug);
      expect(beforePage.statusCode).toBe(200);
      expect(beforePage.body?.state).toBe("published");

      // Drive the full arc to archived.
      expect((await command("open", cookie, id)).statusCode).toBe(200);
      expect((await command("close", cookie, id)).statusCode).toBe(200);
      expect((await command("archive", cookie, id)).statusCode).toBe(200);

      // Public listing drops it (state filter — never on the listing again).
      expect(await isOnUpcomingListing(id)).toBe(false);
      // The public read endpoint reflects `archived` — a 200 archived-notice
      // body per its existing contract, never a dead 404 (004 EARS-5 renders it).
      const afterPage = await publicPage(slug);
      expect(afterPage.statusCode).toBe(200);
      expect(afterPage.body?.state).toBe("archived");
    });

    it("EARS-6.3: archive is refused for every non-ended state, the state is unchanged, and no audit row is written", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await createDraft(cookie);

      for (const state of ["draft", "published", "live", "archived"] as const) {
        await forceState(id, state);
        const res = await command("archive", cookie, id);
        expect(res.statusCode, `archive must be refused from ${state}`).toBe(409);
        expect(await currentState(id)).toBe(state); // unchanged
        expect(await auditCount(id, "event.archived")).toBe(0); // no terminal row
      }
    });

    it("EARS-6.4: archiving a non-existent event is a 404", async () => {
      const cookie = await session(uniqueEmail("admin"), "platform_admin");
      const missing = "00000000-0000-0000-0000-000000000000";
      expect((await command("archive", cookie, missing)).statusCode).toBe(404);
    });

    it("EARS-8: a doctor_guest is refused (403) on archive — the command is never reached without platform_admin, state and ledger untouched", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makeEnded(admin);
      const doc = await session(uniqueEmail("doc"), "doctor_guest");

      const res = await command("archive", doc, id);
      expect(res.statusCode).toBe(403);
      expect(await currentState(id)).toBe("ended"); // untouched
      expect(await auditCount(id, "event.archived")).toBe(0);
    });

    it("EARS-8: an unauthenticated caller is refused (401) on archive", async () => {
      const admin = await session(uniqueEmail("admin"), "platform_admin");
      const { id } = await makeEnded(admin);
      const res = await command("archive", undefined, id);
      expect(res.statusCode).toBe(401);
      expect(await currentState(id)).toBe("ended"); // untouched
    });
  },
);
