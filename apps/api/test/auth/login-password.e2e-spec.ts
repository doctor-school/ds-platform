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
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  Jar,
  hostLogin,
  hostRegister,
  lastHostSession,
  storefrontRedeem,
  withSignInHost,
} from "../setup/storefront-harness.js";

// Password login (EARS-5) on the sign-in host's password step. Success puts
// the checked session in the host record and the storefront's callback
// establishes a BFF session (EARS-8) — a `__Host-` cookie, no token in a body; failure is an enumeration-resistant
// generic error and the credential check is delegated to the IdP port; a
// failed check is throttled, never locked (EARS-15). Runs against a
// real Postgres with the IdP bound to the in-memory fake (design §2); the fake
// stores the registration password so the password check is exercised.
describe.skipIf(!process.env.DATABASE_URL)("Login with password (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let idp: FakeIdpClient;
  const consent = [{ purpose: "tos", version: "2026-01" }];
  const password = "Aa1!ufficiently-long-pw";
  const createdEmails: string[] = [];

  function uniqueEmail(tag: string): string {
    const email = `ears5-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    createdEmails.push(email);
    return email;
  }

  async function register(email: string): Promise<void> {
    await hostRegister(app, new Jar(), email, { password, consent });
  }

  function setCookie(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    return Array.isArray(raw) ? raw.join("\n") : ((raw as string) ?? "");
  }

  beforeAll(async () => {
    idp = new FakeIdpClient();
    const moduleRef: TestingModule = await withSignInHost(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(idp)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT),
    ).compile();

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
      await deleteUserFixture(pool, "email", email);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-5: when a user submits a correct identifier + password, the system shall establish a BFF session (set a __Host- cookie) with no token in the body", async () => {
    const email = uniqueEmail("ok");
    await register(email);

    const res = await hostLogin(app, new Jar(), email, { password });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "redirect" });
    // No token may appear in the response body (BFF pattern, EARS-8).
    expect(JSON.stringify(res.json())).not.toMatch(/token/i);
    // The storefront's callback establishes the session, carried only by the
    // __Host- cookie.
    const { setCookie: minted } = await storefrontRedeem(
      app,
      lastHostSession(app),
    );
    expect(minted).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
    expect(SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });

  it("EARS-5: when a user submits a wrong password, the system shall return a generic error, set no session cookie, and have delegated the (lockout-counted) check to the IdP", async () => {
    const email = uniqueEmail("bad");
    await register(email);
    const before = idp.failedAttempts(email);

    const res = await hostLogin(app, new Jar(), email, {
      password: "wrong-password",
    });

    expect(res.statusCode).toBe(401);
    expect(setCookie(res)).not.toContain(SESSION_COOKIE_NAME);
    // The failed check was delegated to Zitadel — not short-circuited (the
    // password lockout is off; guessing is throttled, 003 EARS-15).
    expect(idp.failedAttempts(email)).toBe(before + 1);
  });

  it("EARS-5: an unknown identifier is indistinguishable from a wrong password (enumeration-resistant, EARS-16)", async () => {
    const unknown = `ears5-nobody-${Date.now()}@ds.test`;
    const res = await hostLogin(app, new Jar(), unknown, { password });

    expect(res.statusCode).toBe(401);
    expect(setCookie(res)).not.toContain(SESSION_COOKIE_NAME);
  });
});
