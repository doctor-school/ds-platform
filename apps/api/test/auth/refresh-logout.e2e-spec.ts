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
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";

// Refresh rotation + logout over HTTP (EARS-9, EARS-10) — the controller wiring
// on top of the session-layer logic unit-tested in
// src/auth/session/session.service.spec.ts. Both routes are
// `doctor_guest`-protected (design §7.2): a live `__Host-` cookie is required.
//
// The EARS-9 *reuse* path is intentionally NOT exercised here: the refresh token
// lives only server-side, so no HTTP client can replay it — reuse is a store/IdP
// invariant covered by the service unit spec. Over HTTP we prove the happy
// rotation keeps the session usable and that an unauthenticated call is denied.
describe.skipIf(!process.env.DATABASE_URL)("Refresh + logout (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "sufficiently-long-pw";
  const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
  const createdEmails: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears910-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  /** Register + log in; return the session cookie value carried by the browser. */
  async function login(email: string): Promise<string> {
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
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    return cookie!.value;
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

  it("EARS-9: when an authenticated client refreshes, the system shall rotate server-side and keep the session usable, with no token in the body", async () => {
    const cookieValue = await login(uniqueEmail("ok"));
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { ...device, cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "refreshed" });
    // Rotation is server-side only — no token (and no new cookie) in the response.
    expect(JSON.stringify(res.json())).not.toMatch(/token/i);

    // The same cookie still authenticates: the sid is unchanged by rotation.
    const after = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { ...device, cookie },
    });
    expect(after.statusCode).toBe(200);
  });

  it("EARS-9: an unauthenticated refresh (no cookie) is denied", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/auth/refresh" });
    expect(res.statusCode).toBe(401);
  });

  it("EARS-10: when an authenticated user logs out, the system shall delete the session, clear the __Host- cookie, and end the session", async () => {
    const cookieValue = await login(uniqueEmail("out"));
    const cookie = `${SESSION_COOKIE_NAME}=${cookieValue}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { ...device, cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "logged_out" });
    // The __Host- cookie is cleared (emptied + Max-Age=0, same attribute set).
    const cleared = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cleared?.value).toBe("");
    expect(cleared?.maxAge).toBe(0);

    // The server-side session is gone: the old cookie no longer authenticates.
    const after = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { ...device, cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it("EARS-10: an unauthenticated logout (no cookie) is denied", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(401);
  });
});
