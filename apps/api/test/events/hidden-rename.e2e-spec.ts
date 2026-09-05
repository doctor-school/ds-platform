import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
import {
  EVENT_LIFECYCLE_STATES,
  validTransitions,
  type EventLifecycleState,
  type PublicEventPage,
  type UpcomingBroadcastCard,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import {
  deleteExpertFixtures,
  seedEventSpeakers,
} from "../setup/speaker-fixtures.js";

/**
 * 014 EARS-28 — the `archived → hidden` rename is COMPLETE and BEHAVIOUR-NEUTRAL.
 *
 * The requirement (014-requirements-en.md, Verification row for this file):
 * «After migration no row, contract field or label carries `archived`» — and
 * the lifecycle state it was renamed FROM keeps doing exactly what it did.
 *
 * The rename crossed four layers, and a leftover in ANY of them is the failure
 * this file exists to catch — which is why each layer is its own row rather
 * than one composite assertion:
 *   • 28.1 the Postgres enum `event_lifecycle_state` (the storage label);
 *   • 28.2 the `@ds/schemas` contract SSOT (the wire label + the transition map);
 *   • 28.3 the RUNTIME — hide still drives `ended → hidden`, still writes its
 *     one `event.hidden` audit row, and the public surfaces still degrade the
 *     way 004 EARS-5 pinned them. A rename that silently changed behaviour
 *     would pass 28.1/28.2/28.4 and fail nothing else;
 *   • 28.4 the GENERATED SDK snapshot, which is regenerated from the running
 *     OpenAPI document and so is the one artifact that can lag the source.
 *
 * Runs against the dev-stand Postgres and skips without `DATABASE_URL`, so the
 * shared CI unit job stays green (same gate as `hidden.e2e-spec.ts`).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "014 EARS-28 archived → hidden rename is complete and behaviour-neutral (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Register + grant `platform_admin` + establish the 011 EARS-2 admin session. */
    async function adminSession(): Promise<string> {
      const email = uniqueEmail("admin-rename");
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
      expect(rows[0]).toBeDefined();
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");

      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
    }

    /**
     * Seed one event row (+ one speaker) directly in `state`, the 004↔007
     * fixture seam `hidden.e2e-spec.ts` also uses (lifecycle authoring is
     * feature 007). `starts_at` is a WEEK OUT on purpose: a future start is what
     * puts the event on the 004 EARS-7 upcoming listing, so the "gone from the
     * listing after hide" assertion in 28.3 is a real disappearance and not a
     * past event that was never listed to begin with.
     */
    async function seedEvent(
      state: EventLifecycleState,
    ): Promise<{ id: string; slug: string }> {
      const id = randomUUID();
      const slug = `rename-${state}-${id.slice(0, 8)}`;
      const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          slug,
          "Пластика ахиллова сухожилия",
          "Школа травматологии",
          startsAt.toISOString(),
          90,
          "Разбор клинических случаев.",
          ["traumatology", "orthopedics"],
          "sponsor:acme-pharma",
          null,
          state,
        ],
      );
      createdExpertIds.push(
        ...(await seedEventSpeakers(pool, id, [
          {
            familyName: "Соколова",
            givenName: "Анна",
            credentials: "Травматолог-ортопед, к.м.н.",
          },
        ])),
      );
      createdEventIds.push(id);
      return { id, slug };
    }

    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [
        state,
        id,
      ]);
    }

    async function currentState(id: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ state: string }>(
        "SELECT state FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.state;
    }

    /** The current `If-Match` validator (#1593) — lifecycle commands are conditional. */
    async function ifMatch(id: string): Promise<Record<string, string>> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM events WHERE id = $1",
        [id],
      );
      return { "if-match": `"${rows[0]?.version ?? 1}"` };
    }

    async function auditCount(id: string, eventType: string): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_ledger
           WHERE event_type = $1 AND metadata->>'aggregateId' = $2`,
        [eventType, id],
      );
      return Number(rows[0]?.count ?? "0");
    }

    async function isOnUpcomingListing(id: string): Promise<boolean> {
      const res = await app.inject({ method: "GET", url: "/v1/public/events" });
      expect(res.statusCode).toBe(200);
      return (res.json() as UpcomingBroadcastCard[]).some((c) => c.id === id);
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
      // so its rows stay; they are keyed by a unique per-test aggregate id, so a
      // leftover never affects a later count.
      for (const id of createdEventIds.splice(0))
        await deleteEventFixture(pool, id);
      await deleteExpertFixtures(pool, createdExpertIds.splice(0));
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("014 EARS-28.1: the event_lifecycle_state enum carries `hidden` and no longer carries `archived`, and no event row is left in the old label", async () => {
      const { rows } = await pool.query<{ enumlabel: string }>(
        `SELECT e.enumlabel
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'event_lifecycle_state'
          ORDER BY e.enumsortorder`,
      );
      const labels = rows.map((r) => r.enumlabel);
      expect(labels).toContain("hidden");
      expect(labels).not.toContain("archived");

      // `WHERE state = 'archived'` is no longer even a VALID query post-rename —
      // Postgres rejects the literal against the enum — so the "no row carries
      // archived" half is asserted through the labels above plus this filtered
      // count, which is the same statement shape and must run WITHOUT a cast
      // error. A surviving `archived` label would have made it parse.
      const { rows: counted } = await pool.query<{ hidden: string }>(
        `SELECT count(*) FILTER (WHERE state = 'hidden')::text AS hidden FROM events`,
      );
      expect(Number(counted[0]?.hidden ?? "0")).toBeGreaterThanOrEqual(0);
    });

    it("014 EARS-28.2: the @ds/schemas contract exposes `hidden`, never `archived`, and `ended` still transitions to exactly one state", () => {
      const states: readonly string[] = EVENT_LIFECYCLE_STATES;
      expect(states).toContain("hidden");
      expect(states).not.toContain("archived");
      // The transition map is the behavioural half of the contract: the rename
      // moved the LABEL, not the graph — `ended` still has one legal move and
      // `hidden` is still terminal.
      expect(validTransitions("ended", "platform")).toEqual(["hidden"]);
      expect(validTransitions("hidden", "platform")).toEqual([]);
    });

    it("014 EARS-28.3: behaviour is unchanged — hide still drives ended → hidden with its audit row, and the public surfaces still degrade as 004 EARS-5 pinned them", async () => {
      const cookie = await adminSession();
      const { id, slug } = await seedEvent("published");
      // Listed while published — the baseline the hide must remove.
      expect(await isOnUpcomingListing(id)).toBe(true);

      await forceState(id, "ended");
      expect(await auditCount(id, "event.hidden")).toBe(0);

      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/hide`,
        headers: { ...device, ...(await ifMatch(id)), ...authHeaders(cookie) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        state: EventLifecycleState;
        validTransitions: EventLifecycleState[];
      };
      expect(body.state).toBe("hidden");
      expect(body.validTransitions).toEqual([]);
      expect(await currentState(id)).toBe("hidden");
      // Exactly one terminal audit row, under the renamed type (ADR-0003 §6).
      expect(await auditCount(id, "event.hidden")).toBe(1);

      // 004 EARS-5: the already-distributed direct link degrades in place —
      // 200 with a `hidden` body, never a 404 and never a redirect.
      const page = await app.inject({
        method: "GET",
        url: `/v1/public/events/${slug}`,
      });
      expect(page.statusCode).toBe(200);
      const pageBody = page.json() as PublicEventPage;
      expect(pageBody.state).toBe("hidden");
      expect(pageBody.slug).toBe(slug);

      // …while the discovery surface drops it.
      expect(await isOnUpcomingListing(id)).toBe(false);
    });

    it("014 EARS-28.4: the generated SDK snapshot on disk carries no `archived` — every lifecycle enum in it is the renamed set", () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const snapshotPath = join(
        here,
        "..",
        "..",
        "..",
        "..",
        "packages",
        "api-client",
        "openapi.snapshot.json",
      );
      const raw = readFileSync(snapshotPath, "utf8");
      // The document has no single named `EventLifecycleState` schema — the
      // generator inlines the enum at each use site — so the assertion walks
      // every inlined lifecycle enum instead of trusting one key to exist.
      const lifecycleEnums: string[][] = [];
      (function walk(node: unknown) {
        if (!node || typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        if (Array.isArray(obj.enum) && obj.enum.includes("hidden"))
          lifecycleEnums.push(obj.enum as string[]);
        for (const value of Object.values(obj)) walk(value);
      })(JSON.parse(raw));

      // At least one use site must exist, else the walk would pass vacuously.
      expect(lifecycleEnums.length).toBeGreaterThan(0);
      for (const values of lifecycleEnums)
        expect(values).not.toContain("archived");
      // And the old label survives nowhere else in the generated document.
      expect(raw).not.toContain("archived");
    });
  },
);
