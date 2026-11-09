import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import type { PointsRecordFact, PutPointsPriceRequest } from "@ds/schemas";
import { expect } from "vitest";
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
import { PointsPricesService } from "../../src/points/points-prices.service.js";
import { registrationCreatedFact } from "../../src/points/registration-facts.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { eventClassificationSql } from "../setup/event-classification.js";

// Shared harness of the 025 spend e2e specs (#3810) over the REAL stack
// (Fastify + Postgres migrated through 0061 + the fake IdP). Persons, items,
// registrations and fact ids are unique per run; postings, journal rows and
// hold projections are append-only ledger state, so they are not tidied. An
// item that is not an event is priced under a unique `course:<uuid>` ref —
// the price list takes any registered kind (owner decision 1).

export const DEVICE = { "user-agent": "Test/1.0", "accept-language": "en-US" };
const PASSWORD = "Aa1!ufficiently-long-pw";
const CONSENT = [{ purpose: "tos", version: "2026-01" }];

export interface SpendHarness {
  app: NestFastifyApplication;
  pool: pg.Pool;
  engine: PointsEngine;
  ledger: PointsLedgerService;
  prices: PointsPricesService;
  fake: FakeIdpClient;
  /** The manual rule version a funding accrual cites. */
  fundingRuleId: string;
}

export async function bootSpend(): Promise<SpendHarness> {
  const fake = new FakeIdpClient();
  const moduleRef: TestingModule = await withSignInHost(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(fake)
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      .overrideProvider(BOT_PROTECTION)
      .useValue({
        verify: (): Promise<BotProtectionResult> =>
          Promise.resolve({ ok: true }),
      } satisfies BotProtection),
  ).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const pool = app.get<pg.Pool>(DRIZZLE_POOL);
  const fundingRuleId = `test-rule-${randomUUID()}`;
  await pool.query(
    `INSERT INTO points_rule_versions (rule_id, version, parameters, effective_from)
     VALUES ($1, 1, '{}'::jsonb, '2026-01-01T00:00:00Z')`,
    [fundingRuleId],
  );
  return {
    app,
    pool,
    engine: app.get(PointsEngine),
    ledger: app.get(PointsLedgerService),
    prices: app.get(PointsPricesService),
    fake,
    fundingRuleId,
  };
}

/** Register + sign in a doctor; their session cookie and `users.id`. */
export async function doctor(
  h: SpendHarness,
): Promise<{ cookie: string; personId: string }> {
  const email = `points-spend-${randomUUID()}@ds.test`;
  const reg = await h.app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: PASSWORD, consent: CONSENT },
  });
  expect(reg.statusCode, reg.payload).toBe(200);
  const cookie = await signIn(h.app, email, PASSWORD, { device: DEVICE });
  const { rows } = await h.pool.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  return { cookie, personId: rows[0]!.id };
}

