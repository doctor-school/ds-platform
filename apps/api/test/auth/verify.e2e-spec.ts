import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { VerifyResponseSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";

// Verification (EARS-3 email / EARS-4 phone): a correct OTP code flips the mirror
// flag via Zitadel; an invalid/expired code returns a generic failure and leaves
// the flag unchanged. Real Postgres + fake IdP (the fake treats FAKE_VALID_CODE
// as the only correct code).
describe.skipIf(!process.env.DATABASE_URL)("Verify (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];
  const createdPhones: string[] = [];

  async function register(payload: Record<string, unknown>): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { password: "sufficiently-long-pw", consent, ...payload },
    });
    expect(res.statusCode).toBe(200);
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

  it("EARS-3: when a registrant submits the correct email code, the system shall verify it via Zitadel and flip email_verified on the mirror", async () => {
    const email = `ears3-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { email, code: FAKE_VALID_CODE },
    });

    expect(res.statusCode).toBe(200);
    expect(VerifyResponseSchema.parse(res.json()).status).toBe("verified");

    const { rows } = await pool.query(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified).toBe(true);
  });

  it("EARS-3: when a registrant submits an invalid/expired email code, the system shall return a generic failure and leave email_verified unchanged", async () => {
    const email = `ears3-bad-${runId}@ds.test`;
    createdEmails.push(email);
    await register({ email });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { email, code: "000000" },
    });

    expect(res.statusCode).toBe(400);
    const { rows } = await pool.query(
      "SELECT email_verified FROM users WHERE email = $1",
      [email],
    );
    expect(rows[0].email_verified).toBe(false);
  });

  it("EARS-4: when a registrant submits the correct SMS code, the system shall verify it via Zitadel and flip phone_verified on the mirror", async () => {
    const phone = `+1999${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    createdPhones.push(phone);
    await register({ phone });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      payload: { phone, code: FAKE_VALID_CODE },
    });

    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      "SELECT phone_verified FROM users WHERE phone = $1",
      [phone],
    );
    expect(rows[0].phone_verified).toBe(true);
  });
});
