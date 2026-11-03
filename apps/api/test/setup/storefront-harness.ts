import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import type pg from "pg";
import { expect } from "vitest";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import {
  IDP_CLIENT,
  type IdpClient,
  type IdpSession,
} from "../../src/auth/idp/idp.types.js";
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
 * 003 EARS-8 / EARS-10 / EARS-65 / EARS-69 — the one way an API e2e signs a
 * person in to a storefront: the production path through the sign-in host.
 * A credential step on the host (password, or a login code) puts a checked
 * Zitadel session into a sign-in-host record; the storefront's callback
 * redeems a code for that session and mints the storefront session linked to
 * it. The IdP's OIDC endpoints (the auth request the authorize endpoint
 * opens, the code its token endpoint redeems) are the only faked hops:
 * {@link withSignInHost} puts their fakes on a suite's own testing module, and
 * {@link signIn} walks the whole path for one person. {@link storefrontHarness}
 * is the two-storefront suite built on the same steps.
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
export const DEVICE: Record<string, string> = {
  "user-agent": "StorefrontTest/1.0",
  "accept-language": "ru-RU",
};

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

/** The faked OIDC hops of the IdP the sign-in host and the storefront callback talk to. */
export interface SignInHostFakes {
  readonly hostIdp: FakeSignInHostIdp;
  readonly oidc: FakeStorefrontOidc;
}

export function signInHostFakes(): SignInHostFakes {
  return {
    hostIdp: new FakeSignInHostIdp(),
    oidc: new FakeStorefrontOidc([ACADEMY, DOCTOR]),
  };
}

/**
 * A suite's own testing module with the sign-in host's IdP ports faked
 * (`fakes`, fresh by default); chain it like any `overrideProvider`.
 */
export function withSignInHost(
  builder: TestingModuleBuilder,
  fakes: SignInHostFakes = signInHostFakes(),
): TestingModuleBuilder {
  return builder
    .overrideProvider(SIGN_IN_HOST_IDP)
    .useValue(fakes.hostIdp)
    .overrideProvider(STOREFRONT_OIDC_IDP)
    .useValue(fakes.oidc);
}

function fakesOf(app: NestFastifyApplication): SignInHostFakes {
  const hostIdp = app.get(SIGN_IN_HOST_IDP, { strict: false }) as unknown;
  const oidc = app.get(STOREFRONT_OIDC_IDP, { strict: false }) as unknown;
  if (
    !(hostIdp instanceof FakeSignInHostIdp) ||
    !(oidc instanceof FakeStorefrontOidc)
  ) {
    throw new Error(
      "the app was not built with withSignInHost(...) — no faked sign-in host IdP",
    );
  }
  return { hostIdp, oidc };
}

/** The credential the host's step checks: a password, or a login code on its channel. */
export type HostCredential =
  { password: string } | { code: string; channel?: "email" | "sms" };

export interface HostStepOptions {
  /** The browser's device headers; the record and the storefront session bind to them (EARS-64). */
  device?: Record<string, string>;
  /** The storefront whose authorize request opened the host form. */
  client?: Storefront;
  prompt?: string[];
}

function clientIdOf(client: Storefront): string {
  return client === "academy" ? ACADEMY : DOCTOR;
}

/** Open the host form for a fresh auth request in `jar`: the request id and the form's CSRF token. */
export async function openHostForm(
  app: NestFastifyApplication,
  jar: Jar,
  opts: HostStepOptions = {},
): Promise<{ authRequest: string; csrf: string }> {
  const { hostIdp } = fakesOf(app);
  const authRequest = hostIdp.seedAuthRequest({
    clientId: clientIdOf(opts.client ?? "academy"),
    ...(opts.prompt ? { prompt: opts.prompt } : {}),
  });
  const entry = await app.inject({
    method: "GET",
    url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
    headers: { ...(opts.device ?? DEVICE), cookie: jar.header() },
  });
  jar.apply(entry.cookies);
  const body = entry.json() as { action: string; csrf?: string };
  expect(body.action, entry.body).toBe("render");
  return { authRequest, csrf: body.csrf! };
}

/** One same-origin form post to the host (`step` under `/v1/sign-in-host/`) in `jar`. */
export async function postHostForm(
  app: NestFastifyApplication,
  jar: Jar,
  step: string,
  payload: Record<string, unknown>,
  device: Record<string, string> = DEVICE,
) {
  const res = await app.inject({
    method: "POST",
    url: `/v1/sign-in-host/${step}`,
    headers: {
      ...device,
      origin: HOST_ORIGIN,
      "sec-fetch-site": "same-origin",
      cookie: jar.header(),
    },
    payload,
  });
  jar.apply(res.cookies);
  return res;
}

/**
 * The host's credential step for `identifier` on a fresh form in `jar` — the
 * raw answer (200 accepted, 401 refused), for the suites that assert it.
 */
export async function hostLogin(
  app: NestFastifyApplication,
  jar: Jar,
  identifier: string,
  credential: HostCredential,
  opts: HostStepOptions = {},
) {
  const form = await openHostForm(app, jar, opts);
  return "password" in credential
    ? postHostForm(
        app,
        jar,
        "login",
        { identifier, password: credential.password, ...form },
        opts.device,
      )
    : postHostForm(
        app,
        jar,
        "login/otp",
        {
          identifier,
          code: credential.code,
          channel: credential.channel ?? "email",
          ...form,
        },
        opts.device,
      );
}

/** The Zitadel session of the host's latest finalisation (the step that just succeeded). */
export function lastHostSession(app: NestFastifyApplication): IdpSession {
  const last = fakesOf(app).hostIdp.finalised.at(-1);
  if (!last || !("session" in last)) throw new Error("not finalised");
  return last.session;
}

