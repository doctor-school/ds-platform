import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import {
  type PointsFact,
  type PointsPostingLeg,
  PointsAccountSchema,
} from "@ds/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { PointsLedgerService } from "../../src/points/points-ledger.service.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 025 EARS-2 / EARS-30 (#3813) — `GET /v1/me/points` over real postings
// written through the one ledger entry point (`PointsLedgerService.post`),
// behind a real 003 session. Postings are append-only, so every person, rule
// and event id is unique per run; the doctors' `users` rows stay in place
// (their accounts carry postings, which the ledger never deletes).
//
// Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL
// or IDP_ISSUER is absent.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 points consumer read GET /v1/me/points (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let ledger: PointsLedgerService;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const ruleId = `test-rule-${randomUUID()}`;
    const issuance = { kind: "system", code: "issuance" } as const;
    const reserve = { kind: "system", code: "reserve" } as const;
    const advance = { kind: "system", code: "advance" } as const;
    const sink = { kind: "system", code: "sink" } as const;

    /** Register + sign in a doctor; their session cookie and `users.id`. */
    async function doctor(): Promise<{ cookie: string; personId: string }> {
      const email = `points-read-${randomUUID()}@ds.test`;
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const cookie = await signIn(app, email, password, { device });
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email],
      );
      return { cookie, personId: rows[0]!.id };
    }

    function getPoints(cookie?: string, query = "") {
      return app.inject({
        method: "GET",
        url: `/v1/me/points${query}`,
        headers: cookie
          ? { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` }
          : device,
      });
    }

    function leg(
      name: string,
      debit: PointsPostingLeg["debit"],
      credit: PointsPostingLeg["credit"],
      amount: number,
      denomination: PointsPostingLeg["denomination"] = "pul",
    ): PointsPostingLeg {
      return {
        leg: name,
        debit,
        credit,
        denomination,
        amount,
        ruleId,
        ruleVersion: 1,
      };
    }

    function fact(eventId: string, legs: PointsPostingLeg[]): PointsFact {
      return { eventId, occurredAt: new Date(), legs };
    }

    function person(personId: string) {
      return { kind: "person", personId } as const;
    }

    async function accountRows(personId: string): Promise<number> {
      const { rows } = await pool.query(
        "SELECT 1 FROM points_accounts WHERE subject_kind = 'person' AND subject_id = $1",
        [personId],
      );
      return rows.length;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(fake)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          // Hermetic register fixture: bot protection is not under test.
          .overrideProvider(BOT_PROTECTION)
          .useValue({
            verify: (): Promise<BotProtectionResult> =>
              Promise.resolve({ ok: true }),
          } satisfies BotProtection),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      ledger = app.get(PointsLedgerService);
      // Every posting references a rule version (0058 FK); a per-run test rule.
      await pool.query(
        `INSERT INTO points_rule_versions (rule_id, version, parameters, effective_from)
         VALUES ($1, 1, '{}'::jsonb, '2026-01-01T00:00:00Z')`,
        [ruleId],
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    it("025 EARS-2: the signed-in doctor reads PointsAccount as a fold over their postings, the same on every request", async () => {
      const { cookie, personId } = await doctor();
      const me = person(personId);
      const open = randomUUID();
      const settled = randomUUID();
      await ledger.post(
        fact(randomUUID(), [
          leg("accrual:pul", issuance, me, 50),
          leg("accrual:bre", issuance, me, 3, "bre"),
          leg("accrual:con", issuance, me, 2, "con"),
        ]),
      );
      await ledger.post(
        fact(`reserve:${open}`, [
          leg("reserve:balance", me, reserve, 10),
          leg("reserve:advance", advance, reserve, 6),
        ]),
      );
      await ledger.post(
        fact(`reserve:${settled}`, [leg("reserve:balance", me, reserve, 20)]),
      );
      await ledger.post(
        fact(`settle:${settled}`, [leg("settle:pul", reserve, sink, 20)]),
      );
      await ledger.post(
        fact(randomUUID(), [
          leg("accrual:pul", issuance, me, 4),
          leg("obligation-settle:pul", me, advance, 4),
        ]),
      );

      const first = await getPoints(cookie);
      expect(first.statusCode).toBe(200);
      // A per-caller response is never cacheable.
      expect(first.headers["cache-control"]).toBe("no-store");
      expect(PointsAccountSchema.parse(first.json())).toEqual({
        personId,
        pul: { unit: "Pul", available: 20, reserved: 10 },
        bre: 3,
        con: 2,
        advance: { open: 1, remaining: 2 },
        status: "open",
      });
      const second = await getPoints(cookie);
      expect(second.json()).toEqual(first.json());
    });

    it("025 EARS-2: a doctor with no account yet reads the zero fold of an open account, and the read opens no account", async () => {
      const { cookie, personId } = await doctor();
      const res = await getPoints(cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        personId,
        pul: { unit: "Pul", available: 0, reserved: 0 },
        bre: 0,
        con: 0,
        advance: { open: 0, remaining: 0 },
        status: "open",
      });
      expect(await accountRows(personId)).toBe(0);
    });

    it("025 EARS-2: an unauthenticated request is refused with 401", async () => {
      expect((await getPoints()).statusCode).toBe(401);
    });

    it("025 EARS-2: a request for another person's account is refused with 403", async () => {
      const caller = await doctor();
      const other = await doctor();
      await ledger.post(
        fact(randomUUID(), [
          leg("accrual:pul", issuance, person(other.personId), 7),
        ]),
      );
      const foreign = await getPoints(
        caller.cookie,
        `?personId=${other.personId}`,
      );
      expect(foreign.statusCode).toBe(403);
      expect(foreign.body).not.toContain('"available"');
      const own = await getPoints(
        caller.cookie,
        `?personId=${caller.personId}`,
      );
      expect(own.statusCode).toBe(200);
      expect(own.json().personId).toBe(caller.personId);
    });

    it("025 EARS-2: the published contract of GET /v1/me/points takes no person identifier", () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const snapshot = JSON.parse(
        readFileSync(
          join(
            here,
            "..",
            "..",
            "..",
            "..",
            "packages",
            "api-client",
            "openapi.snapshot.json",
          ),
          "utf8",
        ),
      ) as {
        paths: Record<string, Record<string, { parameters?: unknown[] }>>;
      };
      const operation = snapshot.paths["/v1/me/points"]?.get;
      expect(operation).toBeDefined();
      // The person is the session subject: an SDK caller is never asked for
      // (or offered) a person id; `?personId=` exists only to be refused.
      expect(operation!.parameters ?? []).toEqual([]);
    });

    it("025 EARS-2: a closed account reads status closed with its postings unchanged", async () => {
      const { cookie, personId } = await doctor();
      await ledger.post(
        fact(randomUUID(), [leg("accrual:pul", issuance, person(personId), 9)]),
      );
      await ledger.close(personId, new Date());
      const body = (await getPoints(cookie)).json();
      expect(body.status).toBe("closed");
      expect(body.pul.available).toBe(9);
    });

    it("025 EARS-30: the response carries Pul as integers in unit Pul and no field states free, money, «бесплатно» or «баллы»", async () => {
      const { cookie, personId } = await doctor();
      await ledger.post(
        fact(randomUUID(), [
          leg("accrual:pul", issuance, person(personId), 12),
        ]),
      );
      const res = await getPoints(cookie);
      const body = res.json();
      expect(body.pul.unit).toBe("Pul");
      expect(Number.isInteger(body.pul.available)).toBe(true);
      expect(Number.isInteger(body.pul.reserved)).toBe(true);
      expect(res.body).not.toMatch(/free|money|price|бесплатн|балл/i);
    });
  },
);
