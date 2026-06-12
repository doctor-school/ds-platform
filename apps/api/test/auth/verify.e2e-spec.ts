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
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";

// Verification (EARS-3, email-only per #202): a correct email OTP code flips
// `email_verified` via Zitadel; an invalid/expired code returns a generic failure
// and leaves the flag unchanged. Registration is email-primary, so there is no
// phone verification at registration (EARS-4 is a future post-registration
// secondary-identifier concern). Real Postgres + fake IdP (the fake treats
// FAKE_VALID_CODE as the only correct code).
describe.skipIf(!process.env.DATABASE_URL)("Verify (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const runId = Date.now();
  const createdEmails: string[] = [];

  async function register(payload: Record<string, unknown>): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { password: "Aa1!ufficiently-long-pw", consent, ...payload },
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
  });

  afterEach(async () => {
    for (const email of createdEmails.splice(0))
      await pool.query("DELETE FROM users WHERE email = $1", [email]);
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

  // #202: EARS-4 phone verification at registration is REMOVED — registration is
  // email-primary, so there is no phone to verify at registration. Phone
  // verification becomes a future post-registration secondary-identifier path.
});
