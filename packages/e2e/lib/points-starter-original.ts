import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "@playwright/test";
import {
  pointsOperation,
  type PointsWorld,
} from "./points-engine-originals.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const load = (name: string) =>
  import(pathToFileURL(resolve(root, "apps/api/dist", name)).href);
interface Response {
  statusCode: number;
  payload: string;
  cookies: { name: string; value: string }[];
  json(): Record<string, unknown>;
}
interface HttpApp {
  init(): Promise<void>;
  close(): Promise<void>;
  enableVersioning(value: unknown): void;
  get<T>(token: unknown): T;
  getHttpAdapter(): { getInstance(): { ready(): Promise<void> } };
  inject(request: unknown): Promise<Response>;
}
interface AdminSessions {
  upgradePending(
    ref: string,
    fingerprint: string,
  ): Promise<{ principal: { sid: string } } | undefined>;
  getBySid(
    sid: string,
  ): Promise<{ sid: string; csrfToken: string } | undefined>;
}

/** 025 EARS-43: the native admin-session fixture boundary, without factor acceptance. */
export async function bootPointsStarterApi(points: PointsWorld) {
  apiRequire("reflect-metadata");
  const { Test } = apiRequire("@nestjs/testing");
  const { FastifyAdapter } = apiRequire("@nestjs/platform-fastify");
  const { VersioningType } = apiRequire("@nestjs/common");
  process.env.CONGRESS_SIGNUP_WINDOW_OPENS_AT ??=
    "2026-10-01T00:00:00.000+03:00";
  process.env.CONGRESS_SIGNUP_WINDOW_CLOSES_AT ??=
    "2027-01-01T00:00:00.000+03:00";
  process.env.CONGRESS_SIGNUP_EVENT_DAYS ??= "2027-04-23,2027-04-24";
  const { AppModule } = await load("app.module.js");
  const { IDP_CLIENT } = await load("auth/idp/idp.types.js");
  const { FakeIdpClient } = await load("auth/idp/idp.fake.js");
  const { BOT_PROTECTION } = await load("bot-protection/index.js");
  const { AdminSessionService } = await load(
    "auth/admin-session/admin-session.service.js",
  );
  const cookies = await load("auth/admin-session/admin-session.cookie.js");
  const { computeFingerprint } = await load("auth/session/session.cookie.js");
  const fake = new FakeIdpClient();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDP_CLIENT)
    .useValue(fake)
    .overrideProvider(BOT_PROTECTION)
    .useValue({ verify: async () => ({ ok: true }) })
    .compile();
  const app = module.createNestApplication(new FastifyAdapter(), {
    logger: false,
  }) as HttpApp;
  try {
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pointsOperation(
      "START owned compiled Fastify AppModule; overrides=external FakeIdpClient,bot fixture; no guard/session/controller override",
    );
    const device = {
      "user-agent": "PointsOriginal/1.0",
      "accept-language": "en-US",
    };
    const email = `points-starter-${randomUUID()}@points-original.invalid`;
    const password = `Aa1!${randomUUID()}`;
    pointsOperation(
      "POST /v1/auth/register (owned admin fixture; credential parameters omitted)",
    );
    const registered = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email,
        password,
        consent: [{ purpose: "tos", version: "2026-01" }],
      },
    });
    expect(registered.statusCode, registered.payload).toBe(200);
    const identity = (await fake.listUsers()).find(
      (u: { email: string }) => u.email === email,
    );
    expect(identity).toBeDefined();
    const actorSub = identity!.sub as string;
    await fake.grantProjectRole(actorSub, "platform_admin");
    pointsOperation(
      "POST /v1/admin/auth/login then actual AdminSessionService.upgradePending (standard fixture; no factor acceptance)",
    );
    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: device,
      payload: { identifier: email, password },
    });
    expect(login.statusCode, login.payload).toBe(200);
    const pending = login.cookies.find(
      (c) => c.name === cookies.ADMIN_PENDING_COOKIE_NAME,
    );
    expect(pending).toBeDefined();
    const admin = app.get<AdminSessions>(AdminSessionService);
    const upgraded = await admin.upgradePending(
      pending!.value,
      computeFingerprint({
        userAgent: device["user-agent"],
        acceptLanguage: device["accept-language"],
        ip: "127.0.0.1",
      }),
    );
    expect(upgraded).toBeDefined();
    const session = await admin.getBySid(upgraded!.principal.sid);
    expect(session).toBeDefined();
    const headers = {
      ...device,
      cookie: `${cookies.ADMIN_SESSION_COOKIE_NAME}=${session!.sid}; ${cookies.ADMIN_CSRF_COOKIE_NAME}=${session!.csrfToken}`,
      [cookies.ADMIN_CSRF_HEADER]: session!.csrfToken,
    };
    expect(
      (
        await points.handle.pool.query(
          "SELECT zitadel_sub FROM users WHERE email=$1",
          [email],
        )
      ).rows,
    ).toEqual([{ zitadel_sub: actorSub }]);
    return {
      actorSub,
      async run(payload: { registeredBefore: string; reason: string }) {
        pointsOperation(
          "POST /v1/admin/points/starter-bonus (actual compiled controller/guard/engine/Postgres)",
        );
        const response = await app.inject({
          method: "POST",
          url: "/v1/admin/points/starter-bonus",
          headers,
          payload,
        });
        expect(response.statusCode, response.payload).toBe(200);
        return response.json();
      },
      async close() {
        pointsOperation("CLOSE owned Fastify AppModule and its pool/intervals");
        await app.close();
      },
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