/** An accepted credential step in `jar`; the Zitadel session it put in the record. */
export async function hostSignIn(
  app: NestFastifyApplication,
  jar: Jar,
  identifier: string,
  credential: HostCredential = { password: PASSWORD },
  opts: HostStepOptions = {},
): Promise<IdpSession> {
  const res = await hostLogin(app, jar, identifier, credential, opts);
  expect(res.statusCode, res.body).toBe(200);
  return lastHostSession(app);
}

/**
 * The storefront callback for `session` on `client`: a transaction, the code
 * the IdP issues for the record's Zitadel session (with the project roles
 * the IdP holds for the subject, as its ID token asserts them), the redeem.
 * The minted session's `sid` and the raw `Set-Cookie` the storefront relays.
 */
export async function storefrontRedeem(
  app: NestFastifyApplication,
  session: IdpSession,
  client: Storefront = "academy",
  device: Record<string, string> = DEVICE,
): Promise<{ sid: string; setCookie: string }> {
  const { oidc } = fakesOf(app);
  const internal = { ...device, authorization: `Bearer ${TOKEN}` };
  const tx = await app.inject({
    method: "POST",
    url: "/v1/internal/oidc/transaction",
    headers: internal,
    payload: { client, kind: "interactive", door: "login" },
  });
  expect(tx.statusCode, tx.body).toBe(200);
  const { txId, authorizeUrl } = tx.json() as {
    txId: string;
    authorizeUrl: string;
  };
  const q = new URL(authorizeUrl).searchParams;
  const roles = await app
    .get<IdpClient>(IDP_CLIENT, { strict: false })
    .getProjectRoles(session.sub);
  const code = oidc.issueCode({
    clientId: clientIdOf(client),
    redirectUri: client === "academy" ? ACADEMY_CALLBACK : DOCTOR_CALLBACK,
    codeChallenge: q.get("code_challenge")!,
    sid: session.zitadelSessionId,
    sub: session.sub,
    nonce: q.get("nonce")!,
    roles,
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/internal/oidc/redeem",
    headers: internal,
    payload: { client, txId, state: q.get("state")!, code },
  });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  if (!cookie) throw new Error("no session minted");
  const raw = res.headers["set-cookie"];
  return { sid: cookie.value, setCookie: Array.isArray(raw) ? raw[0]! : raw! };
}

/** {@link storefrontRedeem}'s minted `sid`. */
export async function storefrontSession(
  app: NestFastifyApplication,
  session: IdpSession,
  client: Storefront = "academy",
  device: Record<string, string> = DEVICE,
): Promise<string> {
  return (await storefrontRedeem(app, session, client, device)).sid;
}

/**
 * Sign `identifier` in to a storefront the production way — the host's
 * credential step in a fresh browser, then that storefront's callback — and
 * return the storefront session's `sid` (the `SESSION_COOKIE_NAME` value).
 * `credential` is the password, or a login code.
 */
export async function signIn(
  app: NestFastifyApplication,
  identifier: string,
  credential: string | HostCredential = PASSWORD,
  opts: HostStepOptions & { jar?: Jar } = {},
): Promise<string> {
  const session = await hostSignIn(
    app,
    opts.jar ?? new Jar(),
    identifier,
    typeof credential === "string" ? { password: credential } : credential,
    opts,
  );
  return storefrontSession(app, session, opts.client ?? "academy", opts.device);
}

/**
 * Register `email` on the host's Academy registration form and enter the
 * code — the registration that signs the browser in (its record lands in
 * `jar`). The Zitadel session the code step put in the record.
 */
export async function hostRegister(
  app: NestFastifyApplication,
  jar: Jar,
  email: string,
  input: {
    password?: string;
    consent?: ReadonlyArray<{ purpose: string; version: string }>;
    device?: Record<string, string>;
  } = {},
): Promise<IdpSession> {
  const device = input.device ?? DEVICE;
  const form = await openHostForm(app, jar, { device });
  const reg = await postHostForm(
    app,
    jar,
    "register",
    {
      email,
      password: input.password ?? PASSWORD,
      consent: input.consent ?? CONSENT,
      ...form,
    },
    device,
  );
  expect(reg.statusCode, reg.body).toBe(200);
  const v = await postHostForm(
    app,
    jar,
    "verify",
    { email, code: FAKE_VALID_CODE, ...form },
    device,
  );
  expect(v.statusCode, v.body).toBe(200);
  return lastHostSession(app);
}

export interface StorefrontHarness {
  readonly app: NestFastifyApplication;
  readonly idp: FakeIdpClient;
  readonly hostIdp: FakeSignInHostIdp;
  readonly oidc: FakeStorefrontOidc;
  /**
   * A registered, verified account (registered on the host, so its
   * registration browser holds one record of its own); deleted (with its
   * records) by {@link cleanup}.
   */
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
  const fakes = signInHostFakes();
  const moduleRef = await withSignInHost(
    Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDP_CLIENT)
      .useValue(idp)
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(thresholds),
    fakes,
  ).compile();
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
    await hostRegister(app, new Jar(), address);
    return address;
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
    for (const email of created.splice(0))
      await deleteUserFixture(pool, "email", email);
  }

  return {
    app,
    idp,
    hostIdp: fakes.hostIdp,
    oidc: fakes.oidc,
    account,
    hostSignIn: (jar, address, extra = {}) =>
      hostSignIn(app, jar, address, { password: PASSWORD }, extra),
    storefrontSession: (session, client) =>
      storefrontSession(app, session, client),
    sessionLive,
    cleanup,
    close: () => app.close(),
  };
}
