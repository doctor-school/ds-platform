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
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// BFF session establishment (EARS-8): the cookie attribute set, "no token in the
// body" invariant, the minimal JWT claim set, and fingerprint binding (design
// §3). The browser holds only the __Host- cookie; the principal claims are read
// back through the doctor_guest-protected GET /v1/auth/session route (design
// §7.2) — that is also how the F2 authentication layer populates the AuthzGuard
// subject (the seam left open in authz.guard.ts).
describe.skipIf(!process.env.DATABASE_URL)("BFF session (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "Aa1!ufficiently-long-pw";
  // A fixed device fingerprint surface — login and the matching session read
  // must present the same headers or the binding (correctly) rejects the read.
  const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
  const createdEmails: string[] = [];

  function uniqueEmail(): string {
    const email = `ears8-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  /** Register + log in; return the raw Set-Cookie string and the session cookie value. */
  async function login(email: string): Promise<{
    setCookieHeader: string;
    cookieValue: string;
  }> {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(reg.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(res.statusCode).toBe(200);

    const raw = res.headers["set-cookie"];
    const setCookieHeader = Array.isArray(raw) ? raw[0]! : (raw as string);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    return { setCookieHeader, cookieValue: cookie!.value };
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

  it("EARS-8: the session cookie is a __Host- HttpOnly+Secure+SameSite=Lax cookie with no Domain", async () => {
    const { setCookieHeader } = await login(uniqueEmail());

    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader).toMatch(/HttpOnly/i);
    expect(setCookieHeader).toMatch(/Secure/i);
    expect(setCookieHeader).toMatch(/SameSite=Lax/i);
    expect(setCookieHeader).toMatch(/Path=\//i);
    expect(setCookieHeader).not.toMatch(/Domain=/i);
  });

  it("EARS-8: the session read returns the minimal principal claim set (sub, roles[], mfa) and never a token or sid", async () => {
    const { cookieValue } = await login(uniqueEmail());

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["mfa", "roles", "sub"].sort());
    expect(typeof body.sub).toBe("string");
    expect(Array.isArray(body.roles)).toBe(true);
    expect(body.roles).toContain("doctor_guest");
    expect(typeof body.mfa).toBe("boolean");
    // The access/refresh tokens stay server-side — never echoed to the client.
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });

  it("EARS-8: a request whose fingerprint diverges from the bound session is not authenticated", async () => {
    const { cookieValue } = await login(uniqueEmail());

    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: {
        "user-agent": "Different/9.9",
        "accept-language": "en-US",
        cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`,
      },
    });

    // Fingerprint mismatch ⇒ the subject is not populated ⇒ the protected route
    // denies (401 from the authz layer), it does not serve a hijacked session.
    expect(res.statusCode).toBe(401);
  });

  it("EARS-8: the protected session route denies a request with no cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/auth/session" });
    expect(res.statusCode).toBe(401);
  });
});
