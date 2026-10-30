import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type pg from "pg";
import { expect } from "vitest";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { IDP_CLIENT, type IdpSession } from "../../src/auth/idp/idp.types.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import { resolveTrustProxy } from "../../src/config/trust-proxy.js";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { FakeSignInHostIdp } from "../../src/sign-in-host/sign-in-host.idp.fake.js";
import { SIGN_IN_HOST_IDP } from "../../src/sign-in-host/sign-in-host.idp.js";
import { FakeStorefrontOidc } from "../../src/sign-in-host/storefront-oidc.idp.fake.js";
import { STOREFRONT_OIDC_IDP } from "../../src/sign-in-host/storefront-oidc.idp.js";
import { deleteUserFixture } from "./fixture-cleanup.js";
import { RATE_LIMIT_THRESHOLDS, RELAXED_RATE_LIMIT } from "./rate-limit.js";

/**
 * 003 EARS-10 / EARS-65 — the two-storefront harness: the API booted with the
 * sign-in host enabled and every IdP port faked, a browser cookie jar, and the
 * steps that put one shared browser session (a sign-in-host record) behind a
 * session on each storefront (credential step → code → redeem).
 */

// The sign-in-host block and the internal credential are read at module
// compile; a bare run gets a complete, dev-only block (the CI job sets its own).
process.env.IDP_ACADEMY_CLIENT_ID ||= "academy-client-e2e";
process.env.IDP_DOCTOR_CLIENT_ID ||= "doctor-client-e2e";
process.env.IDP_SIGN_IN_BASE_URI ||= "http://localhost:3005";
process.env.SIGN_IN_ACADEMY_LOGIN_URL ||= "http://localhost:3001/login";
process.env.SIGN_IN_DOCTOR_LOGIN_URL ||= "http://localhost:3004/login";
process.env.SIGN_IN_RECORD_KEY ||= Buffer.alloc(32, 7).toString("base64");
process.env.INTERNAL_API_TOKEN ||=
  "e2e-internal-api-token-of-at-least-32-bytes";

export const ACADEMY = process.env.IDP_ACADEMY_CLIENT_ID;
export const DOCTOR = process.env.IDP_DOCTOR_CLIENT_ID;
const TOKEN = process.env.INTERNAL_API_TOKEN;
const HOST_ORIGIN = new URL(process.env.IDP_SIGN_IN_BASE_URI).origin;
const ACADEMY_CALLBACK = "http://localhost:3001/auth/callback";
const DOCTOR_CALLBACK = "http://localhost:3004/auth/callback";
export const PASSWORD = "Aa1!ufficiently-long-pw";
const CONSENT = [{ purpose: "tos", version: "2026-01" }];
export const DEVICE = {
  "user-agent": "StorefrontTest/1.0",
  "accept-language": "ru-RU",
};
const INTERNAL = { ...DEVICE, authorization: `Bearer ${TOKEN}` };

export type Storefront = "academy" | "doctor";

