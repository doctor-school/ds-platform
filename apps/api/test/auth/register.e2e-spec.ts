import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { RegisterResponseSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";

// Registration cascade (EARS-1 email / EARS-2 phone), the consent gate
// (EARS-20), and enumeration resistance (EARS-16). Runs against a real Postgres
// (the `api-e2e` CI job + the local dev-stand) with the IdP port bound to the
// in-memory fake — the credential side is Zitadel's (design §2) and is not
// reachable in the shared CI unit job, so the domain logic is proven here.
describe.skipIf(!process.env.DATABASE_URL)("Register (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];
  const createdPhones: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  // E.164-valid (≤15 digits): "+1999" + 8 random digits = 12 digits. Random so
  // parallel test files sharing the dev-stand DB do not collide on the unique
  // phone constraint.
  function uniquePhone(): string {
    const phone = `+1999${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    createdPhones.push(phone);
    return phone;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IDP_CLIENT)
      .useValue(new FakeIdpClient())
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
  });

  afterEach(async () => {
    for (const email of createdEmails.splice(0))
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
    for (const phone of createdPhones.splice(0))
      await pool.query("DELETE FROM users WHERE phone = $1", [phone]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-1: when a visitor registers with a valid email + password, the system shall create the user, record consent, upsert a doctor_guest mirror, and respond enumeration-safely", async () => {
    const email = uniqueEmail("1");
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "sufficiently-long-pw", consent },
    });

    expect(res.statusCode).toBe(200);
    const body = RegisterResponseSchema.parse(res.json());
    expect(body.status).toBe("pending_verification");

    const { rows } = await pool.query(
      "SELECT role, email_verified, zitadel_sub FROM users WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("doctor_guest");
    expect(rows[0].email_verified).toBe(false);

    const consentRows = await pool.query(
      "SELECT purpose, version FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1",
      [email],
    );
    expect(consentRows.rows).toEqual([{ purpose: "tos", version: "2026-01" }]);
  });

  it("EARS-2: when a visitor registers with a valid phone + password, the system shall create the user, record consent, and upsert a doctor_guest mirror", async () => {
    const phone = uniquePhone();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { phone, password: "sufficiently-long-pw", consent },
    });

    expect(res.statusCode).toBe(200);
    expect(RegisterResponseSchema.parse(res.json()).status).toBe(
      "pending_verification",
    );

    const { rows } = await pool.query(
      "SELECT role, phone_verified FROM users WHERE phone = $1",
      [phone],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("doctor_guest");
    expect(rows[0].phone_verified).toBe(false);
  });

  it("EARS-20: when a registration carries no accepted consent version, the system shall refuse it and commit no PD-bearing mirror row", async () => {
    const email = uniqueEmail("20");
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "sufficiently-long-pw", consent: [] },
    });

    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(0);
  });

  it("EARS-16: when an already-registered email registers again, the system shall respond indistinguishably and create no duplicate account", async () => {
    const email = uniqueEmail("16");
    const payload = { email, password: "sufficiently-long-pw", consent };

    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload,
    });

    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());

    const { rows } = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email],
    );
    expect(rows).toHaveLength(1);
  });
});
