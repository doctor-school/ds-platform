import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  FakeIdpClient,
  FAKE_LOCKOUT_THRESHOLD,
} from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// EARS-18 (audit_ledger writer) + EARS-15 (native-lockout observation), over
// HTTP into the real durable ledger. Every state-changing auth command must
// append exactly one terminal row with its canonical `auth.<class>.<event>` wire
// id (ADR-0001 §7.3) and NO raw PD — only a hashed identifier (ADR-0003 §6).
describe.skipIf(!process.env.DATABASE_URL)("Auth audit ledger (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  // The ledger is append-only (DELETE is trigger-blocked), so rows from prior
  // runs persist and the fake's deterministic `fake-sub-N` numbering repeats
  // across runs. Scope every assertion to rows this run appended.
  let since: string;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "Aa1!ufficiently-long-pw";
  const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
  const createdEmails: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears18-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  /** Ledger rows matching `predicateSql` ($1=`param`), scoped to this run ($2=`since`). */
  async function rowsFor(predicateSql: string, param: string) {
    const { rows } = await pool.query(
      `SELECT event_type, subject_id, sid, reason, metadata FROM audit_ledger
       WHERE ${predicateSql} AND created_at >= $2`,
      [param, since],
    );
    return rows as {
      event_type: string;
      subject_id: string | null;
      sid: string | null;
      reason: string | null;
      metadata: Record<string, unknown>;
    }[];
  }

  async function register(email: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(res.statusCode).toBe(200);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient())
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
    // DB clock, not the test host's — the lower bound every query is scoped to.
    since = (await pool.query<{ now: string }>("SELECT now() AS now")).rows[0]!
      .now;
  });

  afterEach(async () => {
    for (const email of createdEmails.splice(0))
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-18: when a visitor registers, the system shall append one auth.register row carrying the subject and consent, with no raw identifier", async () => {
    const email = uniqueEmail("reg");
    await register(email);

    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    expect(rows).toHaveLength(1);

    // Resolve the Zitadel sub the BFF audited under, via the subject's session.
    const sub = await subjectForEmail(email);
    const ledger = await rowsFor("subject_id = $1", sub);
    const registerRows = ledger.filter((r) => r.event_type === "auth.register");
    expect(registerRows).toHaveLength(1);
    expect(registerRows[0]?.metadata).toMatchObject({
      channel: "email",
      consent: [{ purpose: "tos", version: "2026-01" }],
    });
    // PD masking: the raw email appears nowhere in the row.
    expect(JSON.stringify(registerRows[0])).not.toContain(email);
  });

  it("EARS-18: when a login succeeds, the system shall append auth.login.success with the method", async () => {
    const email = uniqueEmail("ok");
    await register(email);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(res.statusCode).toBe(200);

    const sub = await subjectForEmail(email);
    const ledger = await rowsFor("subject_id = $1", sub);
    const success = ledger.filter((r) => r.event_type === "auth.login.success");
    expect(success).toHaveLength(1);
    expect(success[0]?.metadata).toMatchObject({ method: "password" });
  });

  it("EARS-18: when a login fails, the system shall append auth.login.failure with a hashed identifier and no subject", async () => {
    const email = uniqueEmail("bad");
    await register(email);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password: "wrong-password-here" },
    });
    expect(res.statusCode).toBe(401);

    const failures = await rowsFor("event_type = $1", "auth.login.failure");
    const mine = failures.filter(
      (r) => typeof r.metadata.identifier_hash === "string",
    );
    // At least our failure is present; it carries no subject and no raw email.
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(failures)).not.toContain(email);
    expect(failures.every((r) => r.subject_id === null)).toBe(true);
  });

  it("EARS-15: when password attempts reach the native lockout threshold, the system shall append exactly one auth.lockout.triggered", async () => {
    const email = uniqueEmail("lock");
    await register(email);
    const sub = await subjectForEmail(email);

    // Drive failures up to the native threshold (the fake models the count).
    for (let i = 0; i < FAKE_LOCKOUT_THRESHOLD; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password: "wrong-password-here" },
      });
    }

    const ledger = await rowsFor("subject_id = $1", sub);
    const lockouts = ledger.filter(
      (r) => r.event_type === "auth.lockout.triggered",
    );
    // Exactly once — the state transition, not once per failed attempt.
    expect(lockouts).toHaveLength(1);
    expect(lockouts[0]?.reason).toBe("lock");
  });

  it("EARS-18: when an authenticated user logs out, the system shall append auth.session.terminated (reason logout)", async () => {
    const email = uniqueEmail("out");
    await register(email);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    const cookieValue = login.cookies.find(
      (c) => c.name === SESSION_COOKIE_NAME,
    )!.value;
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`;

    await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...device, cookie },
    });

    const sub = await subjectForEmail(email);
    const ledger = await rowsFor("subject_id = $1", sub);
    const terminated = ledger.filter(
      (r) => r.event_type === "auth.session.terminated",
    );
    expect(terminated).toHaveLength(1);
    expect(terminated[0]?.reason).toBe("logout");
  });

  it("EARS-18: when a password reset is requested, the system shall append auth.password.reset_requested with a hashed identifier", async () => {
    const email = uniqueEmail("reset");
    await register(email);
    await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { identifier: email },
    });

    const requested = await rowsFor(
      "event_type = $1",
      "auth.password.reset_requested",
    );
    expect(requested.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(requested)).not.toContain(email);
    expect(
      requested.some((r) => typeof r.metadata.identifier_hash === "string"),
    ).toBe(true);
  });

  /** The Zitadel `sub` for a registered email — the FK from the mirror row to its session/audit. */
  async function subjectForEmail(email: string): Promise<string> {
    const { rows } = await pool.query(
      "SELECT zitadel_sub FROM users WHERE email = $1",
      [email],
    );
    return (rows[0] as { zitadel_sub: string }).zitadel_sub;
  }
});
