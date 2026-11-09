import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { POINTS_FACT_TYPES, POINTS_PREDICATES } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { PointsEngine } from "../../src/points/engine/points-engine.service.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import { testFact, testRule, testRuleId } from "./engine-harness.js";

// 025 EARS-45 (#3841) — the admin read API over the REAL stack (Fastify + the
// 011 admin session + Postgres): `GET /v1/admin/points/fact-types` (the code
// catalog), `GET /v1/admin/points/rules` (every rule and setting id with its
// active version and history) and `GET /v1/admin/points/facts?personId=…`
// (one person's journal with its traces, keyset-paged). Admin role only; a
// session without `platform_admin` is 403 and no session is 401. Every rule
// is a test rule under a unique slug scoped to its test's runId
// (engine-harness.ts). Skips when the stand is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 points admin read API (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let engine: PointsEngine;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    let adminSid: string;
    let adminEmail: string;

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function adminSession(): Promise<{
      sid: string;
      sub: string;
      email: string;
    }> {
      const { email, sub } = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake,
        nextEmail: () => uniqueEmail("points-admin-read"),
        password,
        consent,
      });
      await fake.grantProjectRole(sub, "platform_admin");
      const { sid } = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return { sid, sub, email };
    }

    function get(url: string, headers: Record<string, string> = {}) {
      return app.inject({
        method: "GET",
        url,
        headers: { ...device, ...headers },
      });
    }
    const asAdmin = (url: string, sid: string = adminSid) =>
      get(url, adminHeaders(sid));
    const json = (res: { payload: string }) => JSON.parse(res.payload);

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      engine = app.get(PointsEngine);
      ({ sid: adminSid, email: adminEmail } = await adminSession());
    });

    afterAll(async () => {
      // The publishing admin stays: `points_rule_versions.published_by`
      // references it and a rule version is immutable (0059).
      for (const email of createdEmails.splice(0)) {
        if (email === adminEmail) continue;
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    it("EARS-45: an admin reads the fact-type catalog with its attribute schemas and predicates, exactly as the code registers them", async () => {
      const res = await asAdmin("/v1/admin/points/fact-types");
      expect(res.statusCode, res.payload).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(json(res)).toEqual(
        JSON.parse(
          JSON.stringify({
            factTypes: Object.values(POINTS_FACT_TYPES),
            predicates: Object.values(POINTS_PREDICATES),
          }),
        ),
      );
    });

    it("EARS-45: an admin reads every rule and setting id with its version history in version order and the version active now", async () => {
      const ruleId = testRuleId("e2e.admin-read");
      const parameters = testRule(randomUUID());
      const publish = (body: Record<string, unknown>) =>
        app.inject({
          method: "POST",
          url: `/v1/admin/points/rules/${ruleId}/versions`,
          headers: {
            ...device,
            ...adminHeaders(adminSid),
            "content-type": "application/json",
          },
          payload: body,
        });
      expect((await publish({ parameters })).statusCode).toBe(201);
      const later = new Date(Date.now() + 86_400_000).toISOString();
      expect(
        (await publish({ parameters, effectiveFrom: later })).statusCode,
      ).toBe(201);

      const res = await asAdmin("/v1/admin/points/rules");
      expect(res.statusCode, res.payload).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const { rules } = json(res) as {
        rules: Array<{
          ruleId: string;
          kind: string | null;
          activeVersion: number | null;
          versions: Array<{
            version: number;
            kind: string | null;
            parameters: unknown;
            effectiveFrom: string;
          }>;
        }>;
      };
      const ids = rules.map((r) => r.ruleId);
      expect(ids).toEqual(
        [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );

      const mine = rules.find((r) => r.ruleId === ruleId)!;
      expect(mine).toMatchObject({ kind: "rule", activeVersion: 1 });
      expect(mine.versions.map((v) => v.version)).toEqual([1, 2]);
      expect(mine.versions[0]!.parameters).toEqual(parameters);
      expect(Date.parse(mine.versions[1]!.effectiveFrom)).toBe(
        Date.parse(later),
      );

      // Settings are in the same read; every id's history equals the table's.
      const setting = rules.find(
        (r) => r.ruleId === "setting.effect.maxAmount",
      )!;
      expect(setting.kind).toBe("setting");
      const { rows } = await pool.query<{
        rule_id: string;
        versions: number[];
        active: number | null;
      }>(
        `SELECT rule_id,
                array_agg(version ORDER BY version) AS versions,
                max(version) FILTER (WHERE effective_from <= now()) AS active
           FROM points_rule_versions GROUP BY rule_id ORDER BY rule_id COLLATE "C"`,
      );
      for (const row of rows) {
        const entry = rules.find((r) => r.ruleId === row.rule_id);
        expect(entry, row.rule_id).toBeDefined();
        expect(
          entry!.versions.map((v) => v.version),
          row.rule_id,
        ).toEqual(row.versions);
        expect(entry!.activeVersion, row.rule_id).toBe(row.active);
      }
      expect(rules.length).toBe(rows.length);
    });

    it("EARS-45: an admin pages one person's journal newest first with its traces as stored — no duplicate, no gap, no other person's row", async () => {
      const runId = randomUUID();
      const personA = randomUUID();
      const personB = randomUUID();
      const recorded: string[] = [];
      for (let i = 0; i < 5; i++) {
        const fact = testFact(runId, personA);
        await engine.record(fact);
        recorded.push(fact.eventId);
      }
      await engine.record(testFact(runId, personB));

      const seen: Array<{
        eventId: string;
        type: string;
        receivedAt: string;
        outcome: string;
        trace: unknown;
      }> = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await asAdmin(
          `/v1/admin/points/facts?personId=${personA}&limit=2${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
          }`,
        );
        expect(res.statusCode, res.payload).toBe(200);
        expect(res.headers["cache-control"]).toBe("no-store");
        const page = json(res) as {
          items: typeof seen;
          nextCursor: string | null;
        };
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      expect(pages).toBeGreaterThanOrEqual(3);

      const ids = seen.map((s) => s.eventId);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual([...recorded].sort());
      const received = seen.map((s) => Date.parse(s.receivedAt));
      expect(received).toEqual([...received].sort((a, b) => b - a));

      const { rows } = await pool.query<{
        event_id: string;
        outcome: string;
        trace: unknown;
      }>(
        `SELECT event_id, outcome, trace FROM points_facts WHERE person_id = $1`,
        [personA],
      );
      for (const row of rows) {
        const item = seen.find((s) => s.eventId === row.event_id)!;
        expect(item.outcome).toBe(row.outcome);
        expect(item.trace).toEqual(row.trace);
        expect(item.type).toBe("person.starter-bonus-eligible");
      }
      // The response names no person and carries no attribution.
      expect(JSON.stringify(seen)).not.toContain(personB);
      expect(Object.keys(seen[0]!).sort()).toEqual(
        [
          "eventId",
          "occurredAt",
          "outcome",
          "receivedAt",
          "trace",
          "type",
        ].sort(),
      );
    });

    it("EARS-45: a malformed journal query is 400 points-facts-query-invalid", async () => {
      for (const query of [
        "",
        "?personId=not-a-uuid",
        `?personId=${randomUUID()}&limit=0`,
        `?personId=${randomUUID()}&limit=101`,
        `?personId=${randomUUID()}&cursor=not-a-cursor`,
      ]) {
        const res = await asAdmin(`/v1/admin/points/facts${query}`);
        expect(res.statusCode, `${query}: ${res.payload}`).toBe(400);
        expect(res.headers["content-type"]).toContain(
          "application/problem+json",
        );
        expect(json(res).errorCode).toBe("POINTS_FACTS_QUERY_INVALID");
      }
    });

    it("EARS-45: an admin-session principal without platform_admin is refused 403 on each route; a doctor's portal session and no session are refused 401", async () => {
      // A doctor holds no admin session (the 011 admin tier admits staff
      // roles only), so the 403 principal is staff without `platform_admin`.
      const { email: staffEmail, sub: staffSub } =
        await registerUniqueFakeUserFixture({
          app,
          pool,
          fake,
          nextEmail: () => uniqueEmail("points-admin-read-registrar"),
          password,
          consent,
        });
      await fake.grantProjectRole(staffSub, "event-registrar");
      const staff = await establishAdminSession(app, {
        identifier: staffEmail,
        password,
        device,
      });
      const email = uniqueEmail("points-admin-read-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      );
      const doctorId = rows[0]!.id;
      const portal = await signIn(app, email, password, { device });
      const routes = [
        "/v1/admin/points/fact-types",
        "/v1/admin/points/rules",
        `/v1/admin/points/facts?personId=${doctorId}`,
      ];
      for (const url of routes) {
        const forbidden = await asAdmin(url, staff.sid);
        expect(forbidden.statusCode, `${url}: ${forbidden.payload}`).toBe(403);
        for (const cookie of [undefined, `${SESSION_COOKIE_NAME}=${portal}`]) {
          const res = await get(url, cookie ? { cookie } : {});
          expect(res.statusCode, `${url}: ${res.payload}`).toBe(401);
        }
      }
    });
  },
);
