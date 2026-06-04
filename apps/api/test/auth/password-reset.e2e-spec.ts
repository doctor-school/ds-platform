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
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// Password reset over HTTP (EARS-11 initiate, EARS-12 complete) — the controller
// wiring on top of the IdP-port + session-layer logic. EARS-11's contract is an
// enumeration-resistant response (identical for existing vs unknown identifier);
// EARS-12's is "new password set + every existing session revoked", which is
// observable over HTTP by establishing two sessions for the same user and
// asserting both cookies stop authenticating after the reset completes. The
// `PasswordResetCompleted` audit event lives only in the in-memory sink, so its
// emission is asserted at the service altitude (session.service.spec.ts), not here.
describe.skipIf(!process.env.DATABASE_URL)("Password reset (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "sufficiently-long-pw";
  const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
  const createdEmails: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears1112-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  async function register(email: string): Promise<void> {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password, consent },
    });
    expect(reg.statusCode).toBe(200);
  }

  /** Log in with a given password; return the session cookie value. */
  async function login(email: string, pw: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password: pw },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    return cookie!.value;
  }

  /** Whether a session cookie still resolves to an authenticated principal. */
  async function authenticates(cookieValue: string): Promise<boolean> {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    });
    return res.statusCode === 200;
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-11: when a user requests a password reset for an identifier, the system shall respond identically whether or not the identifier exists", async () => {
    const known = uniqueEmail("known");
    await register(known);
    const unknown = `ears1112-nobody-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;

    const forKnown = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: known },
    });
    const forUnknown = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: unknown },
    });

    // Enumeration-resistant: same status code AND same body for the existing and
    // the never-registered identifier — the response discloses nothing (EARS-16).
    expect(forKnown.statusCode).toBe(200);
    expect(forUnknown.statusCode).toBe(forKnown.statusCode);
    expect(forUnknown.json()).toEqual(forKnown.json());
    expect(forKnown.json()).toEqual({ status: "reset_requested" });
  });

  it("EARS-12: when a user submits a valid reset code and a policy-conforming new password, the system shall set the new password and revoke all existing sessions", async () => {
    const email = uniqueEmail("complete");
    await register(email);

    // Two concurrent sessions for the same user (e.g. two devices) — both live.
    const cookieA = await login(email, password);
    const cookieB = await login(email, password);
    expect(await authenticates(cookieA)).toBe(true);
    expect(await authenticates(cookieB)).toBe(true);

    // Initiate, then complete the reset with the IdP's valid code + a new password.
    await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: email },
    });
    const newPassword = "brand-new-password-9";
    const complete = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset/complete",
      headers: device,
      payload: { identifier: email, code: FAKE_VALID_CODE, newPassword },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toEqual({ status: "reset_completed" });

    // Every existing session is revoked: neither prior cookie still authenticates.
    expect(await authenticates(cookieA)).toBe(false);
    expect(await authenticates(cookieB)).toBe(false);

    // The new password was set at the IdP: it logs in; the old one no longer does.
    const fresh = await login(email, newPassword);
    expect(await authenticates(fresh)).toBe(true);
    const stale = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(stale.statusCode).toBe(401);
  });

  it("EARS-12: an invalid or expired reset code is refused with a generic failure", async () => {
    const email = uniqueEmail("badcode");
    await register(email);
    await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: device,
      payload: { identifier: email },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset/complete",
      headers: device,
      payload: { identifier: email, code: "000000", newPassword: "another-pw-1" },
    });
    expect(res.statusCode).toBe(400);
  });
});