export function sessionHeaders(cookie?: string) {
  return cookie
    ? { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${cookie}` }
    : DEVICE;
}

/** Records `phone.verified` for the person (EARS-5: a debit-side effect needs it). */
export async function verifyPhone(h: SpendHarness, personId: string) {
  await h.engine.record({
    type: "phone.verified",
    eventId: `e2e-phone:${randomUUID()}`,
    personId,
    occurredAt: new Date(),
    attributes: {},
  });
}

/** Credits `amount` Pul to the person (an issuance accrual on a test rule version). */
export async function fund(h: SpendHarness, personId: string, amount: number) {
  await h.ledger.post({
    eventId: `e2e-fund:${randomUUID()}`,
    occurredAt: new Date(),
    legs: [
      {
        leg: "accrual:pul",
        debit: { kind: "system", code: "issuance" },
        credit: { kind: "person", personId },
        denomination: "pul",
        amount,
        ruleId: h.fundingRuleId,
        ruleVersion: 1,
      },
    ],
  });
}

/** A verified-phone person (no `users` row needed by the engine) funded with `pul`. */
export async function payer(h: SpendHarness, pul: number): Promise<string> {
  const personId = randomUUID();
  await verifyPhone(h, personId);
  if (pul > 0) await fund(h, personId, pul);
  return personId;
}

/** Prices a fresh non-event item through the EARS-26 service; its ref. */
export async function pricedItem(
  h: SpendHarness,
  body: Omit<PutPointsPriceRequest, "itemKind"> & {
    itemKind?: PutPointsPriceRequest["itemKind"];
  },
): Promise<string> {
  const itemRef = `course:${randomUUID()}`;
  await h.prices.put(itemRef, { itemKind: "course", ...body }, null);
  return itemRef;
}

/** The sign-up fact of a fresh registration of `personId` on `itemRef`. */
export function signUp(personId: string, itemRef: string): PointsRecordFact {
  return registrationCreatedFact({
    registrationId: randomUUID(),
    personId,
    itemRef,
    occurredAt: new Date(),
  });
}

/** An `attendance.confirmed` for the registration at `share` %. */
export function attended(
  signUpFact: PointsRecordFact,
  share: number,
  eventId = `e2e-attendance:${randomUUID()}`,
): PointsRecordFact {
  return {
    type: "attendance.confirmed",
    eventId,
    personId: signUpFact.personId,
    ref: signUpFact.ref,
    occurredAt: new Date(),
    attributes: {
      registrationId: signUpFact.attributes.registrationId,
      presenceSharePercent: share,
    },
  };
}

/** The hold projection row of a registration, or undefined. */
export async function reserveOf(h: SpendHarness, registrationId: unknown) {
  const { rows } = await h.pool.query<{
    state: string;
    price: number;
    balance_part: number;
    item_ref: string;
  }>(
    "SELECT state, price, balance_part, item_ref FROM points_reserves WHERE registration_id = $1",
    [registrationId],
  );
  return rows[0];
}

/** Pul available on the person's account (Σ credits − Σ debits). */
export async function pulOf(h: SpendHarness, personId: string): Promise<number> {
  const { rows } = await h.pool.query<{ n: string }>(
    `SELECT coalesce(sum(CASE WHEN p.credit_account_id = a.id THEN p.amount ELSE -p.amount END), 0) AS n
       FROM points_accounts a
       JOIN points_postings p ON a.id IN (p.credit_account_id, p.debit_account_id)
      WHERE a.subject_kind = 'person' AND a.subject_id = $1 AND p.denomination = 'pul'`,
    [personId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Every posting of a person's account, by leg. */
export async function postingsOfPerson(h: SpendHarness, personId: string) {
  const { rows } = await h.pool.query<{
    event_id: string;
    leg: string;
    amount: number;
    reverses_posting_id: string | null;
  }>(
    `SELECT p.event_id, p.leg, p.amount, p.reverses_posting_id
       FROM points_postings p
       JOIN points_accounts a ON a.id IN (p.credit_account_id, p.debit_account_id)
      WHERE a.subject_kind = 'person' AND a.subject_id = $1
      ORDER BY p.recorded_at, p.event_id, p.leg`,
    [personId],
  );
  return rows;
}

/** A platform event in `state`, started `startedHoursAgo` hours ago. */
export async function seedEvent(
  h: SpendHarness,
  opts: { state?: string; startedHoursAgo?: number; durationMin?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await h.pool.query(
    `INSERT INTO events
       (id, slug, title, school, starts_at, duration_min, description,
        specialties, partner_ref, program_pdf_ref, state, kind_id, audience)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ${eventClassificationSql()})`,
    [
      id,
      `pts-spend-${id.slice(0, 8)}`,
      "Эфир с ценой",
      "Кардиология сегодня",
      new Date(Date.now() - (opts.startedHoursAgo ?? 0) * 3600_000).toISOString(),
      opts.durationMin ?? 60,
      "",
      ["cardiology"],
      null,
      null,
      opts.state ?? "published",
    ],
  );
  return id;
}
