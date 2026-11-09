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
  type PointsPostingHistory,
  type PointsPostingLeg,
  POINTS_POSTING_HISTORY_LIMIT,
  PointsPostingHistorySchema,
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
import { PointsEngine } from "../../src/points/engine/points-engine.service.js";
import { PointsLedgerService } from "../../src/points/points-ledger.service.js";
import { RuleBookService } from "../../src/points/rule-book.service.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { publishRule, testRule, testRuleId } from "./engine-harness.js";

// 025 EARS-46 / EARS-30 (#3842) — `GET /v1/me/points/postings`, the doctor's
// own posting history, over real postings written through the ledger entry
// point (`PointsLedgerService.post`) and the engine (`PointsEngine.record`),
// behind a real 003 session. Postings are append-only, so every person, rule
// and event id is unique per run.
//
// Runs against the dev-stand Postgres + the fake IdP; skips when DATABASE_URL
// or IDP_ISSUER is absent.

/** The only keys a history item may carry (EARS-46 — no attribution, no counterparty). */
const ITEM_KEYS = new Set([
  "postingId",
  "occurredAt",
  "denomination",
  "amount",
  "action",
  "contentRef",
  "ruleId",
  "ruleVersion",
  "reversesPostingId",
]);

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "025 points posting history GET /v1/me/points/postings (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let ledger: PointsLedgerService;
    let engine: PointsEngine;
    let rules: RuleBookService;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const ruleId = `test-rule-${randomUUID()}`;
    const issuance = { kind: "system", code: "issuance" } as const;
    const sink = { kind: "system", code: "sink" } as const;

    async function doctor(): Promise<{ cookie: string; personId: string }> {
      const email = `points-history-${randomUUID()}@ds.test`;
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

    function getHistory(cookie?: string, query = "") {
      return app.inject({
        method: "GET",
        url: `/v1/me/points/postings${query}`,
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
        action: "e2e.history",
      };
    }

    function fact(
      legs: PointsPostingLeg[],
      occurredAt = new Date(),
    ): PointsFact {
      return { eventId: `e2e-history:${randomUUID()}`, occurredAt, legs };
    }

    function person(personId: string) {
      return { kind: "person", personId } as const;
    }

    /**
     * A test rule on `type` with no condition, isolated by its validity
     * window instead: [at, at + 1 ms) on a unique instant a few minutes
     * ahead (a version applies from its `effective_from` = now, EARS-42),
     * which only the test's own fact (occurring exactly at `at`) falls in —
     * the catalog types used here declare no attribute a condition could pin
     * to the run, so no other suite's fact of the type ever matches it.
     */
    async function windowRule(
      type: "event.rated" | "referral.attributed",
      at: Date,
    ) {
      const id = testRuleId("e2e.history");
      const { condition: _none, ...body } = testRule(randomUUID(), {
        trigger: [type],
        validFrom: at.toISOString(),
        validUntil: new Date(at.getTime() + 1).toISOString(),
      });
      const published = await publishRule(rules, id, body);
      return { id, version: published.row.version };
    }

    /** A unique instant 1–18 minutes ahead, well inside the one-day skew bound. */
    function uniqueSoon(): Date {
      return new Date(Date.now() + 60_000 + Math.floor(Math.random() * 1e6));
    }

    /** Every page of the caller's history, following `nextCursor`. */
    async function allPages(cookie: string, limit: number) {
      const pages: PointsPostingHistory[] = [];
      let cursor: string | null = null;
      do {
        const query: string = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const res = await getHistory(cookie, query);
        expect(res.statusCode).toBe(200);
        const page = PointsPostingHistorySchema.parse(res.json());
        pages.push(page);
        cursor = page.nextCursor;
      } while (cursor !== null && pages.length < 50);
      return pages;
    }

    /** The person account's posting ids, newest first by (occurred_at, id). */
    async function expectedOrder(personId: string): Promise<string[]> {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT p.id FROM points_postings p
           JOIN points_accounts a ON a.id IN (p.credit_account_id, p.debit_account_id)
          WHERE a.subject_kind = 'person' AND a.subject_id = $1
          ORDER BY p.occurred_at DESC, p.id DESC`,
        [personId],
      );
      return rows.map((r) => r.id);
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
      engine = app.get(PointsEngine, { strict: false });
      rules = app.get(RuleBookService, { strict: false });
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

    it("EARS-46: when A requests the posting history, the system shall return only A's postings newest first with signed amounts, paged by a stable cursor without duplicates or gaps", async () => {
      const a = await doctor();
      const h = await doctor();
      const me = person(a.personId);
      const hour = 60 * 60 * 1000;
      const now = Date.now();
      // Oldest: a three-leg fact — three postings sharing one occurred_at.
      await ledger.post(
        fact(
          [
            leg("accrual:pul", issuance, me, 30),
            leg("accrual:bre", issuance, me, 3, "bre"),
            leg("accrual:con", issuance, me, 2, "con"),
          ],
          new Date(now - 3 * hour),
        ),
      );
      await ledger.post(
        fact([leg("spend:pul", me, sink, 10)], new Date(now - 2 * hour)),
      );
      await ledger.post(
        fact([leg("accrual:pul", issuance, me, 5)], new Date(now - hour)),
      );
      // H's postings interleave in time with A's.
      await ledger.post(
        fact(
          [leg("accrual:pul", issuance, person(h.personId), 7)],
          new Date(now - 90 * 60 * 1000),
        ),
      );
      const hIds = await expectedOrder(h.personId);
      expect(hIds).toHaveLength(1);

      const full = await getHistory(a.cookie);
      expect(full.statusCode).toBe(200);
      expect(full.headers["cache-control"]).toBe("no-store");
      const body = PointsPostingHistorySchema.parse(full.json());
      expect(body.nextCursor).toBeNull();
      expect(body.items.map((i) => i.postingId)).toEqual(
        await expectedOrder(a.personId),
      );
      expect(
        body.items.map((i) => [i.denomination, i.amount, i.action]),
      ).toEqual([
        ["pul", 5, "e2e.history"],
        ["pul", -10, "e2e.history"],
        // The three legs share occurred_at; their order is by id.
        ...body.items
          .slice(2)
          .map((i) => [i.denomination, i.amount, "e2e.history"]),
      ]);
      expect(
        body.items
          .slice(2)
          .map((i) => `${i.denomination}:${i.amount}`)
          .sort(),
      ).toEqual(["bre:3", "con:2", "pul:30"]);
      for (const item of body.items) {
        expect(item.ruleId).toBe(ruleId);
        expect(item.ruleVersion).toBe(1);
        for (const key of Object.keys(item)) expect(ITEM_KEYS).toContain(key);
      }
      // No identifier of H — neither the person nor H's posting.
      expect(full.body).not.toContain(h.personId);
      expect(full.body).not.toContain(hIds[0]!);

      // limit=2 pages through a boundary inside the equal-occurred_at group.
      const pages = await allPages(a.cookie, 2);
      expect(pages.map((p) => p.items.length)).toEqual([2, 2, 1]);
      expect(pages.at(-1)!.nextCursor).toBeNull();
      expect(pages.flatMap((p) => p.items.map((i) => i.postingId))).toEqual(
        body.items.map((i) => i.postingId),
      );
      // The cursor is stable: re-reading a page answers the same page.
      const again = await getHistory(
        a.cookie,
        `?limit=2&cursor=${encodeURIComponent(pages[0]!.nextCursor!)}`,
      );
      expect(again.json()).toEqual(pages[1]);
    });

    it("EARS-46: an engine-recorded posting carries the fact type as action, its content ref, rule id and version, and no attribution or output field", async () => {
      const a = await doctor();
      const runRef = `e2e-item-${randomUUID()}`;
      const outputId = randomUUID();
      const at = uniqueSoon();
      const rule = await windowRule("event.rated", at);
      await engine.record({
        type: "event.rated",
        eventId: `e2e-history-fact:${randomUUID()}`,
        personId: a.personId,
        ref: runRef,
        occurredAt: at,
        attributes: {},
        output: { type: "e2e-output", id: outputId },
      });
      const res = await getHistory(a.cookie);
      expect(res.statusCode).toBe(200);
      const body = PointsPostingHistorySchema.parse(res.json());
      const item = body.items.find((i) => i.ruleId === rule.id);
      expect(item).toEqual({
        postingId: expect.any(String),
        occurredAt: at.toISOString(),
        denomination: "bre",
        amount: 5,
        action: "event.rated",
        contentRef: runRef,
        ruleId: rule.id,
        ruleVersion: rule.version,
      });
      expect(res.body).not.toContain(outputId);
      expect(res.body).not.toMatch(/project|output|attribut/i);
    });

    it("EARS-46: a fact whose ref is another person (a referral) never exposes that person's identifier", async () => {
      const a = await doctor();
      const h = await doctor();
      const at = uniqueSoon();
      const rule = await windowRule("referral.attributed", at);
      await engine.record({
        type: "referral.attributed",
        eventId: `e2e-history-fact:${randomUUID()}`,
        personId: a.personId,
        ref: h.personId,
        occurredAt: at,
        attributes: {},
      });
      const res = await getHistory(a.cookie);
      const body = PointsPostingHistorySchema.parse(res.json());
      const item = body.items.find((i) => i.ruleId === rule.id);
      expect(item?.action).toBe("referral.attributed");
      expect(item).not.toHaveProperty("contentRef");
      expect(res.body).not.toContain(h.personId);
    });

    it("EARS-46: a compensating reversal shows the reversed posting as reversesPostingId, debited negative", async () => {
      const a = await doctor();
      const me = person(a.personId);
      const posted = await ledger.post(
        fact([leg("accrual:bre", issuance, me, 4, "bre")]),
      );
      const original = posted.postings[0]!;
      await ledger.post(
        fact([
          {
            ...leg("reversal:bre", me, issuance, 4, "bre"),
            reverses: {
              postingId: original.id,
              occurredAt: original.occurredAt,
            },
          },
        ]),
      );
      const body = PointsPostingHistorySchema.parse(
        (await getHistory(a.cookie)).json(),
      );
      const reversal = body.items.find(
        (i) => i.reversesPostingId === original.id,
      );
      expect(reversal).toMatchObject({ denomination: "bre", amount: -4 });
      const reversed = body.items.find((i) => i.postingId === original.id);
      expect(reversed).not.toHaveProperty("reversesPostingId");
      expect(reversed?.amount).toBe(4);
    });

    it("EARS-46: a doctor with no account yet reads an empty history, and the read opens no account", async () => {
      const a = await doctor();
      const res = await getHistory(a.cookie);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [], nextCursor: null });
      const { rows } = await pool.query(
        "SELECT 1 FROM points_accounts WHERE subject_kind = 'person' AND subject_id = $1",
        [a.personId],
      );
      expect(rows).toHaveLength(0);
    });

    it("EARS-46: an unauthenticated request is refused with 401", async () => {
      expect((await getHistory()).statusCode).toBe(401);
    });

    it("EARS-46: a request naming another person is refused with 403", async () => {
      const a = await doctor();
      const h = await doctor();
      const res = await getHistory(a.cookie, `?personId=${h.personId}`);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('"items"');
    });

    it.each([
      ["limit=0"],
      [`limit=${POINTS_POSTING_HISTORY_LIMIT.max + 1}`],
      ["limit=abc"],
      ["limit=1.5"],
      ["cursor=not-a-cursor"],
    ])(
      "EARS-46: an out-of-range page query (%s) is refused with problem points-history-query-invalid",
      async (query) => {
        const a = await doctor();
        const res = await getHistory(a.cookie, `?${query}`);
        expect(res.statusCode).toBe(400);
        expect(res.headers["content-type"]).toContain(
          "application/problem+json",
        );
        const problem = res.json();
        expect(problem.errorCode).toBe("POINTS_HISTORY_QUERY_INVALID");
        expect(problem.type).toMatch(/\/points-history-query-invalid$/);
      },
    );

    it("EARS-46: the published contract of GET /v1/me/points/postings takes only cursor and limit", () => {
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
        paths: Record<
          string,
          Record<string, { parameters?: { name: string; in: string }[] }>
        >;
      };
      const operation = snapshot.paths["/v1/me/points/postings"]?.get;
      expect(operation).toBeDefined();
      expect(
        (operation!.parameters ?? []).map((p) => `${p.in}:${p.name}`).sort(),
      ).toEqual(["query:cursor", "query:limit"]);
    });

    it("EARS-30: history amounts are integers and no field states free, money, «бесплатно» or «баллы»", async () => {
      const a = await doctor();
      await ledger.post(
        fact([leg("accrual:pul", issuance, person(a.personId), 12)]),
      );
      const res = await getHistory(a.cookie);
      const body = PointsPostingHistorySchema.parse(res.json());
      expect(body.items.every((i) => Number.isInteger(i.amount))).toBe(true);
      expect(res.body).not.toMatch(/free|money|price|бесплатн|балл/i);
    });
  },
);
