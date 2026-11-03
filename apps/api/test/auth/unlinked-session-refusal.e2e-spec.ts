import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { signIn, withSignInHost } from "../setup/storefront-harness.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { SESSION_STORE } from "../../src/auth/session/session.types.js";
import type { InMemorySessionStore } from "../../src/auth/session/session-store.fake.js";
import type { RedisSessionStore } from "../../src/auth/session/session-store.redis.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

// 003 EARS-8 (amended), #3175 switch-over — over HTTP: a storefront session
// cookie whose record no linked redeem minted (production Redis still holds
// such records from before S4 and from the retired storefront forms) gets no
// subject on any route, and its record is gone; a session signed in through
// the sign-in host keeps working. The record is seeded straight into the store,
// as the old mint paths no longer exist.
describe.skipIf(!process.env.DATABASE_URL)(
  "Unlinked storefront session refusal (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let store: InMemorySessionStore | RedisSessionStore;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const createdEmails: string[] = [];

    /** Register + sign in through the sign-in host; the linked session's `sid`. */
    async function linkedSid(tag: string): Promise<string> {
      const email = `ears8-unlinked-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      return signIn(app, email, password, { device });
    }

    /** A copy of a live linked record under a fresh `sid`, with its link stripped as `shape` says. */
    async function seedUnlinked(
      fromSid: string,
      shape: "no-zitadel-session" | "no-storefront-client",
    ): Promise<string> {
      const live = await store.get(fromSid);
      if (!live) throw new Error("the linked session is missing");
      const sid = `unlinked-${shape}-${Math.random().toString(36).slice(2)}`;
      const { zitadelSessionId, oidcClient, ...rest } = live;
      await store.create(
        shape === "no-zitadel-session"
          ? { ...rest, sid }
          : { ...rest, sid, ...(zitadelSessionId ? { zitadelSessionId } : {}) },
      );
      expect(oidcClient).toBeDefined();
      return sid;
    }

    const call = (method: "GET" | "POST", url: string, sid: string) =>
      app.inject({
        method,
        url,
        headers: { ...device, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
      });

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(new FakeIdpClient())
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
      store = app.get<InMemorySessionStore | RedisSessionStore>(SESSION_STORE);
    });

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    for (const shape of [
      "no-zitadel-session",
      "no-storefront-client",
    ] as const) {
      it(`003 EARS-8: a session cookie whose record has ${shape} gets no subject, and the record is deleted`, async () => {
        const linked = await linkedSid(`read-${shape}`);
        const unlinked = await seedUnlinked(linked, shape);

        expect(
          (await call("GET", "/v1/auth/session", unlinked)).statusCode,
        ).toBe(401);
        expect(await store.get(unlinked)).toBeUndefined();
        // The person's session signed in through the sign-in host still works.
        expect((await call("GET", "/v1/auth/session", linked)).statusCode).toBe(
          200,
        );
      });

      it(`003 EARS-8: a session cookie whose record has ${shape} is never refreshed and cannot log out`, async () => {
        const linked = await linkedSid(`refresh-${shape}`);
        const unlinked = await seedUnlinked(linked, shape);

        expect(
          (await call("POST", "/v1/auth/refresh", unlinked)).statusCode,
        ).toBe(401);
        expect(await store.get(unlinked)).toBeUndefined();
        const again = await seedUnlinked(linked, shape);
        expect((await call("POST", "/v1/auth/logout", again)).statusCode).toBe(
          401,
        );
        expect(await store.get(again)).toBeUndefined();
        // Neither touched the linked session.
        expect((await call("GET", "/v1/auth/session", linked)).statusCode).toBe(
          200,
        );
      });
    }
  },
);