export class Jar {
  readonly values = new Map<string, string>();
  apply(cookies: Array<{ name: string; value: string; maxAge?: number }>) {
    for (const c of cookies) {
      if (c.maxAge === 0 || c.value === "") this.values.delete(c.name);
      else this.values.set(c.name, c.value);
    }
  }
  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface StorefrontHarness {
  readonly app: NestFastifyApplication;
  readonly idp: FakeIdpClient;
  readonly hostIdp: FakeSignInHostIdp;
  readonly oidc: FakeStorefrontOidc;
  /** A registered, verified account; deleted (with its records) by {@link cleanup}. */
  account(tag: string): Promise<string>;
  /** A credential step on the sign-in host in `jar`; the Zitadel session it put in the record. */
  hostSignIn(
    jar: Jar,
    address: string,
    extra?: { prompt?: string[] },
  ): Promise<IdpSession>;
  /** A storefront session minted from `session` through `client`'s callback; its `sid`. */
  storefrontSession(session: IdpSession, client: Storefront): Promise<string>;
  /** Whether `sid` resolves to a live session on its storefront's next request. */
  sessionLive(sid: string): Promise<boolean>;
  cleanup(): Promise<void>;
  close(): Promise<void>;
}

export async function storefrontHarness(
  thresholds = RELAXED_RATE_LIMIT,
): Promise<StorefrontHarness> {
  const idp = new FakeIdpClient();
  const hostIdp = new FakeSignInHostIdp();
  const oidc = new FakeStorefrontOidc([ACADEMY, DOCTOR]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDP_CLIENT)
    .useValue(idp)
    .overrideProvider(SIGN_IN_HOST_IDP)
    .useValue(hostIdp)
    .overrideProvider(STOREFRONT_OIDC_IDP)
    .useValue(oidc)
    .overrideProvider(RATE_LIMIT_THRESHOLDS)
    .useValue(thresholds)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: resolveTrustProxy({}) }),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const pool = app.get<pg.Pool>(DRIZZLE_POOL);
  const created: string[] = [];

  async function account(tag: string): Promise<string> {
    const address = `bcl-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    created.push(address);
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: address, password: PASSWORD, consent: CONSENT },
    });
    expect(r.statusCode, r.body).toBe(200);
    const v = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      headers: DEVICE,
      payload: {
        email: address,
        code: FAKE_VALID_CODE,
        registration: { password: PASSWORD, consent: CONSENT },
      },
    });
    expect(v.statusCode).toBe(200);
    return address;
  }

  async function hostSignIn(
    jar: Jar,
    address: string,
    extra: { prompt?: string[] } = {},
  ): Promise<IdpSession> {
    const authRequest = hostIdp.seedAuthRequest({
      clientId: ACADEMY,
      ...extra,
    });
    const entry = await app.inject({
      method: "GET",
      url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
      headers: { ...DEVICE, cookie: jar.header() },
    });
    jar.apply(entry.cookies);
    const body = entry.json() as { action: string; csrf?: string };
    expect(body.action).toBe("render");
    const res = await app.inject({
      method: "POST",
      url: "/v1/sign-in-host/login",
      headers: {
        ...DEVICE,
        origin: HOST_ORIGIN,
        "sec-fetch-site": "same-origin",
        cookie: jar.header(),
      },
      payload: {
        identifier: address,
        password: PASSWORD,
        authRequest,
        csrf: body.csrf,
      },
    });
    expect(res.statusCode).toBe(200);
    jar.apply(res.cookies);
    const last = hostIdp.finalised.at(-1);
    if (!last || !("session" in last)) throw new Error("not finalised");
    return last.session;
  }

  async function storefrontSession(
    session: IdpSession,
    client: Storefront,
  ): Promise<string> {
    const tx = await app.inject({
      method: "POST",
      url: "/v1/internal/oidc/transaction",
      headers: INTERNAL,
      payload: { client, kind: "interactive", door: "login" },
    });
    expect(tx.statusCode, tx.body).toBe(200);
    const { txId, authorizeUrl } = tx.json() as {
      txId: string;
      authorizeUrl: string;
    };
    const q = new URL(authorizeUrl).searchParams;
    const code = oidc.issueCode({
      clientId: client === "academy" ? ACADEMY : DOCTOR,
      redirectUri: client === "academy" ? ACADEMY_CALLBACK : DOCTOR_CALLBACK,
      codeChallenge: q.get("code_challenge")!,
      sid: session.zitadelSessionId,
      sub: session.sub,
      nonce: q.get("nonce")!,
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/internal/oidc/redeem",
      headers: INTERNAL,
      payload: { client, txId, state: q.get("state")!, code },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    if (!cookie) throw new Error("no session minted");
    return cookie.value;
  }

  async function sessionLive(sid: string): Promise<boolean> {
    const res = await app.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${sid}` },
    });
    return res.statusCode === 200;
  }

  async function cleanup(): Promise<void> {
    for (const email of created.splice(0)) {
      await pool.query(
        "DELETE FROM sign_in_host_records WHERE subject IN (SELECT zitadel_sub FROM users WHERE email = $1)",
        [email],
      );
      await deleteUserFixture(pool, "email", email);
    }
  }

  return {
    app,
    idp,
    hostIdp,
    oidc,
    account,
    hostSignIn,
    storefrontSession,
    sessionLive,
    cleanup,
    close: () => app.close(),
  };
}
