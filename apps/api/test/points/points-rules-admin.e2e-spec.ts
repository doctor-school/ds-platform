import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { POINTS_RULE_DEFAULTS } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";

// 025 EARS-25 (#3808) — `POST /v1/admin/points/rules/:ruleId/versions` over
// the REAL stack (Fastify + the 011 admin session + Postgres): validation
// against the rule's schema, refusal problems, the stored version, its 010
// audit row attributed to the admin, and the authz of the route. A published
// re-tune is followed by a publish of the PRD defaults (see
// points-rule-book.e2e-spec.ts for why). Skips when the stand is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 points rules admin API (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
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

    it("025 EARS-25: an admin publishes a rule version — validated, stored as the next immutable version, audited to the admin, effective from now", async () => {
      const before = await versionsOf("advance.cap");
      const res = await publish("advance.cap", { parameters: { pul: 120 } });
      expect(res.statusCode, res.payload).toBe(201);
      const body = json(res) as {
        ruleId: string;
        version: number;
        parameters: unknown;
        effectiveFrom: string;
        publishedBy: string | null;
      };
      expect(body).toMatchObject({
        ruleId: "advance.cap",
        version: before + 1,
        parameters: { pul: 120 },
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
            AND metadata -> 'pk' ->> 'rule_id' = 'advance.cap'
            AND metadata -> 'pk' ->> 'version' = $1`,
        [String(body.version)],
      );
      expect(audit).toEqual([{ subject_id: adminSub, source: "admin-ui" }]);

      const restore = await publish("advance.cap", {
        parameters: POINTS_RULE_DEFAULTS["advance.cap"],
      });
      expect(restore.statusCode, restore.payload).toBe(201);
      expect(json(restore).version).toBe(body.version + 1);
    });

    it("025 EARS-25: a later effectiveFrom is stored as given", async () => {
      const effectiveFrom = new Date(Date.now() + 86_400_000).toISOString();
      const res = await publish("noShow.window", {
        parameters: POINTS_RULE_DEFAULTS["noShow.window"],
        effectiveFrom,
      });
      expect(res.statusCode, res.payload).toBe(201);
      expect(Date.parse(json(res).effectiveFrom)).toBe(
        Date.parse(effectiveFrom),
      );
    });

    it("025 EARS-25: an unknown rule is 404, invalid parameters or a past effectiveFrom are 422, and nothing is stored", async () => {
      const unknown = await publish("accrual.prescription", {
        parameters: { pul: 10, bre: 0, con: 0 },
      });
      expect(unknown.statusCode, unknown.payload).toBe(404);
      expect(unknown.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(json(unknown).errorCode).toBe("POINTS_RULE_UNKNOWN");
      expect(json(unknown).type).toMatch(/\/points-rule-unknown$/);

      const before = await versionsOf("accrual.lesson");
      for (const parameters of [
        { pul: -5, bre: 1, con: 0 },
        { pul: 10, bre: 1, con: 0, sponsorId: "x" },
        { pul: 10, bre: 1 },
      ]) {
        const res = await publish("accrual.lesson", { parameters });
        expect(res.statusCode, res.payload).toBe(422);
        expect(json(res).errorCode).toBe("POINTS_RULE_PARAMETERS_INVALID");
        expect(json(res).errors.length).toBeGreaterThan(0);
      }
      const past = await publish("accrual.lesson", {
        parameters: POINTS_RULE_DEFAULTS["accrual.lesson"],
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(past.statusCode, past.payload).toBe(422);
      expect(json(past).errorCode).toBe("POINTS_RULE_EFFECTIVE_FROM_PAST");
      expect(await versionsOf("accrual.lesson")).toBe(before);
    });

    it("025 EARS-25: without an admin session, with a portal session or without platform_admin the publish is refused and nothing is stored", async () => {
      const before = await versionsOf("advance.cap");
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
          url: "/v1/admin/points/rules/advance.cap/versions",
          headers: {
            ...device,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          payload: { parameters: { pul: 1 } },
        });
        expect(res.statusCode, res.payload).toBe(401);
      }
      const other = await adminSession();
      await fake.revokeProjectRole(other.sub, "platform_admin");
      const forbidden = await publish(
        "advance.cap",
        { parameters: { pul: 1 } },
        other.sid,
      );
      expect(forbidden.statusCode, forbidden.payload).toBe(403);
      expect(await versionsOf("advance.cap")).toBe(before);
    });
  },
);
