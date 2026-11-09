import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
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
import { TEST_FACT_TYPE, testFact, testRule, testRuleId } from "./engine-harness.js";

// 025 amended EARS-25 and EARS-42 (#3838) — `POST
// /v1/admin/points/rules/:ruleId/versions` over the REAL stack (Fastify + the
// 011 admin session + Postgres): a new admin slug published as data, the
// one-schema validation with field paths, refusal problems, the stored
// version and its 010 audit row attributed to the admin, the authz of the
// route, and that a publish never re-evaluates a journaled fact. Every rule is
// a test rule under a unique slug scoped to its test's runId (isolation:
// engine-harness.ts) — no seeded rule is re-tuned. Skips when the stand is
// absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 points rules admin API (e2e)",
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
    let adminSub: string;
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
        nextEmail: () => uniqueEmail("points-admin"),
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

    function publish(
      ruleId: string,
      payload: Record<string, unknown>,
      sid: string = adminSid,
    ) {
      return app.inject({
        method: "POST",
        url: `/v1/admin/points/rules/${ruleId}/versions`,
        headers: {
          ...device,
          ...adminHeaders(sid),
          "content-type": "application/json",
        },
        payload,
      });
    }

    const json = (res: { payload: string }) => JSON.parse(res.payload);
    const paths = (res: { payload: string }): string[] =>
      ((json(res).errors ?? []) as Array<{ path: string }>).map((e) => e.path);

    async function versionsOf(ruleId: string): Promise<number> {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM points_rule_versions WHERE rule_id = $1`,
        [ruleId],
      );
      return rows[0]!.n;
    }

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
      ({
        sid: adminSid,
        sub: adminSub,
        email: adminEmail,
      } = await adminSession());
    });

    afterAll(async () => {
      // The publishing admin stays: `points_rule_versions.published_by`
      // references it and a rule version is immutable (0059), exactly as in
      // production, where an account is re-pointed by the ADR-0009 erasure
      // procedure and never deleted. Every other fixture user is removed.
      for (const email of createdEmails.splice(0)) {
        if (email === adminEmail) continue;
        await deleteUserFixture(pool, "email", email);
      }
      await app.close();
    });

    it("025 EARS-25: an admin publishes a new rule slug as data — version 1, kind rule, a stacking warning, audited to the admin, effective from now", async () => {
      const ruleId = testRuleId("e2e.admin");
      const parameters = testRule(randomUUID());
      const res = await publish(ruleId, { parameters });
      expect(res.statusCode, res.payload).toBe(201);
      const body = json(res) as {
        ruleId: string;
        version: number;
        kind: string;
        parameters: unknown;
        effectiveFrom: string;
        publishedBy: string | null;
        warnings: Array<{ code: string; factType: string; otherRuleId: string }>;
      };
      expect(body).toMatchObject({ ruleId, version: 1, kind: "rule", parameters });
      // The seeded starter bonus also credits on the same fact type, outside
      // any shared exclusive group.
      expect(body.warnings).toContainEqual({
        code: "stacking",
        factType: TEST_FACT_TYPE,
        otherRuleId: "accrual.starter-bonus",
      });
      const { rows: user } = await pool.query<{ id: string }>(
        `SELECT id FROM users WHERE zitadel_sub = $1`,
        [adminSub],
      );
      expect(body.publishedBy).toBe(user[0]!.id);
      expect(
        Math.abs(Date.parse(body.effectiveFrom) - Date.now()),
      ).toBeLessThan(60_000);

      const { rows: audit } = await pool.query<{
        subject_id: string | null;
        source: string;
      }>(
        `SELECT subject_id, metadata ->> 'source' AS source FROM audit_ledger
          WHERE event_type = 'data.points_rule_versions.insert'
            AND metadata -> 'pk' ->> 'rule_id' = $1
            AND metadata -> 'pk' ->> 'version' = '1'`,
        [ruleId],
      );
      expect(audit).toEqual([{ subject_id: adminSub, source: "admin-ui" }]);
    });

    it("025 EARS-25: a later effectiveFrom is stored as given, as the next version", async () => {
      const ruleId = testRuleId("e2e.admin");
      const parameters = testRule(randomUUID());
      expect((await publish(ruleId, { parameters })).statusCode).toBe(201);
      const effectiveFrom = new Date(Date.now() + 86_400_000).toISOString();
      const res = await publish(ruleId, { parameters, effectiveFrom });
      expect(res.statusCode, res.payload).toBe(201);
      expect(json(res).version).toBe(2);
      expect(Date.parse(json(res).effectiveFrom)).toBe(
        Date.parse(effectiveFrom),
      );
    });

    it("025 EARS-25: an invalid body is 422 with field paths, a retired id is 422 POINTS_RULE_RETIRED, a past effectiveFrom is 422 — and nothing is stored", async () => {
      const runId = randomUUID();
      const ruleId = testRuleId("e2e.admin");
      const cases: Array<[unknown, string]> = [
        [testRule(runId, { trigger: ["no.such-fact" as never] }), "trigger.0"],
        [
          testRule(runId, { condition: { eq: [{ attr: "noSuchAttr" }, 1] } }),
          "condition.eq.0.attr",
        ],
        [
          testRule(runId, {
            effect: { kind: "debit", amounts: { bre: 5 } as never },
          }),
          "effect.amounts",
        ],
        [testRule(runId, { limits: [] }), "limits"],
      ];
      for (const [parameters, path] of cases) {
        const res = await publish(ruleId, { parameters });
        expect(res.statusCode, res.payload).toBe(422);
        expect(res.headers["content-type"]).toContain("application/problem+json");
        expect(json(res).errorCode).toBe("POINTS_RULE_PARAMETERS_INVALID");
        expect(
          paths(res).some((p) => p === path || p.startsWith(`${path}.`)),
          `${path} in ${res.payload}`,
        ).toBe(true);
      }
      const past = await publish(ruleId, {
        parameters: testRule(runId),
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(past.statusCode, past.payload).toBe(422);
      expect(json(past).errorCode).toBe("POINTS_RULE_EFFECTIVE_FROM_PAST");
      expect(await versionsOf(ruleId)).toBe(0);

      // A version keeps its kind: a setting body for a rule slug is refused.
      expect((await publish(ruleId, { parameters: testRule(runId) })).statusCode).toBe(201);
      const kind = await publish(ruleId, {
        parameters: { kind: "setting", value: 1 },
      });
      expect(kind.statusCode, kind.payload).toBe(422);
      expect(paths(kind)).toContain("kind");
      expect(await versionsOf(ruleId)).toBe(1);

      const retiredBefore = await versionsOf("cap.engagement");
      const retired = await publish("cap.engagement", {
        parameters: testRule(runId),
      });
      expect(retired.statusCode, retired.payload).toBe(422);
      expect(json(retired).errorCode).toBe("POINTS_RULE_RETIRED");
      expect(json(retired).type).toMatch(/\/points-rule-retired$/);
      expect(await versionsOf("cap.engagement")).toBe(retiredBefore);
    });

    it("025 EARS-25: without an admin session, with a portal session or without platform_admin the publish is refused and nothing is stored", async () => {
      const ruleId = testRuleId("e2e.admin");
      const parameters = testRule(randomUUID());
      const email = uniqueEmail("points-doctor");
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const portal = await signIn(app, email, password, { device });
      for (const cookie of [undefined, `${SESSION_COOKIE_NAME}=${portal}`]) {
        const res = await app.inject({
          method: "POST",
          url: `/v1/admin/points/rules/${ruleId}/versions`,
          headers: {
            ...device,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          payload: { parameters },
        });
        expect(res.statusCode, res.payload).toBe(401);
      }
      const other = await adminSession();
      await fake.revokeProjectRole(other.sub, "platform_admin");
      const forbidden = await publish(ruleId, { parameters }, other.sid);
      expect(forbidden.statusCode, forbidden.payload).toBe(403);
      expect(await versionsOf(ruleId)).toBe(0);
    });

    it("025 EARS-42: a publish never re-evaluates a journaled fact — a replay stays duplicate, a late report dated before the publish is not evaluated by it, the next fact applies", async () => {
      const runId = randomUUID();
      const ruleId = testRuleId("e2e.admin");
      const personId = randomUUID();
      const earlier = testFact(runId, personId);
      const first = await engine.record(earlier);
      expect(first.trace.map((t) => t.ruleId)).not.toContain(ruleId);
      const publishedAt = Date.now();
      expect((await publish(ruleId, { parameters: testRule(runId) })).statusCode).toBe(201);

      const replay = await engine.record(earlier);
      expect(replay.outcome).toBe("duplicate");
      // A duplicate answers what the first evaluation applied — never the new rule.
      expect(replay.applied.map((a) => a.ruleId)).toEqual(
        first.applied.map((a) => a.ruleId),
      );
      expect(replay.applied.map((a) => a.ruleId)).not.toContain(ruleId);
      const { rows: postings } = await pool.query(
        `SELECT 1 FROM points_postings WHERE event_id = $1`,
        [`${earlier.eventId}#${ruleId}`],
      );
      expect(postings).toEqual([]);

      const late = await engine.record(
        testFact(runId, personId, { occurredAt: new Date(publishedAt - 5_000) }),
      );
      expect(late.trace.map((t) => t.ruleId)).not.toContain(ruleId);

      const next = await engine.record(testFact(runId, personId));
      expect(next.trace.find((t) => t.ruleId === ruleId)?.verdict).toBe("applied");
    });
  },
);
