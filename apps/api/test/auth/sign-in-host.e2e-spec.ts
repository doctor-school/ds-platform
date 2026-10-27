import { createHash, randomBytes } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import type pg from "pg";
import type { DrizzleHandle } from "@ds/db";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  PARTNER_DATA_SHARING_PURPOSE,
  type SignInHostEntryResponse,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { AuthService } from "../../src/auth/auth.service.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { hashIdentifier } from "../../src/auth/session/auth-audit.ledger.js";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";
import {
  InMemoryLoginHandoffStore,
  LOGIN_HANDOFF_STORE,
  LOGIN_HANDOFF_TTL_SECONDS,
  type LoginHandoffStore,
} from "../../src/auth/login-handoff/login-handoff.store.js";
import {
  computeFingerprint,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session/session.cookie.js";
import {
  DRIZZLE_DB,
  DRIZZLE_POOL,
} from "../../src/database/database.tokens.js";
import {
  FORM_COOKIE_NAME,
  FORM_STATE_TTL_SECONDS,
  RECORD_COOKIE_NAME,
} from "../../src/sign-in-host/sign-in-host.cookies.js";
import { FakeSignInHostIdp } from "../../src/sign-in-host/sign-in-host.idp.fake.js";
import {
  SIGN_IN_HOST_IDP,
  ZitadelSignInHostIdp,
} from "../../src/sign-in-host/sign-in-host.idp.js";
import {
  SIGN_IN_HOST_IDLE_SECONDS,
  SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
} from "../../src/sign-in-host/sign-in-host.policy.js";
import { SignInHostRecordStore } from "../../src/sign-in-host/sign-in-host-record.store.js";
import {
  InMemorySignInHostStateStore,
  SIGN_IN_HOST_STATE_STORE,
  type SignInHostStateStore,
} from "../../src/sign-in-host/sign-in-host-state.store.js";
import {
  SIGN_IN_HOST_CLOCK,
  SIGN_IN_HOST_SETTINGS,
  type SignInHostClock,
} from "../../src/sign-in-host/sign-in-host.tokens.js";
import {
  DoctorRegisterService,
  MEDICAL_WORKER_DECLARATION_VERSION,
  PARTNER_DATA_SHARING_VERSION,
} from "../../src/storefront/doctor-register.service.js";
import { MAILER, type Mailer } from "../../src/mailer/mailer.types.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// The sign-in-host block is read at module compile (`loadEnv` in the
// factories). The dev stand and the CI api-e2e job set it; a bare run gets a
// complete, dev-only block here so the module is enabled.
process.env.IDP_ACADEMY_CLIENT_ID ||= "academy-client-e2e";
process.env.IDP_DOCTOR_CLIENT_ID ||= "doctor-client-e2e";
process.env.IDP_SIGN_IN_BASE_URI ||= "http://localhost:3005";
process.env.SIGN_IN_ACADEMY_LOGIN_URL ||= "http://localhost:3001/login";
process.env.SIGN_IN_DOCTOR_LOGIN_URL ||= "http://localhost:3004/login";
process.env.SIGN_IN_RECORD_KEY ||= Buffer.alloc(32, 7).toString("base64");

const ACADEMY = process.env.IDP_ACADEMY_CLIENT_ID;
const DOCTOR = process.env.IDP_DOCTOR_CLIENT_ID;
const HOST_ORIGIN = new URL(process.env.IDP_SIGN_IN_BASE_URI).origin;
const ACADEMY_LOGIN = process.env.SIGN_IN_ACADEMY_LOGIN_URL;
const DOCTOR_LOGIN = process.env.SIGN_IN_DOCTOR_LOGIN_URL;
const PASSWORD = "Aa1!ufficiently-long-pw";
const CONSENT = [{ purpose: "tos", version: "2026-01" }];
const DEVICE = { "user-agent": "HostTest/1.0", "accept-language": "ru-RU" };

/** A browser's cookie jar on the sign-in host. */
class Jar {
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

async function compile(
  thresholds = RELAXED_RATE_LIMIT,
  settingsOverride?: { value: null },
  clockOverride?: SignInHostClock,
  stateOverride?: SignInHostStateStore,
  handoffStoreOverride?: LoginHandoffStore,
) {
  const idp = new FakeIdpClient();
  const hostIdp = new FakeSignInHostIdp();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(IDP_CLIENT)
    .useValue(idp)
    .overrideProvider(SIGN_IN_HOST_IDP)
    .useValue(hostIdp)
    .overrideProvider(RATE_LIMIT_THRESHOLDS)
    .useValue(thresholds);
  if (settingsOverride)
    builder = builder
      .overrideProvider(SIGN_IN_HOST_SETTINGS)
      .useValue(settingsOverride.value);
  if (clockOverride)
    builder = builder
      .overrideProvider(SIGN_IN_HOST_CLOCK)
      .useValue(clockOverride);
  if (stateOverride)
    builder = builder
      .overrideProvider(SIGN_IN_HOST_STATE_STORE)
      .useValue(stateOverride);
  if (handoffStoreOverride)
    builder = builder
      .overrideProvider(LOGIN_HANDOFF_STORE)
      .useValue(handoffStoreOverride);
  const moduleRef: TestingModule = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, idp, hostIdp };
}

describe.skipIf(!process.env.DATABASE_URL)("Sign-in host API (e2e)", () => {
  let app: NestFastifyApplication;
  let idp: FakeIdpClient;
  let hostIdp: FakeSignInHostIdp;
  let pool: pg.Pool;
  const created: string[] = [];
  let recordNow: Date | undefined;
  let handoffNow: number | undefined;

  beforeAll(async () => {
    ({ app, idp, hostIdp } = await compile(
      RELAXED_RATE_LIMIT,
      undefined,
      () => recordNow ?? new Date(),
      undefined,
      new InMemoryLoginHandoffStore(() => handoffNow ?? Date.now()),
    ));
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
  });
  afterEach(async () => {
    recordNow = undefined;
    handoffNow = undefined;
    for (const email of created.splice(0)) {
      await pool.query(
        "DELETE FROM sign_in_host_records WHERE subject IN (SELECT zitadel_sub FROM users WHERE email = $1)",
        [email],
      );
      await deleteUserFixture(pool, "email", email);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  function email(tag: string): string {
    const e = `sih-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    created.push(e);
    return e;
  }

  async function registerOnStorefront(address: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email: address, password: PASSWORD, consent: CONSENT },
    });
    expect(res.statusCode).toBe(200);
  }

  async function account(tag: string): Promise<string> {
    const address = email(tag);
    await registerOnStorefront(address);
    const v = await app.inject({
      method: "POST",
      url: "/v1/auth/verify",
      headers: DEVICE,
      // The registration values ride the code step, so the password the
      // account signs in with afterwards is the one typed at sign-up (EARS-41).
      payload: {
        email: address,
        code: FAKE_VALID_CODE,
        registration: { password: PASSWORD, consent: CONSENT },
      },
    });
    expect(v.statusCode).toBe(200);
    return address;
  }

  async function entry(
    jar: Jar,
    authRequest: string | undefined,
    headers: Record<string, string> = DEVICE,
  ) {
    const res = await app.inject({
      method: "GET",
      url:
        "/v1/sign-in-host/entry" +
        (authRequest === undefined ? "" : `?authRequest=${authRequest}`),
      headers: { ...headers, cookie: jar.header() },
    });
    jar.apply(res.cookies);
    return { res, body: res.json() as SignInHostEntryResponse };
  }

  function post(
    jar: Jar,
    url: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    return app
      .inject({
        method: "POST",
        url: `/v1/sign-in-host/${url}`,
        headers: {
          ...DEVICE,
          origin: HOST_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: jar.header(),
          ...headers,
        },
        payload,
      })
      .then((res) => {
        jar.apply(res.cookies);
        return res;
      });
  }

  /** Render the form for a fresh auth request of `clientId`. */
  async function render(
    jar: Jar,
    clientId: string,
    extra: {
      prompt?: string[];
      maxAgeSeconds?: number;
      loginHint?: string;
    } = {},
  ) {
    const authRequest = hostIdp.seedAuthRequest({ clientId, ...extra });
    const { body } = await entry(jar, authRequest);
    expect(body.action).toBe("render");
    if (body.action !== "render") throw new Error("not rendered");
    return { authRequest, csrf: body.csrf, body };
  }

  /** A password sign-in on the host: renders, posts, returns the redirect. */
  async function signIn(
    jar: Jar,
    address: string,
    clientId = ACADEMY,
    extra: { prompt?: string[] } = {},
  ) {
    const form = await render(jar, clientId, extra);
    const res = await post(jar, "login", {
      identifier: address,
      password: PASSWORD,
      authRequest: form.authRequest,
      csrf: form.csrf,
    });
    expect(res.statusCode).toBe(200);
    return res;
  }

  async function recordRows(address: string) {
    const { rows } = await pool.query<{
      cookie_id_hash: string;
      expires_at: Date;
      last_finalised_at: Date;
    }>(
      "SELECT cookie_id_hash, expires_at, last_finalised_at FROM sign_in_host_records WHERE subject = (SELECT zitadel_sub FROM users WHERE email = $1)",
      [address],
    );
    return rows;
  }

  async function requestReset(address: string) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      headers: DEVICE,
      payload: { identifier: address },
    });
    expect(res.statusCode).toBe(200);
  }

  async function storefrontResetComplete(address: string) {
    await requestReset(address);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset/complete",
      headers: DEVICE,
      payload: {
        identifier: address,
        code: FAKE_VALID_CODE,
        newPassword: "Bb2!another-long-pw",
      },
    });
    expect(res.statusCode).toBe(200);
  }

  it("EARS-60: the admin client and an unknown client get access_denied and no form", async () => {
    for (const clientId of [
      process.env.IDP_CLIENT_ID || "admin-client-e2e",
      "unknown-client",
    ]) {
      const jar = new Jar();
      const authRequest = hostIdp.seedAuthRequest({ clientId });
      const { res, body } = await entry(jar, authRequest);
      expect(body.action).toBe("redirect");
      expect(body.action === "redirect" && body.url).toContain(
        "error=access_denied",
      );
      expect(hostIdp.finalised).toContainEqual({
        id: authRequest,
        error: "access_denied",
      });
      expect(jar.values.has(FORM_COOKIE_NAME)).toBe(false);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("EARS-67: a direct visit with no auth request goes to the doctor storefront /login", async () => {
    for (const id of [undefined, "not a valid id!"]) {
      const { body } = await entry(new Jar(), id);
      expect(body).toEqual({ action: "redirect", url: DOCTOR_LOGIN });
    }
  });

  it("EARS-60: S156 a live storefront record and forged client hints cannot authenticate an admin or unmapped client", async () => {
    const address = await account("client-binding");
    const jar = new Jar();
    await signIn(jar, address);
    const record = jar.values.get(RECORD_COOKIE_NAME);
    const before = await recordRows(address);
    const lifetimes = hostIdp.lifetimes.length;
    for (const clientId of [
      process.env.IDP_CLIENT_ID || "admin-client-e2e",
      "unmapped-client-s156",
    ]) {
      const authRequest = hostIdp.seedAuthRequest({ clientId });
      const result = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${authRequest}&client_id=${ACADEMY}&storefront=academy`,
        headers: {
          ...DEVICE,
          cookie: `${jar.header()}; client_id=${ACADEMY}; storefront=academy`,
          "x-client-id": ACADEMY,
          "x-storefront": "academy",
          "x-ds-sign-in-entry": "forged-render",
        },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({
        action: "redirect",
        url: expect.stringContaining("error=access_denied"),
      });
      expect(hostIdp.finalised.at(-1)).toEqual({
        id: authRequest,
        error: "access_denied",
      });
      expect(result.cookies).toEqual([]);
      expect(await recordRows(address)).toEqual(before);
      expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(record);
    }
    expect(hostIdp.lifetimes).toHaveLength(lifetimes);
  });

  it("EARS-60: S156 the auth request replaces a foreign prior form despite forged URL/header/cookie client selection", async () => {
    const jar = new Jar();
    for (const [clientId, storefront, foreignClient, foreign] of [
      [ACADEMY, "academy", DOCTOR, "doctor"],
      [DOCTOR, "doctor", ACADEMY, "academy"],
    ] as const) {
      await render(jar, foreignClient, { prompt: ["create"] });
      const oldForm = jar.values.get(FORM_COOKIE_NAME);
      const authRequest = hostIdp.seedAuthRequest({
        clientId,
        prompt: ["create"],
      });
      const res = await app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${authRequest}&client_id=${foreignClient}&storefront=${foreign}&registerPath=/evil&wordingVersion=evil`,
        headers: {
          ...DEVICE,
          cookie: `${jar.header()}; client_id=${foreignClient}; storefront=${foreign}`,
          "x-client-id": foreignClient,
          "x-storefront": foreign,
          "x-ds-sign-in-entry": "forged-render",
        },
      });
      jar.apply(res.cookies);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        action: "render",
        storefront,
        door: "register",
        authRequest,
        csrf: expect.any(String),
      });
      expect(jar.values.get(FORM_COOKIE_NAME)).not.toBe(oldForm);
      expect(res.cookies.map((cookie) => cookie.name)).not.toContain(
        SESSION_COOKIE_NAME,
      );
      const wrongRoute =
        storefront === "academy" ? "storefront/doctor/register" : "register";
      const refused = await post(jar, wrongRoute, {
        email: email(`binding-${storefront}`),
        password: PASSWORD,
        ...(storefront === "academy"
          ? {
              medicalWorkerDeclaration: true,
              consent: [
                {
                  purpose: PARTNER_DATA_SHARING_PURPOSE,
                  version: PARTNER_DATA_SHARING_VERSION,
                },
              ],
            }
          : { consent: CONSENT }),
        authRequest,
        csrf: res.json().csrf,
      });
      expect(refused.statusCode).toBe(403);
    }
  });

  it("EARS-66: a stale auth request returns to the storefront the form state recorded", async () => {
    const jar = new Jar();
    const { authRequest } = await render(jar, ACADEMY);
    hostIdp.expire(authRequest);
    const { body } = await entry(jar, authRequest);
    expect(body).toEqual({ action: "redirect", url: ACADEMY_LOGIN });
  });

  it.each([
    ["academy", ACADEMY, ACADEMY_LOGIN, "doctor", DOCTOR],
    ["doctor", DOCTOR, DOCTOR_LOGIN, "academy", ACADEMY],
  ] as const)(
    "EARS-66: S168 stale requests use the recorded %s form despite forged storefront hints",
    async (_storefront, clientId, loginUrl, forgedStorefront, forgedClient) => {
      const jar = new Jar();
      const { authRequest } = await render(jar, clientId);
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const formId = jar.values.get(FORM_COOKIE_NAME)!;
      const before = await state.getForm(formId);
      hostIdp.expire(authRequest);
      const guards = [
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "verifyEmail"),
        vi.spyOn(idp, "verifyPhone"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(hostIdp, "finaliseWithSession"),
        vi.spyOn(hostIdp, "finaliseWithError"),
      ];
      try {
        for (const requestId of [
          undefined,
          "not a valid id!",
          "V2_unknown_s168",
          authRequest,
        ]) {
          const query = new URLSearchParams({
            storefront: forgedStorefront,
            client_id: forgedClient,
            returnTo: "https://evil.test/login",
          });
          if (requestId !== undefined) query.set("authRequest", requestId);
          const res = await app.inject({
            method: "GET",
            url: `/v1/sign-in-host/entry?${query}`,
            headers: {
              ...DEVICE,
              cookie: `${jar.header()}; storefront=${forgedStorefront}; client_id=${forgedClient}`,
              "x-storefront": forgedStorefront,
              "x-client-id": forgedClient,
              "x-ds-sign-in-entry": "forged-render",
            },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ action: "redirect", url: loginUrl });
          expect(res.cookies).toEqual([]);
          expect(await state.getForm(formId)).toEqual(before);
        }
        for (const guard of guards) expect(guard).not.toHaveBeenCalled();
      } finally {
        for (const guard of guards) guard.mockRestore();
        await state.deleteForm(formId);
      }
    },
  );

  it.each(["absent", "unknown", "malformed", "deleted"] as const)(
    "EARS-67: S168 %s form state and an unopened stale request ignore forged Academy selection",
    async (formState) => {
      const jar = new Jar();
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      if (formState === "deleted") {
        await render(jar, ACADEMY);
        await state.deleteForm(jar.values.get(FORM_COOKIE_NAME)!);
      } else if (formState !== "absent") {
        jar.values.set(
          FORM_COOKIE_NAME,
          formState === "malformed"
            ? "invalid-form!"
            : randomBytes(32).toString("base64url"),
        );
      }
      const guards = [
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "verifyEmail"),
        vi.spyOn(idp, "verifyPhone"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(hostIdp, "finaliseWithSession"),
        vi.spyOn(hostIdp, "finaliseWithError"),
      ];
      try {
        const unopened = [ACADEMY, DOCTOR].map((clientId) => {
          const requestId = hostIdp.seedAuthRequest({ clientId });
          hostIdp.expire(requestId);
          return requestId;
        });
        for (const requestId of [
          undefined,
          "not a valid id!",
          "V2_unknown_s168",
          ...unopened,
        ]) {
          const query = new URLSearchParams({
            storefront: "academy",
            client_id: ACADEMY,
            returnTo: ACADEMY_LOGIN,
          });
          if (requestId !== undefined) query.set("authRequest", requestId);
          const res = await app.inject({
            method: "GET",
            url: `/v1/sign-in-host/entry?${query}`,
            headers: {
              ...DEVICE,
              cookie: `${jar.header()}; storefront=academy; client_id=${ACADEMY}`,
              "x-storefront": "academy",
              "x-client-id": ACADEMY,
              "x-ds-sign-in-entry": "forged-render",
            },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ action: "redirect", url: DOCTOR_LOGIN });
          expect(res.cookies).toEqual([]);
        }
        for (const guard of guards) expect(guard).not.toHaveBeenCalled();
      } finally {
        for (const guard of guards) guard.mockRestore();
      }
    },
  );

  it.each([
    ["academy", ACADEMY],
    ["doctor", DOCTOR],
  ] as const)(
    "EARS-67: S168 an expired %s form cannot select the fallback destination",
    async (_storefront, clientId) => {
      let now = Date.now();
      const state = new InMemorySignInHostStateStore(
        Buffer.alloc(32, 7),
        () => now,
      );
      const isolated = await compile(
        RELAXED_RATE_LIMIT,
        undefined,
        () => new Date(now),
        state,
      );
      const jar = new Jar();
      const authRequest = isolated.hostIdp.seedAuthRequest({ clientId });
      try {
        const opened = await isolated.app.inject({
          method: "GET",
          url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
          headers: DEVICE,
        });
        expect(opened.statusCode).toBe(200);
        expect(opened.json()).toMatchObject({ action: "render" });
        jar.apply(opened.cookies);
        const formId = jar.values.get(FORM_COOKIE_NAME)!;
        expect(await state.getForm(formId)).not.toBeNull();
        isolated.hostIdp.expire(authRequest);
        const guards = [
          vi.spyOn(isolated.idp, "passwordLogin"),
          vi.spyOn(isolated.idp, "verifyEmail"),
          vi.spyOn(isolated.idp, "verifyPhone"),
          vi.spyOn(isolated.idp, "loginWithEmailOtp"),
          vi.spyOn(isolated.idp, "loginWithSmsOtp"),
          vi.spyOn(isolated.hostIdp, "finaliseWithSession"),
          vi.spyOn(isolated.hostIdp, "finaliseWithError"),
        ];
        try {
          now += FORM_STATE_TTL_SECONDS * 1000;
          const res = await isolated.app.inject({
            method: "GET",
            url: `/v1/sign-in-host/entry?authRequest=${authRequest}&storefront=academy&client_id=${ACADEMY}`,
            headers: {
              ...DEVICE,
              cookie: `${jar.header()}; storefront=academy; client_id=${ACADEMY}`,
              "x-storefront": "academy",
              "x-client-id": ACADEMY,
            },
          });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ action: "redirect", url: DOCTOR_LOGIN });
          expect(res.cookies).toEqual([]);
          expect(await state.getForm(formId)).toBeNull();
          for (const guard of guards) expect(guard).not.toHaveBeenCalled();
        } finally {
          for (const guard of guards) guard.mockRestore();
        }
      } finally {
        await isolated.app.close();
      }
    },
  );

  it.each([
    ["academy", ACADEMY, ACADEMY_LOGIN],
    ["doctor", DOCTOR, DOCTOR_LOGIN],
  ] as const)(
    "EARS-66: S168 a stale %s request preserves the live browser record for a new silent request",
    async (storefront, clientId, loginUrl) => {
      const address = await account(`s168-live-${storefront}`);
      recordNow = new Date();
      const jar = new Jar();
      await signIn(jar, address, clientId);
      const records = app.get(SignInHostRecordStore);
      const recordId = jar.values.get(RECORD_COOKIE_NAME)!;
      const original = await records.find(recordId);
      expect(original).not.toBeNull();
      expect(hostIdp.finalised.at(-1)).toMatchObject({
        session: original!.session,
      });
      const auth = app.get(AuthService);
      const noWork = [
        vi.spyOn(auth, "passwordStep"),
        vi.spyOn(auth, "otpStep"),
        vi.spyOn(auth, "verifyStep"),
        vi.spyOn(auth, "requestLoginOtp"),
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "submitEmailCode"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(idp, "requestEmailLoginCode"),
        vi.spyOn(idp, "requestSmsOtp"),
        vi.spyOn(idp, "terminateSession"),
        vi.spyOn(hostIdp, "setSessionLifetime"),
        vi.spyOn(hostIdp, "finaliseWithError"),
        vi.spyOn(records, "insert"),
        vi.spyOn(records, "delete"),
      ];
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const lifetimes = [...hostIdp.lifetimes];
      const finalised = [...hostIdp.finalised];
      try {
        const form = await render(jar, clientId, { prompt: ["login"] });
        expect(form.body).toEqual({
          action: "render",
          storefront,
          door: "login",
          authRequest: form.authRequest,
          csrf: form.csrf,
        });
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(recordId);
        expect(await records.find(recordId)).toEqual(original);
        const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
        const formId = jar.values.get(FORM_COOKIE_NAME)!;
        const binding = await state.getForm(formId);
        expect(binding).toEqual({
          csrfToken: form.csrf,
          storefront,
          authRequestId: form.authRequest,
        });
        const before = await pool.query<Record<string, unknown>>(
          "SELECT * FROM sign_in_host_records WHERE subject = (SELECT zitadel_sub FROM users WHERE email = $1)",
          [address],
        );
        expect(before.rows).toHaveLength(1);
        const cookies = [...jar.values];
        recordNow = new Date(original!.lastFinalisedAt.getTime() + 1000);
        hostIdp.expire(form.authRequest);
        expect(await hostIdp.readAuthRequest(form.authRequest)).toBeNull();

        const stale = await entry(jar, form.authRequest);
        expect(stale.res.statusCode).toBe(200);
        expect(stale.body).toEqual({ action: "redirect", url: loginUrl });
        expect(stale.res.cookies).toEqual([]);
        expect([...jar.values]).toEqual(cookies);
        expect(await state.getForm(formId)).toEqual(binding);
        expect(await records.find(recordId)).toEqual(original);
        expect(
          (
            await pool.query<Record<string, unknown>>(
              "SELECT * FROM sign_in_host_records WHERE subject = (SELECT zitadel_sub FROM users WHERE email = $1)",
              [address],
            )
          ).rows,
        ).toEqual(before.rows);
        expect(hostIdp.finalised).toEqual(finalised);
        expect(hostIdp.lifetimes).toEqual(lifetimes);
        expect(finalise).not.toHaveBeenCalled();
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

        recordNow = new Date(original!.lastFinalisedAt.getTime() + 2000);
        const nextRequest = hostIdp.seedAuthRequest({
          clientId,
          prompt: ["none"],
        });
        const next = await entry(jar, nextRequest);
        expect(next.res.statusCode).toBe(200);
        expect(next.body).toEqual({
          action: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          nextRequest,
          original!.session,
        );
        expect(hostIdp.finalised).toEqual([
          ...finalised,
          { id: nextRequest, session: original!.session },
        ]);
        expect(next.res.cookies).toEqual([]);
        expect([...jar.values]).toEqual(cookies);
        expect(await records.find(recordId)).toEqual({
          ...original,
          lastFinalisedAt: recordNow,
        });
        expect(
          (
            await pool.query<Record<string, unknown>>(
              "SELECT * FROM sign_in_host_records WHERE subject = (SELECT zitadel_sub FROM users WHERE email = $1)",
              [address],
            )
          ).rows,
        ).toEqual([{ ...before.rows[0], last_finalised_at: recordNow }]);
        expect(hostIdp.lifetimes).toEqual(lifetimes);
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
      } finally {
        finalise.mockRestore();
        for (const spy of noWork) spy.mockRestore();
      }
    },
  );

  it("EARS-68: prompt=none without a record finalises login_required", async () => {
    const authRequest = hostIdp.seedAuthRequest({
      clientId: DOCTOR,
      prompt: ["none"],
    });
    const { body } = await entry(new Jar(), authRequest);
    expect(body.action === "redirect" && body.url).toContain(
      "error=login_required",
    );
  });

  it("EARS-5: a host credential step sets the 30-day lifetime, sets the record cookie, finalises, and mints no storefront session", async () => {
    const address = await account("lifetime");
    const jar = new Jar();
    const res = await signIn(jar, address);
    expect(res.json()).toMatchObject({ status: "redirect" });
    expect((res.json() as { url: string }).url).toContain("code=");
    expect(res.cookies.map((c) => c.name)).not.toContain(SESSION_COOKIE_NAME);
    expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(true);
    const finalised = hostIdp.finalised.at(-1) as {
      session: { zitadelSessionId: string };
    };
    expect(hostIdp.lifetimes).toContainEqual({
      zitadelSessionId: finalised.session.zitadelSessionId,
      seconds: SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
    });
    expect(SIGN_IN_HOST_SESSION_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
    const [row] = await recordRows(address);
    const days =
      (row!.expires_at.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.99);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("EARS-64: a live record finalises the next authorize at once, and a second use never moves the lifetime", async () => {
    const address = await account("live");
    const jar = new Jar();
    await signIn(jar, address);
    const [before] = await recordRows(address);
    const lifetimesBefore = hostIdp.lifetimes.length;
    const signedIn = hostIdp.finalised.at(-1) as {
      session: { zitadelSessionId: string };
    };

    const authRequest = hostIdp.seedAuthRequest({ clientId: DOCTOR });
    const { body } = await entry(jar, authRequest);
    expect(body.action).toBe("redirect");
    expect(body.action === "redirect" && body.url).toContain("code=");
    expect(jar.values.has(FORM_COOKIE_NAME)).toBe(true); // from the first render only
    const answered = hostIdp.finalised.at(-1) as {
      id: string;
      session: { zitadelSessionId: string };
    };
    expect(answered.id).toBe(authRequest);
    expect(answered.session.zitadelSessionId).toBe(
      signedIn.session.zitadelSessionId,
    );
    // The second use set no lifetime and moved only the idle clock.
    expect(hostIdp.lifetimes.length).toBe(lifetimesBefore);
    const [after] = await recordRows(address);
    expect(after!.expires_at.getTime()).toBe(before!.expires_at.getTime());
    expect(after!.last_finalised_at.getTime()).toBeGreaterThanOrEqual(
      before!.last_finalised_at.getTime(),
    );
  });

  it("EARS-64: a fingerprint mismatch deletes the record, terminates its session and treats the browser as signed out", async () => {
    const address = await account("foreign");
    const jar = new Jar();
    await signIn(jar, address);
    const terminate = vi.spyOn(idp, "terminateSession");
    const authRequest = hostIdp.seedAuthRequest({ clientId: DOCTOR });
    const { body } = await entry(jar, authRequest, {
      ...DEVICE,
      "user-agent": "OtherBrowser/2.0",
    });
    expect(body.action).toBe("render");
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(false);
    expect(await recordRows(address)).toHaveLength(0);
    terminate.mockRestore();
  });

  it.each([ACADEMY, DOCTOR])(
    "EARS-64/68: S166 prompt=none with a foreign fingerprint refuses only the presented record for %s",
    async (clientId) => {
      const address = await account("silent-foreign");
      const jar = new Jar();
      const other = new Jar();
      await signIn(jar, address, clientId);
      await signIn(other, address, clientId);
      const records = app.get(SignInHostRecordStore);
      const cookieId = jar.values.get(RECORD_COOKIE_NAME)!;
      const otherCookieId = other.values.get(RECORD_COOKIE_NAME)!;
      const record = await records.find(cookieId);
      const otherRecord = await records.find(otherCookieId);
      expect(record).not.toBeNull();
      expect(otherRecord).not.toBeNull();
      const terminate = vi.spyOn(idp, "terminateSession");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const password = vi.spyOn(idp, "passwordLogin");
      const finalisedBefore = hostIdp.finalised.length;
      const authRequest = hostIdp.seedAuthRequest({
        clientId,
        prompt: ["none"],
      });
      try {
        const { res, body } = await entry(jar, authRequest, {
          ...DEVICE,
          "user-agent": "OtherBrowser/2.0",
        });
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "redirect",
          url: expect.stringContaining("error=login_required"),
        });
        expect(hostIdp.finalised.slice(finalisedBefore)).toEqual([
          { id: authRequest, error: "login_required" },
        ]);
        expect(finalise).not.toHaveBeenCalled();
        expect(password).not.toHaveBeenCalled();
        expect(terminate).toHaveBeenCalledExactlyOnceWith(record!.session);
        expect(res.cookies).toEqual([
          expect.objectContaining({
            name: RECORD_COOKIE_NAME,
            value: "",
            maxAge: 0,
          }),
        ]);
        expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(false);
        expect(await records.find(cookieId)).toBeNull();
        expect(await records.find(otherCookieId)).toEqual(otherRecord);
        expect(await recordRows(address)).toHaveLength(1);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookieId);
      } finally {
        terminate.mockRestore();
        finalise.mockRestore();
        password.mockRestore();
      }
      const next = hostIdp.seedAuthRequest({ clientId, prompt: ["none"] });
      expect((await entry(other, next)).body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(hostIdp.finalised.at(-1)).toEqual({
        id: next,
        session: otherRecord!.session,
      });
    },
  );

  it.each(["silent", "interactive"] as const)(
    "EARS-64: S166 an IdP-refused live session removes only its browser record on %s reuse",
    async (mode) => {
      const address = await account(`s166-idp-refused-${mode}`);
      recordNow = new Date();
      const jar = new Jar();
      const other = new Jar();
      await signIn(jar, address);
      await signIn(other, address);
      const records = app.get(SignInHostRecordStore);
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const cookieId = jar.values.get(RECORD_COOKIE_NAME)!;
      const otherCookieId = other.values.get(RECORD_COOKIE_NAME)!;
      const record = await records.find(cookieId);
      const otherRecord = await records.find(otherCookieId);
      expect(record).not.toBeNull();
      expect(otherRecord).not.toBeNull();
      expect(otherCookieId).not.toBe(cookieId);
      expect(otherRecord!.session.zitadelSessionId).not.toBe(
        record!.session.zitadelSessionId,
      );
      expect(record!.fingerprint).toBe(deviceFingerprint());
      expect(record!.expiresAt.getTime()).toBeGreaterThan(recordNow.getTime());
      expect(record!.lastFinalisedAt.getTime()).toBeGreaterThan(
        recordNow.getTime() - SIGN_IN_HOST_IDLE_SECONDS * 1000,
      );
      expect(await recordRows(address)).toHaveLength(2);
      const priorForm = jar.values.get(FORM_COOKIE_NAME)!;
      const priorBinding = await state.getForm(priorForm);
      const lifetimesBefore = hostIdp.lifetimes.length;
      const finalisedBefore = hostIdp.finalised.length;
      const authRequest = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        prompt: mode === "silent" ? ["none"] : [],
      });
      const request = await hostIdp.readAuthRequest(authRequest);
      expect(request).toMatchObject({ id: authRequest, clientId: DOCTOR });
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
      const terminate = vi.spyOn(idp, "terminateSession");
      const remove = vi.spyOn(records, "delete");
      const touch = vi.spyOn(records, "touchFinalised");
      const putForm = vi.spyOn(state, "putForm");
      const auth = app.get(AuthService);
      const noWork = [
        vi.spyOn(records, "insert"),
        vi.spyOn(hostIdp, "setSessionLifetime"),
        vi.spyOn(auth, "passwordStep"),
        vi.spyOn(auth, "otpStep"),
        vi.spyOn(auth, "verifyStep"),
        vi.spyOn(auth, "requestLoginOtp"),
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "submitEmailCode"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(idp, "requestEmailLoginCode"),
        vi.spyOn(idp, "requestSmsOtp"),
      ];
      hostIdp.deadSessions.add(record!.session.zitadelSessionId);
      try {
        expect(await records.find(cookieId)).toEqual(record);
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          authRequest,
          record!.session,
        );
        expect(await finalise.mock.results[0]!.value).toBeNull();
        expect(remove).toHaveBeenCalledExactlyOnceWith(cookieId);
        expect(terminate).toHaveBeenCalledExactlyOnceWith(record!.session);
        expect(touch).not.toHaveBeenCalled();
        expect(await records.find(cookieId)).toBeNull();
        expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(false);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
        expect(res.cookies).toContainEqual(
          expect.objectContaining({
            name: RECORD_COOKIE_NAME,
            value: "",
            maxAge: 0,
          }),
        );
        if (mode === "silent") {
          expect(body).toEqual({
            action: "redirect",
            url: expect.stringContaining("error=login_required"),
          });
          expect(finaliseError).toHaveBeenCalledExactlyOnceWith(
            authRequest,
            "login_required",
          );
          expect(hostIdp.finalised.slice(finalisedBefore)).toEqual([
            { id: authRequest, error: "login_required" },
          ]);
          expect(await hostIdp.readAuthRequest(authRequest)).toBeNull();
          expect(putForm).not.toHaveBeenCalled();
          expect(jar.values.get(FORM_COOKIE_NAME)).toBe(priorForm);
          expect(await state.getForm(priorForm)).toEqual(priorBinding);
          expect(res.cookies.map((cookie) => cookie.name)).toEqual([
            RECORD_COOKIE_NAME,
          ]);
        } else {
          expect(body).toEqual({
            action: "render",
            storefront: "doctor",
            door: "login",
            authRequest,
            csrf: expect.any(String),
          });
          if (body.action !== "render") throw new Error("not rendered");
          const formId = jar.values.get(FORM_COOKIE_NAME)!;
          expect(formId).not.toBe(priorForm);
          expect(body.csrf).not.toBe(priorBinding?.csrfToken);
          expect(await state.getForm(formId)).toEqual({
            csrfToken: body.csrf,
            storefront: "doctor",
            authRequestId: authRequest,
          });
          expect(putForm).toHaveBeenCalledExactlyOnceWith(
            formId,
            expect.objectContaining({
              csrfToken: body.csrf,
              storefront: "doctor",
              authRequestId: authRequest,
            }),
            FORM_STATE_TTL_SECONDS,
          );
          expect(await state.getForm(priorForm)).toBeNull();
          expect(finaliseError).not.toHaveBeenCalled();
          expect(hostIdp.finalised).toHaveLength(finalisedBefore);
          expect(await hostIdp.readAuthRequest(authRequest)).toEqual(request);
          expect(res.cookies.map((cookie) => cookie.name)).toEqual([
            RECORD_COOKIE_NAME,
            FORM_COOKIE_NAME,
          ]);
        }
        expect(await records.find(otherCookieId)).toEqual(otherRecord);
        expect(await recordRows(address)).toHaveLength(1);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookieId);
        expect(hostIdp.lifetimes).toHaveLength(lifetimesBefore);
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

        const nextRequest = hostIdp.seedAuthRequest({
          clientId: DOCTOR,
          prompt: ["none"],
        });
        const next = await entry(other, nextRequest);
        expect(next.res.statusCode).toBe(200);
        expect(next.body).toEqual({
          action: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(next.res.cookies).toEqual([]);
        expect(finalise).toHaveBeenCalledTimes(2);
        expect(finalise).toHaveBeenLastCalledWith(
          nextRequest,
          otherRecord!.session,
        );
        expect(await finalise.mock.results[1]!.value).toContain("code=");
        expect(hostIdp.finalised.at(-1)).toEqual({
          id: nextRequest,
          session: otherRecord!.session,
        });
        expect(await records.find(otherCookieId)).toEqual(otherRecord);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookieId);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(touch).toHaveBeenCalledExactlyOnceWith(otherCookieId, recordNow);
        expect(hostIdp.lifetimes).toHaveLength(lifetimesBefore);
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
      } finally {
        hostIdp.deadSessions.delete(record!.session.zitadelSessionId);
        hostIdp.expire(authRequest);
        for (const spy of [
          finalise,
          finaliseError,
          terminate,
          remove,
          touch,
          putForm,
          ...noWork,
        ])
          spy.mockRestore();
        await state.deleteForm(priorForm);
        await state.deleteForm(jar.values.get(FORM_COOKIE_NAME)!);
      }
    },
  );

  it.each(["idle", "absolute"] as const)(
    "EARS-64/68: S166 the owning clock refuses a silent entry exactly at the %s record boundary",
    async (boundary) => {
      const address = await account(`silent-${boundary}`);
      recordNow = new Date();
      const start = recordNow.getTime();
      const beforeJar = new Jar();
      const expiredJar = new Jar();
      await signIn(beforeJar, address);
      await signIn(expiredJar, address);
      const records = app.get(SignInHostRecordStore);
      const expiredCookie = expiredJar.values.get(RECORD_COOKIE_NAME)!;
      const expired = await records.find(expiredCookie);
      expect(expired).not.toBeNull();
      const boundaryMs =
        boundary === "idle"
          ? start + SIGN_IN_HOST_IDLE_SECONDS * 1000
          : expired!.expiresAt.getTime();
      if (boundary === "absolute") {
        for (const days of [6, 12, 18, 24]) {
          recordNow = new Date(start + days * 24 * 60 * 60 * 1000);
          for (const jar of [beforeJar, expiredJar]) {
            const request = hostIdp.seedAuthRequest({
              clientId: DOCTOR,
              prompt: ["none"],
            });
            expect((await entry(jar, request)).body).toEqual({
              action: "redirect",
              url: expect.stringContaining("code="),
            });
          }
        }
      }
      recordNow = new Date(boundaryMs - 1);
      const usableRequest = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        prompt: ["none"],
      });
      expect((await entry(beforeJar, usableRequest)).body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      const unaffectedCookie = beforeJar.values.get(RECORD_COOKIE_NAME)!;
      const unaffected = await records.find(unaffectedCookie);
      expect(unaffected!.expiresAt).toEqual(expired!.expiresAt);
      recordNow = new Date(boundaryMs);
      const terminate = vi.spyOn(idp, "terminateSession");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const authRequest = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        prompt: ["none"],
      });
      try {
        const { res, body } = await entry(expiredJar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "redirect",
          url: expect.stringContaining("error=login_required"),
        });
        expect(hostIdp.finalised.at(-1)).toEqual({
          id: authRequest,
          error: "login_required",
        });
        expect(finalise).not.toHaveBeenCalled();
        expect(terminate).toHaveBeenCalledExactlyOnceWith(expired!.session);
        expect(await records.find(expiredCookie)).toBeNull();
        expect(expiredJar.values.has(RECORD_COOKIE_NAME)).toBe(false);
        expect(res.cookies).toContainEqual(
          expect.objectContaining({ name: RECORD_COOKIE_NAME, maxAge: 0 }),
        );
        expect(await records.find(unaffectedCookie)).toEqual(unaffected);
      } finally {
        terminate.mockRestore();
        finalise.mockRestore();
      }
    },
  );

  it("EARS-64/68: prompt=login and a short max_age render the form; the fresh credential replaces the record and rotates the cookie id", async () => {
    const address = await account("replace");
    const other = await account("replace-other");
    const jar = new Jar();
    await signIn(jar, address);
    const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;

    await render(jar, DOCTOR, { maxAgeSeconds: 0 });
    const terminate = vi.spyOn(idp, "terminateSession");
    await signIn(jar, other, DOCTOR, { prompt: ["login"] });
    expect(terminate).toHaveBeenCalledTimes(1);
    terminate.mockRestore();
    const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
    expect(newCookie).not.toBe(oldCookie);
    expect(await recordRows(address)).toHaveLength(0);
    expect(await recordRows(other)).toHaveLength(1);

    // The old cookie id resolves to nothing: signed out, cookie cleared.
    const stale = new Jar();
    stale.values.set(RECORD_COOKIE_NAME, oldCookie);
    const { body } = await entry(
      stale,
      hostIdp.seedAuthRequest({ clientId: ACADEMY }),
    );
    expect(body.action).toBe("render");
    expect(stale.values.has(RECORD_COOKIE_NAME)).toBe(false);
  });

  it("EARS-68: S166 positive max_age reuses at the credential boundary but recent reuse cannot defer the next fresh credential", async () => {
    const address = await account("s166-max-age");
    recordNow = new Date();
    const jar = new Jar();
    const other = new Jar();
    await signIn(jar, address);
    await signIn(other, address);
    const records = app.get(SignInHostRecordStore);
    const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
    const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
    const original = await records.find(oldCookie);
    const otherRecord = await records.find(otherCookie);
    expect(original).not.toBeNull();
    expect(otherRecord).not.toBeNull();
    expect(otherCookie).not.toBe(oldCookie);
    const finalisedBefore = [...hostIdp.finalised];
    const lifetimesBefore = [...hostIdp.lifetimes];
    const password = vi.spyOn(idp, "passwordLogin");
    const terminate = vi.spyOn(idp, "terminateSession");
    const insert = vi.spyOn(records, "insert");
    const remove = vi.spyOn(records, "delete");
    const touch = vi.spyOn(records, "touchFinalised");
    const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
    const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
    const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
    const spies = [
      password,
      terminate,
      insert,
      remove,
      touch,
      lifetime,
      finalise,
      finaliseError,
    ];
    try {
      const maxAgeSeconds = 60;
      recordNow = new Date(
        original!.lastCredentialAt.getTime() + maxAgeSeconds * 1000,
      );
      const boundaryRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        maxAgeSeconds,
      });
      const reused = await entry(jar, boundaryRequest);
      expect(reused.res.statusCode).toBe(200);
      expect(reused.body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(reused.res.cookies).toEqual([]);
      expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
      expect(finalise).toHaveBeenCalledExactlyOnceWith(
        boundaryRequest,
        original!.session,
      );
      expect(touch).toHaveBeenCalledExactlyOnceWith(oldCookie, recordNow);
      const recentlyUsed = { ...original, lastFinalisedAt: recordNow };
      expect(await records.find(oldCookie)).toEqual(recentlyUsed);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(hostIdp.lifetimes).toEqual(lifetimesBefore);
      for (const spy of [
        password,
        terminate,
        insert,
        remove,
        lifetime,
        finaliseError,
      ])
        expect(spy).not.toHaveBeenCalled();

      recordNow = new Date(recordNow.getTime() + 1);
      const authRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        maxAgeSeconds,
      });
      const opened = await entry(jar, authRequest);
      expect(opened.res.statusCode).toBe(200);
      expect(opened.body).toEqual({
        action: "render",
        storefront: "academy",
        door: "login",
        authRequest,
        csrf: expect.any(String),
      });
      if (opened.body.action !== "render") throw new Error("not rendered");
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const formId = jar.values.get(FORM_COOKIE_NAME)!;
      const binding = {
        csrfToken: opened.body.csrf,
        storefront: "academy",
        authRequestId: authRequest,
      };
      expect(await state.getForm(formId)).toEqual(binding);
      expect(opened.res.cookies.map((cookie) => cookie.name)).toEqual([
        FORM_COOKIE_NAME,
      ]);
      expect(await records.find(oldCookie)).toEqual(recentlyUsed);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(await recordRows(address)).toHaveLength(2);
      expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
      expect(finalise).toHaveBeenCalledTimes(1);
      expect(touch).toHaveBeenCalledTimes(1);
      expect(hostIdp.finalised).toEqual([
        ...finalisedBefore,
        { id: boundaryRequest, session: original!.session },
      ]);
      expect(hostIdp.lifetimes).toEqual(lifetimesBefore);
      for (const spy of [
        password,
        terminate,
        insert,
        remove,
        lifetime,
        finaliseError,
      ])
        expect(spy).not.toHaveBeenCalled();
      const projection = JSON.stringify({
        body: opened.body,
        headers: opened.res.headers,
      });
      for (const secret of [
        address,
        oldCookie,
        otherCookie,
        original!.session.sub,
        original!.session.zitadelSessionId,
        original!.session.sessionToken,
      ])
        expect(projection).not.toContain(secret);

      const accepted = await post(jar, "login", {
        identifier: address,
        password: PASSWORD,
        authRequest,
        csrf: opened.body.csrf,
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({
        status: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(password).toHaveBeenCalledExactlyOnceWith(address, PASSWORD);
      const freshCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      expect(freshCookie).toBeTruthy();
      expect([oldCookie, otherCookie]).not.toContain(freshCookie);
      const fresh = await records.find(freshCookie);
      expect(fresh?.session.sub).toBe(original!.session.sub);
      expect(fresh!.session.zitadelSessionId).not.toBe(
        original!.session.zitadelSessionId,
      );
      expect(fresh!.lastCredentialAt).toEqual(recordNow);
      expect(fresh!.expiresAt.getTime()).toBe(
        recordNow.getTime() + SIGN_IN_HOST_SESSION_LIFETIME_SECONDS * 1000,
      );
      expect(await records.find(oldCookie)).toBeNull();
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(await recordRows(address)).toHaveLength(2);
      expect(terminate).toHaveBeenCalledExactlyOnceWith(original!.session);
      expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime).toHaveBeenCalledExactlyOnceWith(
        fresh!.session,
        SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
      );
      expect(finalise).toHaveBeenCalledTimes(2);
      expect(finalise).toHaveBeenLastCalledWith(authRequest, fresh!.session);
      expect(finaliseError).not.toHaveBeenCalled();
      expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
        RECORD_COOKIE_NAME,
      ]);
      expect(await state.getForm(formId)).toEqual(binding);
      expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formId);
      expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);

      const independentRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        prompt: ["none"],
      });
      const independent = await entry(other, independentRequest);
      expect(independent.body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(independent.res.cookies).toEqual([]);
      expect(finalise).toHaveBeenCalledTimes(3);
      expect(finalise).toHaveBeenLastCalledWith(
        independentRequest,
        otherRecord!.session,
      );
      expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
      expect(await records.find(otherCookie)).toEqual({
        ...otherRecord,
        lastFinalisedAt: recordNow,
      });
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime).toHaveBeenCalledTimes(1);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("EARS-68: S166 a refused fresh-session lifetime preserves the old record and bound form for a successful password retry", async () => {
    const address = await account("s166-lifetime-refused");
    recordNow = new Date();
    const jar = new Jar();
    const other = new Jar();
    await signIn(jar, address);
    await signIn(other, address);
    const records = app.get(SignInHostRecordStore);
    const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
    const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
    const oldRecord = await records.find(oldCookie);
    const otherRecord = await records.find(otherCookie);
    expect(oldRecord).not.toBeNull();
    expect(otherRecord).not.toBeNull();
    expect(otherCookie).not.toBe(oldCookie);
    const form = await render(jar, ACADEMY, { prompt: ["login"] });
    expect(form.body).toMatchObject({ storefront: "academy", door: "login" });
    const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
    const formId = jar.values.get(FORM_COOKIE_NAME)!;
    const binding = await state.getForm(formId);
    expect(binding).toEqual({
      csrfToken: form.csrf,
      storefront: "academy",
      authRequestId: form.authRequest,
    });
    const cookies = [...jar.values];
    const before = await pool.query(
      "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
      [oldRecord!.session.sub],
    );
    expect(before.rows).toHaveLength(2);
    const request = await hostIdp.readAuthRequest(form.authRequest);
    expect(request).not.toBeNull();
    const finalised = [...hostIdp.finalised];
    const lifetimes = [...hostIdp.lifetimes];
    const password = vi.spyOn(idp, "passwordLogin");
    const terminate = vi.spyOn(idp, "terminateSession");
    const lifetime = vi
      .spyOn(hostIdp, "setSessionLifetime")
      .mockResolvedValueOnce(null);
    const insert = vi.spyOn(records, "insert");
    const remove = vi.spyOn(records, "delete");
    const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
    const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
    const spies = [
      password,
      terminate,
      lifetime,
      insert,
      remove,
      finalise,
      finaliseError,
    ];
    const payload = {
      identifier: address,
      password: PASSWORD,
      authRequest: form.authRequest,
      csrf: form.csrf,
    };
    try {
      const refused = await post(jar, "login", payload);
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toMatchObject({
        message: "sign-in temporarily unavailable",
      });
      expect(refused.cookies).toEqual([]);
      expect(password).toHaveBeenCalledExactlyOnceWith(address, PASSWORD);
      const checked = await password.mock.results[0]!.value;
      expect(checked.outcome).toBe("authenticated");
      if (checked.outcome !== "authenticated")
        throw new Error("not authenticated");
      expect(checked.session.sub).toBe(oldRecord!.session.sub);
      expect([
        oldRecord!.session.zitadelSessionId,
        otherRecord!.session.zitadelSessionId,
      ]).not.toContain(checked.session.zitadelSessionId);
      expect(lifetime).toHaveBeenCalledExactlyOnceWith(
        checked.session,
        SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
      );
      expect(await lifetime.mock.results[0]!.value).toBeNull();
      expect(terminate).toHaveBeenCalledExactlyOnceWith(checked.session);
      expect(lifetime.mock.invocationCallOrder[0]).toBeLessThan(
        terminate.mock.invocationCallOrder[0]!,
      );
      for (const spy of [insert, remove, finalise, finaliseError])
        expect(spy).not.toHaveBeenCalled();
      expect([...jar.values]).toEqual(cookies);
      expect(await state.getForm(formId)).toEqual(binding);
      expect(await records.find(oldCookie)).toEqual(oldRecord);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(
        (
          await pool.query(
            "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
            [oldRecord!.session.sub],
          )
        ).rows,
      ).toEqual(before.rows);
      expect(await hostIdp.readAuthRequest(form.authRequest)).toEqual(request);
      expect(hostIdp.finalised).toEqual(finalised);
      expect(hostIdp.lifetimes).toEqual(lifetimes);

      const accepted = await post(jar, "login", payload);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({
        status: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(password).toHaveBeenCalledTimes(2);
      expect(password).toHaveBeenNthCalledWith(2, address, PASSWORD);
      const retry = await password.mock.results[1]!.value;
      expect(retry.outcome).toBe("authenticated");
      if (retry.outcome !== "authenticated")
        throw new Error("not authenticated");
      expect(retry.session.zitadelSessionId).not.toBe(
        checked.session.zitadelSessionId,
      );
      const freshCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      expect(freshCookie).toBeTruthy();
      expect([oldCookie, otherCookie]).not.toContain(freshCookie);
      const fresh = await records.find(freshCookie);
      expect(fresh?.session).toEqual(retry.session);
      expect(fresh!.lastCredentialAt).toEqual(recordNow);
      expect(fresh!.expiresAt.getTime()).toBe(
        recordNow.getTime() + SIGN_IN_HOST_SESSION_LIFETIME_SECONDS * 1000,
      );
      expect(await records.find(oldCookie)).toBeNull();
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(await recordRows(address)).toHaveLength(2);
      expect(lifetime).toHaveBeenCalledTimes(2);
      expect(lifetime).toHaveBeenNthCalledWith(
        2,
        retry.session,
        SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
      );
      expect(await lifetime.mock.results[1]!.value).toEqual(retry.session);
      expect(terminate).toHaveBeenCalledTimes(2);
      expect(terminate).toHaveBeenNthCalledWith(2, oldRecord!.session);
      expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime.mock.invocationCallOrder[1]).toBeLessThan(
        terminate.mock.invocationCallOrder[1]!,
      );
      expect(terminate.mock.invocationCallOrder[1]).toBeLessThan(
        remove.mock.invocationCallOrder[0]!,
      );
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
        insert.mock.invocationCallOrder[0]!,
      );
      expect(finalise).toHaveBeenCalledExactlyOnceWith(
        form.authRequest,
        fresh!.session,
      );
      expect(finaliseError).not.toHaveBeenCalled();
      expect(hostIdp.finalised).toEqual([
        ...finalised,
        { id: form.authRequest, session: fresh!.session },
      ]);
      expect(await hostIdp.readAuthRequest(form.authRequest)).toBeNull();
      expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
        RECORD_COOKIE_NAME,
      ]);
      expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formId);
      expect(await state.getForm(formId)).toEqual(binding);
      expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);

      const nextRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        prompt: ["none"],
      });
      const reused = await entry(other, nextRequest);
      expect(reused.res.statusCode).toBe(200);
      expect(reused.body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(reused.res.cookies).toEqual([]);
      expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(finalise).toHaveBeenCalledTimes(2);
      expect(finalise).toHaveBeenLastCalledWith(
        nextRequest,
        otherRecord!.session,
      );
      expect(password).toHaveBeenCalledTimes(2);
      expect(lifetime).toHaveBeenCalledTimes(2);
      expect(terminate).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("EARS-70: a form post off the host origin, cross-site, without the form cookie or with a wrong CSRF token is the one 403", async () => {
    const address = await account("csrf");
    const jar = new Jar();
    const form = await render(jar, ACADEMY);
    const body = {
      identifier: address,
      password: PASSWORD,
      authRequest: form.authRequest,
      csrf: form.csrf,
    };
    const refusals = await Promise.all([
      post(jar, "login", body, { origin: "https://evil.test" }),
      post(jar, "login", body, { "sec-fetch-site": "cross-site" }),
      post(new Jar(), "login", body),
      post(jar, "login", { ...body, csrf: "wrong" }),
      post(jar, "login", {
        ...body,
        authRequest: hostIdp.seedAuthRequest({ clientId: ACADEMY }),
      }),
    ]);
    for (const res of refusals) {
      expect(res.statusCode).toBe(403);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(await recordRows(address)).toHaveLength(0);
  });

  it("EARS-70: S170 cross-site valid OTP posts preserve the live identity and original form for same-origin recovery", async () => {
    const holder = await account("s170-holder");
    const attacker = await account("s170-attacker");
    recordNow = new Date();
    const jar = new Jar();
    const other = new Jar();
    await signIn(jar, holder);
    await signIn(other, holder);
    const records = app.get(SignInHostRecordStore);
    const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
    const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
    const oldRecord = await records.find(oldCookie);
    const otherRecord = await records.find(otherCookie);
    expect(oldRecord).not.toBeNull();
    expect(otherRecord).not.toBeNull();
    expect(otherCookie).not.toBe(oldCookie);
    const form = await render(jar, ACADEMY, { prompt: ["login"] });
    const fields = { authRequest: form.authRequest, csrf: form.csrf };
    const sent = await post(jar, "login/otp/request", {
      identifier: attacker,
      channel: "email",
      ...fields,
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toEqual({ status: "otp_sent" });
    const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
    const formId = jar.values.get(FORM_COOKIE_NAME)!;
    const binding = await state.getForm(formId);
    expect(binding).toEqual({
      csrfToken: form.csrf,
      storefront: "academy",
      authRequestId: form.authRequest,
    });
    const cookies = [...jar.values];
    const before = await pool.query(
      "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
      [oldRecord!.session.sub],
    );
    expect(before.rows).toHaveLength(2);
    expect(await recordRows(attacker)).toEqual([]);
    const request = await hostIdp.readAuthRequest(form.authRequest);
    expect(request).not.toBeNull();
    const finalised = [...hostIdp.finalised];
    const lifetimes = [...hostIdp.lifetimes];
    const auth = app.get(AuthService);
    const otp = vi.spyOn(auth, "otpStep");
    const verify = vi.spyOn(idp, "submitEmailCode");
    const terminate = vi.spyOn(idp, "terminateSession");
    const insert = vi.spyOn(records, "insert");
    const remove = vi.spyOn(records, "delete");
    const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
    const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
    const noWork = [
      vi.spyOn(auth, "passwordStep"),
      vi.spyOn(auth, "verifyStep"),
      vi.spyOn(auth, "requestLoginOtp"),
      vi.spyOn(idp, "passwordLogin"),
      vi.spyOn(idp, "loginWithEmailOtp"),
      vi.spyOn(idp, "loginWithSmsOtp"),
      vi.spyOn(idp, "requestEmailLoginCode"),
      vi.spyOn(idp, "requestSmsOtp"),
      vi.spyOn(records, "deleteBySubject"),
      vi.spyOn(records, "touchFinalised"),
      vi.spyOn(hostIdp, "finaliseWithError"),
    ];
    const spies = [
      otp,
      verify,
      terminate,
      insert,
      remove,
      lifetime,
      finalise,
      ...noWork,
    ];
    const payload = {
      identifier: attacker,
      channel: "email",
      code: FAKE_VALID_CODE,
      ...fields,
    };
    const rejectedHeaders: Array<Record<string, string>> = [
      { origin: "https://evil.test" },
      { origin: HOST_ORIGIN, "sec-fetch-site": "cross-site" },
    ];
    try {
      for (const headers of rejectedHeaders) {
        const refused = await post(jar, "login/otp", payload, headers);
        expect(refused.statusCode).toBe(403);
        expect(refused.cookies).toEqual([]);
        expect(
          Object.keys(refused.headers).filter((name) =>
            name.startsWith("access-control-"),
          ),
        ).toEqual([]);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect([...jar.values]).toEqual(cookies);
        expect(await state.getForm(formId)).toEqual(binding);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(
          (
            await pool.query(
              "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
              [oldRecord!.session.sub],
            )
          ).rows,
        ).toEqual(before.rows);
        expect(await recordRows(attacker)).toEqual([]);
        expect(await hostIdp.readAuthRequest(form.authRequest)).toEqual(
          request,
        );
        expect(hostIdp.finalised).toEqual(finalised);
        expect(hostIdp.lifetimes).toEqual(lifetimes);
      }

      const accepted = await post(jar, "login/otp", payload);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({
        status: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(otp).toHaveBeenCalledExactlyOnceWith(
        { identifier: attacker, channel: "email", code: FAKE_VALID_CODE },
        expect.any(Function),
      );
      expect(verify).toHaveBeenCalledExactlyOnceWith(
        attacker,
        FAKE_VALID_CODE,
        undefined,
      );
      const freshCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      expect(freshCookie).toBeTruthy();
      expect([oldCookie, otherCookie]).not.toContain(freshCookie);
      const fresh = await records.find(freshCookie);
      expect(fresh).not.toBeNull();
      expect(fresh!.session.sub).not.toBe(oldRecord!.session.sub);
      expect(fresh!.session.sub).toBe(
        (await verify.mock.results[0]!.value)!.sub,
      );
      expect(await records.find(oldCookie)).toBeNull();
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(await recordRows(holder)).toHaveLength(1);
      expect(await recordRows(attacker)).toHaveLength(1);
      expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
      expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime).toHaveBeenCalledExactlyOnceWith(
        fresh!.session,
        SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
      );
      expect(finalise).toHaveBeenCalledExactlyOnceWith(
        form.authRequest,
        fresh!.session,
      );
      expect(hostIdp.finalised).toEqual([
        ...finalised,
        { id: form.authRequest, session: fresh!.session },
      ]);
      expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
        RECORD_COOKIE_NAME,
      ]);
      expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formId);
      expect(await state.getForm(formId)).toEqual(binding);
      expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
      for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

      const nextRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        prompt: ["none"],
      });
      const reused = await entry(other, nextRequest);
      expect(reused.res.statusCode).toBe(200);
      expect(reused.body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(reused.res.cookies).toEqual([]);
      expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(finalise).toHaveBeenCalledTimes(2);
      expect(finalise).toHaveBeenLastCalledWith(
        nextRequest,
        otherRecord!.session,
      );
      expect(verify).toHaveBeenCalledTimes(1);
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime).toHaveBeenCalledTimes(1);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("EARS-25: the registration code is re-sent on the host through the storefront's resend, bound to the form", async () => {
    const jar = new Jar();
    const form = await render(jar, DOCTOR, { prompt: ["create"] });
    const address = email("resend");
    await registerOnStorefront(address);
    const resend = vi.spyOn(app.get(AuthService), "resendEmailVerification");
    const ok = await post(jar, "verify/resend", {
      identifier: address,
      authRequest: form.authRequest,
      csrf: form.csrf,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: "resend_requested" });
    // The same acknowledgement for an unknown address (EARS-16).
    const unknown = await post(jar, "verify/resend", {
      identifier: `nobody-${Date.now()}@ds.test`,
      authRequest: form.authRequest,
      csrf: form.csrf,
    });
    expect(unknown.json()).toEqual(ok.json());
    expect(resend).toHaveBeenCalledWith(address);
    // Without the form binding it is the one 403 and nothing is sent.
    resend.mockClear();
    const refused = await post(jar, "verify/resend", {
      identifier: address,
      authRequest: form.authRequest,
      csrf: "wrong",
    });
    expect(refused.statusCode).toBe(403);
    expect(resend).not.toHaveBeenCalled();
    resend.mockRestore();
  });

  it("EARS-24: each storefront's registration runs on the host through its own register command; a mismatched door is refused", async () => {
    const jar = new Jar();
    const academy = await render(jar, ACADEMY, { prompt: ["create"] });
    expect(academy.body.door).toBe("register");
    const academyAddress = email("reg-academy");
    const ok = await post(jar, "register", {
      email: academyAddress,
      password: PASSWORD,
      consent: CONSENT,
      authRequest: academy.authRequest,
      csrf: academy.csrf,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: "pending_verification" });
    // The doctor command on the Academy form: refused before anything runs.
    const wrongDoor = await post(jar, "storefront/doctor/register", {
      email: email("reg-wrong"),
      password: PASSWORD,
      medicalWorkerDeclaration: true,
      consent: [
        {
          purpose: PARTNER_DATA_SHARING_PURPOSE,
          version: PARTNER_DATA_SHARING_VERSION,
        },
      ],
      authRequest: academy.authRequest,
      csrf: academy.csrf,
    });
    expect(wrongDoor.statusCode).toBe(403);

    // The registration code completes as the EARS-5 credential step.
    const verified = await post(jar, "verify", {
      email: academyAddress,
      code: FAKE_VALID_CODE,
      authRequest: academy.authRequest,
      csrf: academy.csrf,
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.cookies.map((c) => c.name)).not.toContain(
      SESSION_COOKIE_NAME,
    );
    expect(await recordRows(academyAddress)).toHaveLength(1);

    const doctorJar = new Jar();
    const doctor = await render(doctorJar, DOCTOR, { prompt: ["create"] });
    const doctorAddress = email("reg-doctor");
    const doctorOk = await post(doctorJar, "storefront/doctor/register", {
      email: doctorAddress,
      password: PASSWORD,
      medicalWorkerDeclaration: true,
      consent: [
        {
          purpose: PARTNER_DATA_SHARING_PURPOSE,
          version: PARTNER_DATA_SHARING_VERSION,
        },
      ],
      authRequest: doctor.authRequest,
      csrf: doctor.csrf,
    });
    expect(doctorOk.statusCode).toBe(200);
    const doctorVerified = await post(doctorJar, "storefront/doctor/verify", {
      email: doctorAddress,
      code: FAKE_VALID_CODE,
      authRequest: doctor.authRequest,
      csrf: doctor.csrf,
    });
    expect(doctorVerified.statusCode).toBe(200);
    expect(await recordRows(doctorAddress)).toHaveLength(1);
    // The Academy code step on the doctor form is refused.
    const academyVerifyOnDoctor = await post(doctorJar, "verify", {
      email: doctorAddress,
      code: FAKE_VALID_CODE,
      authRequest: doctor.authRequest,
      csrf: doctor.csrf,
    });
    expect(academyVerifyOnDoctor.statusCode).toBe(403);
  });

  it.each([
    ["academy", ACADEMY, "register", "verify", 400],
    [
      "doctor",
      DOCTOR,
      "storefront/doctor/register",
      "storefront/doctor/verify",
      422,
    ],
  ] as const)(
    "EARS-24/41: S171 %s registration refuses missing consents before replacing another account's live record on accepted verification",
    async (storefront, clientId, registerPath, verifyPath, refusalStatus) => {
      const holder = await account(`s171-holder-${storefront}`);
      const jar = new Jar();
      await signIn(jar, holder, clientId);
      const records = app.get(SignInHostRecordStore);
      const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      const oldRecord = await records.find(oldCookie);
      expect(oldRecord).not.toBeNull();
      const address = email(`s171-new-${storefront}`);
      const finalisedBefore = hostIdp.finalised.length;
      const create = vi.spyOn(idp, "createUser");
      const mail = vi.spyOn(
        app.get<Mailer>(MAILER),
        "sendVerificationCodeEmail",
      );
      const send = vi.spyOn(idp, "requestEmailVerification");
      const verify = vi.spyOn(idp, "submitEmailCode");
      const terminate = vi.spyOn(idp, "terminateSession");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const spies = [create, mail, send, verify, terminate, finalise];
      try {
        const form = await render(jar, clientId, { prompt: ["create"] });
        expect(form.body).toEqual({
          action: "render",
          storefront,
          door: "register",
          authRequest: form.authRequest,
          csrf: form.csrf,
        });
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(finalise).not.toHaveBeenCalled();
        const formCookie = jar.values.get(FORM_COOKIE_NAME);
        const fields = { authRequest: form.authRequest, csrf: form.csrf };
        const refused = await post(jar, registerPath, {
          email: address,
          password: PASSWORD,
          ...(storefront === "doctor"
            ? { medicalWorkerDeclaration: true }
            : {}),
          consent: [],
          ...fields,
        });
        expect(refused.statusCode).toBe(refusalStatus);
        expect(refused.cookies).toEqual([]);
        expect(create).not.toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(verify).not.toHaveBeenCalled();
        expect(finalise).not.toHaveBeenCalled();
        expect(terminate).not.toHaveBeenCalled();
        expect(
          (await pool.query("SELECT id FROM users WHERE email = $1", [address]))
            .rows,
        ).toEqual([]);
        expect(
          (
            await pool.query(
              "SELECT cr.id FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1",
              [address],
            )
          ).rows,
        ).toEqual([]);
        expect(await recordRows(address)).toEqual([]);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formCookie);
        const consent =
          storefront === "doctor"
            ? [
                {
                  purpose: PARTNER_DATA_SHARING_PURPOSE,
                  version: PARTNER_DATA_SHARING_VERSION,
                },
              ]
            : CONSENT;
        const registered = await post(jar, registerPath, {
          email: address,
          password: PASSWORD,
          ...(storefront === "doctor"
            ? { medicalWorkerDeclaration: true }
            : {}),
          consent,
          ...fields,
        });
        expect(registered.statusCode).toBe(200);
        expect(registered.json()).toEqual({ status: "pending_verification" });
        expect(registered.cookies).toEqual([]);
        expect(create).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
          expect.any(String),
          address,
          FAKE_VALID_CODE,
        );
        const users = await pool.query<{
          zitadel_sub: string;
          email_verified: boolean;
        }>("SELECT zitadel_sub, email_verified FROM users WHERE email = $1", [
          address,
        ]);
        expect(users.rows).toEqual([
          { zitadel_sub: expect.any(String), email_verified: false },
        ]);
        const consents = await pool.query<{ purpose: string; version: string }>(
          "SELECT purpose, version FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY purpose",
          [address],
        );
        expect(consents.rows).toEqual(
          storefront === "doctor"
            ? [
                {
                  purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
                  version: MEDICAL_WORKER_DECLARATION_VERSION,
                },
                {
                  purpose: PARTNER_DATA_SHARING_PURPOSE,
                  version: PARTNER_DATA_SHARING_VERSION,
                },
              ]
            : CONSENT,
        );
        expect(await recordRows(address)).toEqual([]);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formCookie);
        expect(terminate).not.toHaveBeenCalled();
        expect(finalise).not.toHaveBeenCalled();
        expect(hostIdp.finalised).toHaveLength(finalisedBefore);
        const accepted = await post(jar, verifyPath, {
          email: address,
          code: FAKE_VALID_CODE,
          registration: {
            password: PASSWORD,
            consent,
            ...(storefront === "doctor"
              ? { medicalWorkerDeclaration: true }
              : {}),
          },
          ...fields,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(verify).toHaveBeenCalledExactlyOnceWith(
          address,
          FAKE_VALID_CODE,
          { password: PASSWORD },
        );
        const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(newCookie).toBeTruthy();
        expect(newCookie).not.toBe(oldCookie);
        const record = await records.find(newCookie);
        expect(record?.session.sub).toBe(users.rows[0]!.zitadel_sub);
        expect(record?.session.sub).not.toBe(oldRecord!.session.sub);
        expect(await records.find(oldCookie)).toBeNull();
        expect(await recordRows(holder)).toEqual([]);
        expect(await recordRows(address)).toHaveLength(1);
        expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          form.authRequest,
          record!.session,
        );
        expect(hostIdp.finalised.slice(finalisedBefore)).toEqual([
          { id: form.authRequest, session: record!.session },
        ]);
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    },
  );

  it.each([
    ["academy", ACADEMY, "register", "verify"],
    [
      "doctor",
      DOCTOR,
      "storefront/doctor/register",
      "storefront/doctor/verify",
    ],
  ] as const)(
    "EARS-41: S171 a warm %s registration refuses a wrong code without changing the colleague identity, then the same form accepts the retained code",
    async (storefront, clientId, registerPath, verifyPath) => {
      const holder = await account(`s171-wrong-holder-${storefront}`);
      const jar = new Jar();
      const other = new Jar();
      await signIn(jar, holder, clientId);
      await signIn(other, holder, clientId);
      const records = app.get(SignInHostRecordStore);
      const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
      const oldRecord = await records.find(oldCookie);
      const otherRecord = await records.find(otherCookie);
      expect(oldRecord).not.toBeNull();
      expect(otherRecord).not.toBeNull();
      expect(otherCookie).not.toBe(oldCookie);
      const form = await render(jar, clientId, { prompt: ["create"] });
      expect(form.body).toMatchObject({ storefront, door: "register" });
      const fields = { authRequest: form.authRequest, csrf: form.csrf };
      const registration = {
        password: PASSWORD,
        consent:
          storefront === "doctor"
            ? [
                {
                  purpose: PARTNER_DATA_SHARING_PURPOSE,
                  version: PARTNER_DATA_SHARING_VERSION,
                },
              ]
            : CONSENT,
        ...(storefront === "doctor" ? { medicalWorkerDeclaration: true } : {}),
      };
      const address = email(`s171-wrong-pending-${storefront}`);
      const registered = await post(jar, registerPath, {
        email: address,
        ...registration,
        ...fields,
      });
      expect(registered.statusCode).toBe(200);
      expect(registered.json()).toEqual({ status: "pending_verification" });
      expect(registered.cookies).toEqual([]);
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const formCookie = jar.values.get(FORM_COOKIE_NAME)!;
      const binding = await state.getForm(formCookie);
      expect(binding).toEqual({
        csrfToken: form.csrf,
        storefront,
        authRequestId: form.authRequest,
      });
      const cookies = [...jar.values];
      const pending = await pool.query<{
        zitadel_sub: string;
        email_verified: boolean;
      }>("SELECT * FROM users WHERE email = $1", [address]);
      expect(pending.rows).toEqual([
        expect.objectContaining({
          zitadel_sub: expect.any(String),
          email_verified: false,
        }),
      ]);
      const consents = await pool.query(
        "SELECT cr.* FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY cr.id",
        [address],
      );
      expect(consents.rows).toHaveLength(storefront === "doctor" ? 2 : 1);
      const holderRows = await pool.query(
        "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
        [oldRecord!.session.sub],
      );
      expect(holderRows.rows).toHaveLength(2);
      const request = await hostIdp.readAuthRequest(form.authRequest);
      expect(request).not.toBeNull();
      const finalised = [...hostIdp.finalised];
      const lifetimes = [...hostIdp.lifetimes];
      const verify = vi.spyOn(idp, "submitEmailCode");
      const terminate = vi.spyOn(idp, "terminateSession");
      const remove = vi.spyOn(records, "delete");
      const insert = vi.spyOn(records, "insert");
      const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
      const spies = [
        verify,
        terminate,
        remove,
        insert,
        lifetime,
        finalise,
        finaliseError,
      ];
      try {
        const wrong = await post(jar, verifyPath, {
          email: address,
          code: "000000",
          registration,
          ...fields,
        });
        expect(wrong.statusCode).toBe(400);
        expect(wrong.json()).toMatchObject({
          message: "the request could not be completed",
        });
        expect(wrong.cookies).toEqual([]);
        expect(verify).toHaveBeenCalledExactlyOnceWith(address, "000000", {
          password: PASSWORD,
        });
        expect(await verify.mock.results[0]!.value).toBeNull();
        for (const spy of spies.slice(1)) expect(spy).not.toHaveBeenCalled();
        expect([...jar.values]).toEqual(cookies);
        expect(await state.getForm(formCookie)).toEqual(binding);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(
          (
            await pool.query(
              "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
              [oldRecord!.session.sub],
            )
          ).rows,
        ).toEqual(holderRows.rows);
        expect(
          (await pool.query("SELECT * FROM users WHERE email = $1", [address]))
            .rows,
        ).toEqual(pending.rows);
        expect(
          (
            await pool.query(
              "SELECT cr.* FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY cr.id",
              [address],
            )
          ).rows,
        ).toEqual(consents.rows);
        expect(await recordRows(address)).toEqual([]);
        expect(hostIdp.finalised).toEqual(finalised);
        expect(hostIdp.lifetimes).toEqual(lifetimes);
        expect(await hostIdp.readAuthRequest(form.authRequest)).toEqual(
          request,
        );

        const accepted = await post(jar, verifyPath, {
          email: address,
          code: FAKE_VALID_CODE,
          registration,
          ...fields,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(verify).toHaveBeenCalledTimes(2);
        expect(verify).toHaveBeenNthCalledWith(2, address, FAKE_VALID_CODE, {
          password: PASSWORD,
        });
        const checked = await verify.mock.results[1]!.value;
        expect(checked).toMatchObject({
          sub: pending.rows[0]!.zitadel_sub,
          verifiedNow: true,
        });
        const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(newCookie).toBeTruthy();
        expect(newCookie).not.toBe(oldCookie);
        const fresh = await records.find(newCookie);
        expect(fresh?.session.sub).toBe(pending.rows[0]!.zitadel_sub);
        expect(fresh?.session.sub).not.toBe(oldRecord!.session.sub);
        expect(await records.find(oldCookie)).toBeNull();
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
        expect(await recordRows(holder)).toHaveLength(1);
        expect(await recordRows(address)).toHaveLength(1);
        expect(
          (
            await pool.query(
              "SELECT zitadel_sub, email_verified FROM users WHERE email = $1",
              [address],
            )
          ).rows,
        ).toEqual([
          { zitadel_sub: pending.rows[0]!.zitadel_sub, email_verified: true },
        ]);
        expect(
          (
            await pool.query(
              "SELECT cr.* FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY cr.id",
              [address],
            )
          ).rows,
        ).toEqual(consents.rows);
        expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
        expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledExactlyOnceWith(
          checked!.session,
          SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
        );
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          form.authRequest,
          fresh!.session,
        );
        expect(finaliseError).not.toHaveBeenCalled();
        expect(hostIdp.finalised).toEqual([
          ...finalised,
          { id: form.authRequest, session: fresh!.session },
        ]);
        expect(await hostIdp.readAuthRequest(form.authRequest)).toBeNull();
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formCookie);
        expect(await state.getForm(formCookie)).toEqual(binding);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    },
  );

  it("EARS-70: S167 an exactly expired Academy form refuses the registration code before verification and a fresh binding accepts it", async () => {
    let stateNow = Date.now();
    const state = new InMemorySignInHostStateStore(
      Buffer.alloc(32, 7),
      () => stateNow,
    );
    const isolated = await compile(
      RELAXED_RATE_LIMIT,
      undefined,
      undefined,
      state,
    );
    const jar = new Jar();
    const address = email("s167-form-expiry");
    const authRequest = isolated.hostIdp.seedAuthRequest({
      clientId: ACADEMY,
      prompt: ["create"],
    });
    try {
      const opened = await isolated.app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
        headers: DEVICE,
      });
      expect(opened.statusCode).toBe(200);
      const form = opened.json() as SignInHostEntryResponse;
      expect(form).toEqual({
        action: "render",
        storefront: "academy",
        door: "register",
        authRequest,
        csrf: expect.any(String),
      });
      if (form.action !== "render") throw new Error("not rendered");
      jar.apply(opened.cookies);
      const formId = jar.values.get(FORM_COOKIE_NAME)!;
      const binding = await state.getForm(formId);
      expect(binding).toEqual({
        csrfToken: form.csrf,
        storefront: "academy",
        authRequestId: authRequest,
      });
      const expiresAt = stateNow + FORM_STATE_TTL_SECONDS * 1000;
      const registered = await isolated.app.inject({
        method: "POST",
        url: "/v1/sign-in-host/register",
        headers: {
          ...DEVICE,
          origin: HOST_ORIGIN,
          "sec-fetch-site": "same-origin",
          cookie: jar.header(),
        },
        payload: {
          email: address,
          password: PASSWORD,
          consent: CONSENT,
          authRequest,
          csrf: form.csrf,
        },
      });
      expect(registered.statusCode).toBe(200);
      expect(registered.json()).toEqual({ status: "pending_verification" });
      expect(registered.cookies).toEqual([]);
      const pending = await pool.query("SELECT * FROM users WHERE email = $1", [
        address,
      ]);
      expect(pending.rows).toEqual([
        expect.objectContaining({ email_verified: false }),
      ]);
      const cookies = [...jar.values];
      const request = await isolated.hostIdp.readAuthRequest(authRequest);
      expect(request).not.toBeNull();
      const records = isolated.app.get(SignInHostRecordStore);
      const verify = vi.spyOn(isolated.idp, "submitEmailCode");
      const verifyStep = vi.spyOn(isolated.app.get(AuthService), "verifyStep");
      const insert = vi.spyOn(records, "insert");
      const lifetime = vi.spyOn(isolated.hostIdp, "setSessionLifetime");
      const finalise = vi.spyOn(isolated.hostIdp, "finaliseWithSession");
      const finaliseError = vi.spyOn(isolated.hostIdp, "finaliseWithError");
      const terminate = vi.spyOn(isolated.idp, "terminateSession");
      const spies = [
        verify,
        verifyStep,
        insert,
        lifetime,
        finalise,
        finaliseError,
        terminate,
      ];
      const payload = {
        email: address,
        code: FAKE_VALID_CODE,
        authRequest,
        csrf: form.csrf,
      };
      try {
        stateNow = expiresAt - 1;
        expect(await state.getForm(formId)).toEqual(binding);
        stateNow = expiresAt;
        const refused = await isolated.app.inject({
          method: "POST",
          url: "/v1/sign-in-host/verify",
          headers: {
            ...DEVICE,
            origin: HOST_ORIGIN,
            "sec-fetch-site": "same-origin",
            cookie: jar.header(),
          },
          payload,
        });
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toMatchObject({ message: "form refused" });
        expect(refused.cookies).toEqual([]);
        expect(await state.getForm(formId)).toBeNull();
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect([...jar.values]).toEqual(cookies);
        expect(await recordRows(address)).toEqual([]);
        expect(
          (await pool.query("SELECT * FROM users WHERE email = $1", [address]))
            .rows,
        ).toEqual(pending.rows);
        expect(
          await isolated.idp.getUser(pending.rows[0]!.zitadel_sub),
        ).toMatchObject({ email: address, emailVerified: false });
        expect(await isolated.hostIdp.readAuthRequest(authRequest)).toEqual(
          request,
        );

        const reopened = await isolated.app.inject({
          method: "GET",
          url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
          headers: { ...DEVICE, cookie: jar.header() },
        });
        expect(reopened.statusCode).toBe(200);
        const fresh = reopened.json() as SignInHostEntryResponse;
        expect(fresh).toEqual({
          action: "render",
          storefront: "academy",
          door: "register",
          authRequest,
          csrf: expect.any(String),
        });
        if (fresh.action !== "render") throw new Error("not rendered");
        jar.apply(reopened.cookies);
        const freshId = jar.values.get(FORM_COOKIE_NAME)!;
        expect(freshId).not.toBe(formId);
        expect(fresh.csrf).not.toBe(form.csrf);
        expect(await state.getForm(freshId)).toEqual({
          csrfToken: fresh.csrf,
          storefront: "academy",
          authRequestId: authRequest,
        });
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        const accepted = await isolated.app.inject({
          method: "POST",
          url: "/v1/sign-in-host/verify",
          headers: {
            ...DEVICE,
            origin: HOST_ORIGIN,
            "sec-fetch-site": "same-origin",
            cookie: jar.header(),
          },
          payload: { ...payload, csrf: fresh.csrf },
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        jar.apply(accepted.cookies);
        expect(verify).toHaveBeenCalledExactlyOnceWith(
          address,
          FAKE_VALID_CODE,
          undefined,
        );
        expect(verifyStep).toHaveBeenCalledTimes(1);
        const recordId = jar.values.get(RECORD_COOKIE_NAME)!;
        const record = await records.find(recordId);
        expect(record?.session.sub).toBe(pending.rows[0]!.zitadel_sub);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledExactlyOnceWith(
          record!.session,
          SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
        );
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          authRequest,
          record!.session,
        );
        expect(finaliseError).not.toHaveBeenCalled();
        expect(isolated.hostIdp.finalised).toEqual([
          { id: authRequest, session: record!.session },
        ]);
        expect(await recordRows(address)).toHaveLength(1);
        expect(
          await isolated.idp.getUser(pending.rows[0]!.zitadel_sub),
        ).toMatchObject({ email: address, emailVerified: true });
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(freshId);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    } finally {
      await isolated.app.close();
    }
  });

  it("EARS-24: S171 a foreign verification route preserves the pending Academy code and colleague record for the rightful form", async () => {
    const holder = await account("s171-foreign-verify-holder");
    recordNow = new Date();
    const jar = new Jar();
    const other = new Jar();
    await signIn(jar, holder);
    await signIn(other, holder);
    const records = app.get(SignInHostRecordStore);
    const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
    const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
    const oldRecord = await records.find(oldCookie);
    const otherRecord = await records.find(otherCookie);
    expect(oldRecord).not.toBeNull();
    expect(otherRecord).not.toBeNull();
    expect(otherCookie).not.toBe(oldCookie);
    const form = await render(jar, ACADEMY, { prompt: ["create"] });
    const fields = { authRequest: form.authRequest, csrf: form.csrf };
    const address = email("s171-foreign-verify-pending");
    const registered = await post(jar, "register", {
      email: address,
      password: PASSWORD,
      consent: CONSENT,
      ...fields,
    });
    expect(registered.statusCode).toBe(200);
    expect(registered.json()).toEqual({ status: "pending_verification" });
    expect(registered.cookies).toEqual([]);
    const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
    const formCookie = jar.values.get(FORM_COOKIE_NAME)!;
    const binding = await state.getForm(formCookie);
    expect(binding).toEqual({
      csrfToken: form.csrf,
      storefront: "academy",
      authRequestId: form.authRequest,
    });
    const cookies = [...jar.values];
    const pending = await pool.query<{
      zitadel_sub: string;
      email_verified: boolean;
    }>("SELECT * FROM users WHERE email = $1", [address]);
    expect(pending.rows).toEqual([
      expect.objectContaining({
        zitadel_sub: expect.any(String),
        email_verified: false,
      }),
    ]);
    const consents = await pool.query(
      "SELECT cr.* FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY cr.id",
      [address],
    );
    expect(consents.rows).toHaveLength(1);
    const holderRows = await pool.query(
      "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
      [oldRecord!.session.sub],
    );
    expect(holderRows.rows).toHaveLength(2);
    const request = await hostIdp.readAuthRequest(form.authRequest);
    expect(request).not.toBeNull();
    const finalised = [...hostIdp.finalised];
    const lifetimes = [...hostIdp.lifetimes];
    const doctorVerify = vi.spyOn(app.get(DoctorRegisterService), "verifyStep");
    const academyVerify = vi.spyOn(app.get(AuthService), "verifyStep");
    const verify = vi.spyOn(idp, "submitEmailCode");
    const terminate = vi.spyOn(idp, "terminateSession");
    const remove = vi.spyOn(records, "delete");
    const insert = vi.spyOn(records, "insert");
    const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
    const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
    const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
    const spies = [
      doctorVerify,
      academyVerify,
      verify,
      terminate,
      remove,
      insert,
      lifetime,
      finalise,
      finaliseError,
    ];
    const payload = { email: address, code: FAKE_VALID_CODE, ...fields };
    try {
      const refused = await post(jar, "storefront/doctor/verify", payload);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ message: "form refused" });
      expect(refused.cookies).toEqual([]);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect([...jar.values]).toEqual(cookies);
      expect(await state.getForm(formCookie)).toEqual(binding);
      expect(await records.find(oldCookie)).toEqual(oldRecord);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(
        (
          await pool.query(
            "SELECT * FROM sign_in_host_records WHERE subject = $1 ORDER BY cookie_id_hash",
            [oldRecord!.session.sub],
          )
        ).rows,
      ).toEqual(holderRows.rows);
      expect(
        (await pool.query("SELECT * FROM users WHERE email = $1", [address]))
          .rows,
      ).toEqual(pending.rows);
      expect(
        (
          await pool.query(
            "SELECT cr.* FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY cr.id",
            [address],
          )
        ).rows,
      ).toEqual(consents.rows);
      expect(await recordRows(address)).toEqual([]);
      expect(hostIdp.finalised).toEqual(finalised);
      expect(hostIdp.lifetimes).toEqual(lifetimes);
      expect(await hostIdp.readAuthRequest(form.authRequest)).toEqual(request);

      const accepted = await post(jar, "verify", payload);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toEqual({
        status: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(doctorVerify).not.toHaveBeenCalled();
      expect(academyVerify).toHaveBeenCalledExactlyOnceWith(
        { email: address, code: FAKE_VALID_CODE },
        expect.any(Function),
      );
      expect(verify).toHaveBeenCalledExactlyOnceWith(
        address,
        FAKE_VALID_CODE,
        undefined,
      );
      const checked = await verify.mock.results[0]!.value;
      expect(checked).toMatchObject({
        sub: pending.rows[0]!.zitadel_sub,
        verifiedNow: true,
      });
      const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      expect(newCookie).toBeTruthy();
      expect([oldCookie, otherCookie]).not.toContain(newCookie);
      const fresh = await records.find(newCookie);
      expect(fresh?.session.sub).toBe(pending.rows[0]!.zitadel_sub);
      expect(fresh?.session.sub).not.toBe(oldRecord!.session.sub);
      expect(await records.find(oldCookie)).toBeNull();
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(await recordRows(holder)).toHaveLength(1);
      expect(await recordRows(address)).toHaveLength(1);
      expect(
        (
          await pool.query(
            "SELECT zitadel_sub, email_verified FROM users WHERE email = $1",
            [address],
          )
        ).rows,
      ).toEqual([
        { zitadel_sub: pending.rows[0]!.zitadel_sub, email_verified: true },
      ]);
      expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
      expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime).toHaveBeenCalledExactlyOnceWith(
        fresh!.session,
        SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
      );
      expect(finalise).toHaveBeenCalledExactlyOnceWith(
        form.authRequest,
        fresh!.session,
      );
      expect(finaliseError).not.toHaveBeenCalled();
      expect(hostIdp.finalised).toEqual([
        ...finalised,
        { id: form.authRequest, session: fresh!.session },
      ]);
      expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
        RECORD_COOKIE_NAME,
      ]);
      expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formCookie);
      expect(await state.getForm(formCookie)).toEqual(binding);
      expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);

      const nextRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        prompt: ["none"],
      });
      const reused = await entry(other, nextRequest);
      expect(reused.res.statusCode).toBe(200);
      expect(reused.body).toEqual({
        action: "redirect",
        url: expect.stringContaining("code="),
      });
      expect(reused.res.cookies).toEqual([]);
      expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
      expect(await records.find(otherCookie)).toEqual(otherRecord);
      expect(finalise).toHaveBeenCalledTimes(2);
      expect(finalise).toHaveBeenLastCalledWith(
        nextRequest,
        otherRecord!.session,
      );
      expect(doctorVerify).not.toHaveBeenCalled();
      expect(verify).toHaveBeenCalledTimes(1);
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(lifetime).toHaveBeenCalledTimes(1);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  describe.each([
    ["academy", ACADEMY, "register", "verify", ACADEMY_LOGIN],
    [
      "doctor",
      DOCTOR,
      "storefront/doctor/register",
      "storefront/doctor/verify",
      DOCTOR_LOGIN,
    ],
  ] as const)(
    "EARS-39/41/66: S167 %s registration code state",
    (storefront, clientId, registerPath, verifyPath, loginUrl) => {
      async function pendingRegistration() {
        const jar = new Jar();
        const form = await render(jar, clientId, { prompt: ["create"] });
        const address = email(`cold-${storefront}`);
        const registered = await post(jar, registerPath, {
          email: address,
          password: PASSWORD,
          ...(storefront === "doctor"
            ? {
                medicalWorkerDeclaration: true,
                consent: [
                  {
                    purpose: PARTNER_DATA_SHARING_PURPOSE,
                    version: PARTNER_DATA_SHARING_VERSION,
                  },
                ],
              }
            : { consent: CONSENT }),
          authRequest: form.authRequest,
          csrf: form.csrf,
        });
        expect(registered.statusCode).toBe(200);
        expect(registered.json()).toEqual({ status: "pending_verification" });
        expect(await recordRows(address)).toEqual([]);
        return { jar, form, address };
      }

      it("EARS-39: S167 reopening a live registration form rejects the old binding before code verification and accepts the new binding", async () => {
        const { jar, form, address } = await pendingRegistration();
        const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
        const oldFormId = jar.values.get(FORM_COOKIE_NAME)!;
        const oldJar = new Jar();
        oldJar.values.set(FORM_COOKIE_NAME, oldFormId);
        const { res: reopened, body } = await entry(jar, form.authRequest);
        expect(reopened.statusCode).toBe(200);
        expect(body).toMatchObject({
          action: "render",
          storefront,
          door: "register",
          authRequest: form.authRequest,
        });
        if (body.action !== "render") throw new Error("not rendered");
        expect(jar.values.get(FORM_COOKIE_NAME)).not.toBe(oldFormId);
        expect(body.csrf).not.toBe(form.csrf);
        expect(await state.getForm(oldFormId)).toBeNull();
        const verify = vi.spyOn(idp, "submitEmailCode");
        const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
        try {
          const originalProof = {
            email: address,
            code: FAKE_VALID_CODE,
            authRequest: form.authRequest,
            csrf: form.csrf,
          };
          for (const staleJar of [oldJar, jar]) {
            const refused = await post(staleJar, verifyPath, originalProof);
            expect(refused.statusCode).toBe(403);
            expect(refused.cookies).toEqual([]);
          }
          expect(verify).not.toHaveBeenCalled();
          expect(finalise).not.toHaveBeenCalled();
          expect(await recordRows(address)).toEqual([]);
          const accepted = await post(jar, verifyPath, {
            ...originalProof,
            csrf: body.csrf,
          });
          expect(accepted.statusCode).toBe(200);
          expect(accepted.json()).toEqual({
            status: "redirect",
            url: expect.stringContaining("code="),
          });
          expect(verify).toHaveBeenCalledExactlyOnceWith(
            address,
            FAKE_VALID_CODE,
            undefined,
          );
          const record = await app
            .get(SignInHostRecordStore)
            .find(jar.values.get(RECORD_COOKIE_NAME)!);
          expect(record).not.toBeNull();
          expect(finalise).toHaveBeenCalledExactlyOnceWith(
            form.authRequest,
            record!.session,
          );
          expect(await recordRows(address)).toHaveLength(1);
          expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
            RECORD_COOKIE_NAME,
          ]);
          expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
        } finally {
          verify.mockRestore();
          finalise.mockRestore();
        }
      });

      it("EARS-66: S167 a code accepted after its reopened auth request expires keeps the host record and returns to the originating login", async () => {
        const { jar, form, address } = await pendingRegistration();
        const { body } = await entry(jar, form.authRequest);
        expect(body.action).toBe("render");
        if (body.action !== "render") throw new Error("not rendered");
        hostIdp.expire(form.authRequest);
        const finalisedBefore = hostIdp.finalised.length;
        const accepted = await post(jar, verifyPath, {
          email: address,
          code: FAKE_VALID_CODE,
          authRequest: form.authRequest,
          csrf: body.csrf,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({ status: "redirect", url: loginUrl });
        expect(hostIdp.finalised).toHaveLength(finalisedBefore);
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
        const recordId = jar.values.get(RECORD_COOKIE_NAME)!;
        const records = app.get(SignInHostRecordStore);
        const record = await records.find(recordId);
        expect(record).not.toBeNull();
        expect(await recordRows(address)).toHaveLength(1);
        const verify = vi.spyOn(idp, "submitEmailCode");
        const send = vi.spyOn(idp, "requestEmailLoginCode");
        try {
          const nextRequest = hostIdp.seedAuthRequest({ clientId });
          const { res, body: next } = await entry(jar, nextRequest);
          expect(res.statusCode).toBe(200);
          expect(next).toEqual({
            action: "redirect",
            url: expect.stringContaining("code="),
          });
          expect(hostIdp.finalised.at(-1)).toEqual({
            id: nextRequest,
            session: record!.session,
          });
          expect(res.cookies).toEqual([]);
          expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(recordId);
          expect((await records.find(recordId))!.expiresAt).toEqual(
            record!.expiresAt,
          );
          expect(verify).not.toHaveBeenCalled();
          expect(send).not.toHaveBeenCalled();
        } finally {
          verify.mockRestore();
          send.mockRestore();
        }
      });
    },
  );

  describe("EARS-44: the hand-off against a live record", () => {
    async function handoffIntent(
      ref: string,
      clientId = DOCTOR,
    ): Promise<string> {
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      return state.putIntent(
        { door: "login", method: "code", handoff: ref, clientId },
        600,
      );
    }
    async function mint(address: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [address],
      );
      return app
        .get<LoginHandoffStore>(LOGIN_HANDOFF_STORE)
        .mint(rows[0]!.id, address);
    }

    it.each([
      ["academy", ACADEMY, DOCTOR],
      ["doctor", DOCTOR, ACADEMY],
    ] as const)(
      "EARS-44: S173 a live own reference finalises for %s without credentials, sends, redemption or record replacement",
      async (_storefront, clientId, initialClient) => {
        const address = await account("handoff-own");
        const jar = new Jar();
        await signIn(jar, address, initialClient);
        const cookieId = jar.values.get(RECORD_COOKIE_NAME)!;
        const records = app.get(SignInHostRecordStore);
        const before = await records.find(cookieId);
        expect(before).not.toBeNull();
        const ref = await mint(address);
        const store = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
        const reference = await store.peek(ref);
        expect(reference).toEqual({
          accountId: expect.any(String),
          identifier: address,
        });
        const auth = app.get(AuthService);
        const noWork = [
          vi.spyOn(store, "redeem"),
          vi.spyOn(auth, "passwordStep"),
          vi.spyOn(auth, "otpStep"),
          vi.spyOn(auth, "requestLoginOtp"),
          vi.spyOn(idp, "passwordLogin"),
          vi.spyOn(idp, "verifyEmail"),
          vi.spyOn(idp, "verifyPhone"),
          vi.spyOn(idp, "loginWithEmailOtp"),
          vi.spyOn(idp, "loginWithSmsOtp"),
          vi.spyOn(idp, "requestEmailLoginCode"),
          vi.spyOn(idp, "requestSmsOtp"),
          vi.spyOn(idp, "terminateSession"),
          vi.spyOn(hostIdp, "setSessionLifetime"),
          vi.spyOn(hostIdp, "finaliseWithError"),
        ];
        const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
        const lifetimes = hostIdp.lifetimes.length;
        try {
          for (const elapsedSeconds of [1, 2]) {
            recordNow = new Date(
              before!.lastFinalisedAt.getTime() + elapsedSeconds * 1000,
            );
            const authRequest = hostIdp.seedAuthRequest({
              clientId,
              loginHint: await handoffIntent(ref, clientId),
            });
            const { res, body } = await entry(jar, authRequest);
            expect(res.statusCode).toBe(200);
            expect(body).toEqual({
              action: "redirect",
              url: expect.stringContaining("code="),
            });
            expect(res.payload).not.toContain(ref);
            expect(JSON.stringify(res.headers)).not.toContain(ref);
            expect(res.cookies).toEqual([]);
            expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(cookieId);
            expect(hostIdp.finalised.at(-1)).toEqual({
              id: authRequest,
              session: before!.session,
            });
            expect(finalise).toHaveBeenLastCalledWith(
              authRequest,
              before!.session,
            );
            expect(await records.find(cookieId)).toEqual({
              ...before,
              lastFinalisedAt: recordNow,
            });
            expect(await recordRows(address)).toHaveLength(1);
            expect(await store.peek(ref)).toEqual(reference);
          }
          expect(finalise).toHaveBeenCalledTimes(2);
          expect(hostIdp.lifetimes).toHaveLength(lifetimes);
          for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
        } finally {
          finalise.mockRestore();
          for (const spy of noWork) spy.mockRestore();
        }
      },
    );

    it("EARS-68: S173 prompt=login with a live own handoff requires fresh code and replaces only the presented browser record", async () => {
      const address = await account("s173-fresh-own");
      recordNow = new Date();
      const jar = new Jar();
      const other = new Jar();
      await signIn(jar, address);
      await signIn(other, address);
      const records = app.get(SignInHostRecordStore);
      const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
      const oldRecord = await records.find(oldCookie);
      const otherRecord = await records.find(otherCookie);
      expect(oldRecord).not.toBeNull();
      expect(otherRecord).not.toBeNull();
      expect(otherCookie).not.toBe(oldCookie);
      expect(otherRecord!.session.sub).toBe(oldRecord!.session.sub);
      expect(otherRecord!.session.zitadelSessionId).not.toBe(
        oldRecord!.session.zitadelSessionId,
      );
      const before = await recordRows(address);
      expect(before).toHaveLength(2);
      const ref = await mint(address);
      const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
      const reference = await handoffs.peek(ref);
      expect(reference).toEqual({
        accountId: expect.any(String),
        identifier: address,
      });
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const hint = await handoffIntent(ref, ACADEMY);
      const authRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        prompt: ["login"],
        loginHint: hint,
      });
      const auth = app.get(AuthService);
      const own = vi.spyOn(auth, "isOwnLoginHandoff");
      const resolve = vi.spyOn(auth, "resolveLoginHandoff");
      const peek = vi.spyOn(handoffs, "peek");
      const redeem = vi.spyOn(handoffs, "redeem");
      const request = vi.spyOn(auth, "requestLoginOtp");
      const send = vi.spyOn(idp, "requestEmailLoginCode");
      const otp = vi.spyOn(auth, "otpStep");
      const verify = vi.spyOn(idp, "submitEmailCode");
      const terminate = vi.spyOn(idp, "terminateSession");
      const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const insert = vi.spyOn(records, "insert");
      const remove = vi.spyOn(records, "delete");
      const noWork = [
        vi.spyOn(auth, "passwordStep"),
        vi.spyOn(auth, "verifyStep"),
        vi.spyOn(idp, "findUserByEmail"),
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(idp, "requestSmsOtp"),
        vi.spyOn(hostIdp, "finaliseWithError"),
        vi.spyOn(records, "deleteBySubject"),
        vi.spyOn(records, "touchFinalised"),
      ];
      const spies = [
        own,
        resolve,
        peek,
        redeem,
        request,
        send,
        otp,
        verify,
        terminate,
        lifetime,
        finalise,
        insert,
        remove,
        ...noWork,
      ];
      const finalisedBefore = hostIdp.finalised.length;
      try {
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "render",
          storefront: "academy",
          door: "login",
          authRequest,
          csrf: expect.any(String),
          intent: { method: "code", handoff: true },
        });
        if (body.action !== "render") throw new Error("not rendered");
        const formId = jar.values.get(FORM_COOKIE_NAME)!;
        const binding = {
          csrfToken: body.csrf,
          storefront: "academy",
          authRequestId: authRequest,
          intent: {
            door: "login",
            method: "code",
            handoff: ref,
            clientId: ACADEMY,
          },
        };
        expect(await state.getForm(formId)).toEqual(binding);
        expect(res.cookies.map((cookie) => cookie.name)).toEqual([
          FORM_COOKIE_NAME,
        ]);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(address)).toEqual(before);
        const projection = JSON.stringify({ body, headers: res.headers });
        for (const secret of [
          ref,
          hint,
          address,
          reference!.accountId,
          oldCookie,
          otherCookie,
          oldRecord!.session.sub,
          oldRecord!.session.zitadelSessionId,
          oldRecord!.session.sessionToken,
          otherRecord!.session.zitadelSessionId,
          otherRecord!.session.sessionToken,
        ])
          expect(projection).not.toContain(secret);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect(hostIdp.finalised).toHaveLength(finalisedBefore);

        const fields = { authRequest, csrf: body.csrf };
        const sent = await post(jar, "login/otp/handoff", fields);
        expect(sent.statusCode).toBe(200);
        expect(sent.json()).toEqual({
          status: "otp_sent",
          identifier: address,
        });
        expect(sent.cookies).toEqual([]);
        expect(resolve).toHaveBeenCalledExactlyOnceWith(ref, undefined);
        expect(redeem).toHaveBeenCalledExactlyOnceWith(ref);
        expect(request).toHaveBeenCalledExactlyOnceWith(
          { identifier: address, channel: "email" },
          expect.objectContaining({ ip: "127.0.0.1" }),
        );
        expect(send).toHaveBeenCalledExactlyOnceWith(address);
        expect(await send.mock.results[0]!.value).toBe("challenge");
        expect(await state.getForm(formId)).toEqual(binding);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(address)).toEqual(before);
        for (const spy of [
          peek,
          otp,
          verify,
          terminate,
          lifetime,
          finalise,
          insert,
          remove,
          ...noWork,
        ])
          expect(spy).not.toHaveBeenCalled();

        const accepted = await post(jar, "login/otp", {
          identifier: address,
          channel: "email",
          code: FAKE_VALID_CODE,
          ...fields,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(otp).toHaveBeenCalledExactlyOnceWith(
          { identifier: address, channel: "email", code: FAKE_VALID_CODE },
          expect.any(Function),
        );
        expect(verify).toHaveBeenCalledExactlyOnceWith(
          address,
          FAKE_VALID_CODE,
          undefined,
        );
        expect(await verify.mock.results[0]!.value).toMatchObject({
          sub: oldRecord!.session.sub,
          verifiedNow: false,
        });
        const freshCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(freshCookie).toBeTruthy();
        expect([oldCookie, otherCookie]).not.toContain(freshCookie);
        const fresh = await records.find(freshCookie);
        expect(fresh?.session.sub).toBe(oldRecord!.session.sub);
        expect(fresh!.session.zitadelSessionId).not.toBe(
          oldRecord!.session.zitadelSessionId,
        );
        expect(fresh!.session.zitadelSessionId).not.toBe(
          otherRecord!.session.zitadelSessionId,
        );
        expect(await records.find(oldCookie)).toBeNull();
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(address)).toHaveLength(2);
        expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
        expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledWith(
          expect.objectContaining({ sub: oldRecord!.session.sub }),
          SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
        );
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          authRequest,
          fresh!.session,
        );
        expect(hostIdp.finalised.slice(finalisedBefore)).toEqual([
          { id: authRequest, session: fresh!.session },
        ]);
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formId);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
        expect(own).toHaveBeenCalledExactlyOnceWith(ref, undefined);
        expect(peek).not.toHaveBeenCalled();
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

        const nextRequest = hostIdp.seedAuthRequest({
          clientId: ACADEMY,
          prompt: ["none"],
        });
        const reused = await entry(other, nextRequest);
        expect(reused.res.statusCode).toBe(200);
        expect(reused.body).toEqual({
          action: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(reused.res.cookies).toEqual([]);
        expect(finalise).toHaveBeenCalledTimes(2);
        expect(finalise).toHaveBeenLastCalledWith(
          nextRequest,
          otherRecord!.session,
        );
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(verify).toHaveBeenCalledTimes(1);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it("EARS-44: S172 a live foreign handoff preserves the colleague until the same bound form accepts the participant code", async () => {
      const holder = await account("s172-live-colleague");
      const address = await account("s172-live-participant");
      recordNow = new Date();
      const jar = new Jar();
      const other = new Jar();
      await signIn(jar, holder);
      await signIn(other, holder);
      const records = app.get(SignInHostRecordStore);
      const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
      const oldRecord = await records.find(oldCookie);
      const otherRecord = await records.find(otherCookie);
      expect(oldRecord).not.toBeNull();
      expect(otherRecord).not.toBeNull();
      expect(otherCookie).not.toBe(oldCookie);
      expect(otherRecord!.session.sub).toBe(oldRecord!.session.sub);
      expect(otherRecord!.session.zitadelSessionId).not.toBe(
        oldRecord!.session.zitadelSessionId,
      );
      const before = await recordRows(holder);
      expect(before).toHaveLength(2);
      const ref = await mint(address);
      const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
      const reference = await handoffs.peek(ref);
      expect(reference).toEqual({
        accountId: expect.any(String),
        identifier: address,
      });
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const hint = await handoffIntent(ref, ACADEMY);
      const authRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        loginHint: hint,
      });
      const auth = app.get(AuthService);
      const own = vi.spyOn(auth, "isOwnLoginHandoff");
      const resolve = vi.spyOn(auth, "resolveLoginHandoff");
      const peek = vi.spyOn(handoffs, "peek");
      const redeem = vi.spyOn(handoffs, "redeem");
      const request = vi.spyOn(auth, "requestLoginOtp");
      const send = vi.spyOn(idp, "requestEmailLoginCode");
      const otp = vi.spyOn(auth, "otpStep");
      const verify = vi.spyOn(idp, "submitEmailCode");
      const terminate = vi.spyOn(idp, "terminateSession");
      const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const insert = vi.spyOn(records, "insert");
      const remove = vi.spyOn(records, "delete");
      const noWork = [
        vi.spyOn(auth, "passwordStep"),
        vi.spyOn(auth, "verifyStep"),
        vi.spyOn(idp, "findUserByEmail"),
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(idp, "requestSmsOtp"),
        vi.spyOn(hostIdp, "finaliseWithError"),
        vi.spyOn(records, "deleteBySubject"),
        vi.spyOn(records, "touchFinalised"),
      ];
      const spies = [
        own,
        resolve,
        peek,
        redeem,
        request,
        send,
        otp,
        verify,
        terminate,
        lifetime,
        finalise,
        insert,
        remove,
        ...noWork,
      ];
      const finalisedBefore = hostIdp.finalised.length;
      try {
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "render",
          storefront: "academy",
          door: "login",
          authRequest,
          csrf: expect.any(String),
          intent: { method: "code", handoff: true },
        });
        if (body.action !== "render") throw new Error("not rendered");
        const formId = jar.values.get(FORM_COOKIE_NAME)!;
        const binding = {
          csrfToken: body.csrf,
          storefront: "academy",
          authRequestId: authRequest,
          intent: {
            door: "login",
            method: "code",
            handoff: ref,
            clientId: ACADEMY,
          },
        };
        expect(await state.getForm(formId)).toEqual(binding);
        expect(res.cookies.map((cookie) => cookie.name)).toEqual([
          FORM_COOKIE_NAME,
        ]);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toEqual(before);
        expect(await recordRows(address)).toEqual([]);
        const projection = JSON.stringify({ body, headers: res.headers });
        for (const secret of [
          ref,
          hint,
          address,
          holder,
          reference!.accountId,
          oldCookie,
          otherCookie,
          oldRecord!.session.sub,
          oldRecord!.session.zitadelSessionId,
          oldRecord!.session.sessionToken,
          otherRecord!.session.zitadelSessionId,
          otherRecord!.session.sessionToken,
        ])
          expect(projection).not.toContain(secret);
        expect(own).toHaveBeenCalledExactlyOnceWith(
          ref,
          oldRecord!.session.sub,
        );
        expect(await own.mock.results[0]!.value).toBe(false);
        expect(peek).toHaveBeenCalledExactlyOnceWith(ref);
        expect(await peek.mock.results[0]!.value).toEqual(reference);
        for (const spy of spies.filter((spy) => spy !== own && spy !== peek))
          expect(spy).not.toHaveBeenCalled();
        expect(hostIdp.finalised).toHaveLength(finalisedBefore);

        const fields = { authRequest, csrf: body.csrf };
        const sent = await post(jar, "login/otp/handoff", {
          ...fields,
          identifier: holder,
        });
        expect(sent.statusCode).toBe(200);
        expect(sent.json()).toEqual({
          status: "otp_sent",
          identifier: address,
        });
        expect(sent.cookies).toEqual([]);
        expect(resolve).toHaveBeenCalledExactlyOnceWith(ref, undefined);
        expect(redeem).toHaveBeenCalledExactlyOnceWith(ref);
        expect(await redeem.mock.results[0]!.value).toEqual(reference);
        expect(await resolve.mock.results[0]!.value).toEqual({
          kind: "send",
          identifier: address,
        });
        expect(request).toHaveBeenCalledExactlyOnceWith(
          { identifier: address, channel: "email" },
          expect.objectContaining({ ip: "127.0.0.1" }),
        );
        expect(send).toHaveBeenCalledExactlyOnceWith(address);
        expect(await send.mock.results[0]!.value).toBe("challenge");
        expect(await state.getForm(formId)).toEqual(binding);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toEqual(before);
        expect(await recordRows(address)).toEqual([]);
        for (const spy of [
          otp,
          verify,
          terminate,
          lifetime,
          finalise,
          insert,
          remove,
          ...noWork,
        ])
          expect(spy).not.toHaveBeenCalled();

        const cookies = [...jar.values];
        const requestBefore = await hostIdp.readAuthRequest(authRequest);
        const lifetimesBefore = [...hostIdp.lifetimes];
        const wrong = await post(jar, "login/otp", {
          identifier: address,
          channel: "email",
          code: "000000",
          ...fields,
        });
        expect(wrong.statusCode).toBe(401);
        expect(wrong.json()).toMatchObject({
          message: "invalid credentials",
        });
        expect(wrong.cookies).toEqual([]);
        expect(otp).toHaveBeenCalledExactlyOnceWith(
          { identifier: address, channel: "email", code: "000000" },
          expect.any(Function),
        );
        expect(verify).toHaveBeenCalledExactlyOnceWith(
          address,
          "000000",
          undefined,
        );
        expect(await verify.mock.results[0]!.value).toBeNull();
        expect([...jar.values]).toEqual(cookies);
        expect(await state.getForm(formId)).toEqual(binding);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toEqual(before);
        expect(await recordRows(address)).toEqual([]);
        expect(await hostIdp.readAuthRequest(authRequest)).toEqual(
          requestBefore,
        );
        expect(hostIdp.finalised).toHaveLength(finalisedBefore);
        expect(hostIdp.lifetimes).toEqual(lifetimesBefore);
        for (const spy of [
          terminate,
          lifetime,
          finalise,
          insert,
          remove,
          ...noWork,
        ])
          expect(spy).not.toHaveBeenCalled();

        const accepted = await post(jar, "login/otp", {
          identifier: address,
          channel: "email",
          code: FAKE_VALID_CODE,
          ...fields,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(otp).toHaveBeenCalledTimes(2);
        expect(otp).toHaveBeenNthCalledWith(
          2,
          { identifier: address, channel: "email", code: FAKE_VALID_CODE },
          expect.any(Function),
        );
        expect(verify).toHaveBeenCalledTimes(2);
        expect(verify).toHaveBeenNthCalledWith(
          2,
          address,
          FAKE_VALID_CODE,
          undefined,
        );
        const checked = await verify.mock.results[1]!.value;
        expect(checked).toMatchObject({
          sub: expect.any(String),
          verifiedNow: false,
        });
        const freshCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(freshCookie).toBeTruthy();
        expect([oldCookie, otherCookie]).not.toContain(freshCookie);
        const fresh = await records.find(freshCookie);
        expect(fresh?.session.sub).toBe(checked!.sub);
        const participant = await pool.query<{ zitadel_sub: string }>(
          "SELECT zitadel_sub FROM users WHERE id = $1",
          [reference!.accountId],
        );
        expect(checked!.sub).toBe(participant.rows[0]!.zitadel_sub);
        expect(fresh?.session.sub).not.toBe(oldRecord!.session.sub);
        expect(fresh!.session.zitadelSessionId).not.toBe(
          oldRecord!.session.zitadelSessionId,
        );
        expect(fresh!.session.zitadelSessionId).not.toBe(
          otherRecord!.session.zitadelSessionId,
        );
        expect(await records.find(oldCookie)).toBeNull();
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toHaveLength(1);
        expect(await recordRows(address)).toHaveLength(1);
        expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
        expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledWith(
          fresh!.session,
          SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
        );
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          authRequest,
          fresh!.session,
        );
        expect(hostIdp.finalised.slice(finalisedBefore)).toEqual([
          { id: authRequest, session: fresh!.session },
        ]);
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formId);
        expect(await state.getForm(formId)).toEqual(binding);
        expect(await hostIdp.readAuthRequest(authRequest)).toBeNull();
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
        expect(own).toHaveBeenCalledTimes(2);
        expect(own).toHaveBeenLastCalledWith(ref, undefined);
        expect(peek).toHaveBeenCalledTimes(1);
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

        const nextRequest = hostIdp.seedAuthRequest({
          clientId: ACADEMY,
          prompt: ["none"],
        });
        const reused = await entry(other, nextRequest);
        expect(reused.res.statusCode).toBe(200);
        expect(reused.body).toEqual({
          action: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(reused.res.cookies).toEqual([]);
        expect(finalise).toHaveBeenCalledTimes(2);
        expect(finalise).toHaveBeenLastCalledWith(
          nextRequest,
          otherRecord!.session,
        );
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(redeem).toHaveBeenCalledTimes(1);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
        expect(verify).toHaveBeenCalledTimes(2);
      } finally {
        for (const spy of spies) spy.mockRestore();
        await state.deleteForm(jar.values.get(FORM_COOKIE_NAME)!);
      }
    });

    it("EARS-44: another account's reference never uses the live record — the code form renders", async () => {
      const holder = await account("handoff-holder");
      const owner = await account("handoff-owner");
      const jar = new Jar();
      await signIn(jar, holder);
      const authRequest = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        loginHint: await handoffIntent(await mint(owner)),
      });
      const { body } = await entry(jar, authRequest);
      expect(body.action).toBe("render");
      expect(body.action === "render" && body.intent?.handoff).toBe(true);
      // A refused (unknown) reference does not use it either.
      const refused = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        loginHint: await handoffIntent("unknown-reference"),
      });
      expect((await entry(jar, refused)).body.action).toBe("render");
    });
  });

  it.each([
    [ACADEMY, "academy"],
    [DOCTOR, "doctor"],
  ] as const)(
    "EARS-44/64: S174 an exactly expired hand-off on %s cannot use a colleague's record, and the participant's code replaces only that record",
    async (clientId, storefront) => {
      const holder = await account("s174-holder");
      const participant = await account("s174-participant");
      const baseNow = Date.now();
      handoffNow = baseNow;
      recordNow = new Date(baseNow);
      const jar = new Jar();
      const unaffectedJar = new Jar();
      await signIn(jar, holder, clientId);
      await signIn(unaffectedJar, holder, clientId);

      const records = app.get(SignInHostRecordStore);
      const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      const unaffectedCookie = unaffectedJar.values.get(RECORD_COOKIE_NAME)!;
      const oldRecord = await records.find(oldCookie);
      const unaffectedRecord = await records.find(unaffectedCookie);
      expect(oldRecord).not.toBeNull();
      expect(unaffectedRecord).not.toBeNull();
      expect(oldCookie).not.toBe(unaffectedCookie);
      const { rows } = await pool.query<{ id: string; zitadel_sub: string }>(
        "SELECT id, zitadel_sub FROM users WHERE email = $1",
        [participant],
      );
      const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
      const ref = await handoffs.mint(rows[0]!.id, participant);
      expect(await handoffs.peek(ref)).toEqual({
        accountId: rows[0]!.id,
        identifier: participant,
      });

      handoffNow = baseNow + LOGIN_HANDOFF_TTL_SECONDS * 1000;
      recordNow = new Date(handoffNow);
      const intent = await app
        .get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE)
        .putIntent(
          { door: "login", method: "code", handoff: ref, clientId },
          600,
        );
      const authRequest = hostIdp.seedAuthRequest({
        clientId,
        loginHint: intent,
      });
      const auth = app.get(AuthService);
      const noSend = vi.spyOn(auth, "requestLoginOtp");
      const noEmail = vi.spyOn(idp, "requestEmailLoginCode");
      const noSms = vi.spyOn(idp, "requestSmsOtp");
      const peek = vi.spyOn(handoffs, "peek");
      const redeem = vi.spyOn(handoffs, "redeem");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
      const terminate = vi.spyOn(idp, "terminateSession");
      const otp = vi.spyOn(auth, "otpStep");
      const spies = [
        noSend,
        noEmail,
        noSms,
        peek,
        redeem,
        finalise,
        finaliseError,
        terminate,
        otp,
      ];
      try {
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "render",
          storefront,
          door: "login",
          authRequest,
          csrf: expect.any(String),
          intent: { method: "code", handoff: true },
        });
        expect(peek).toHaveBeenCalledWith(ref);
        expect(redeem).not.toHaveBeenCalled();
        expect(finalise).not.toHaveBeenCalled();
        expect(finaliseError).not.toHaveBeenCalled();
        expect(terminate).not.toHaveBeenCalled();
        expect(otp).not.toHaveBeenCalled();
        expect(noSend).not.toHaveBeenCalled();
        expect(noEmail).not.toHaveBeenCalled();
        expect(noSms).not.toHaveBeenCalled();
        expect(res.cookies.map((c) => c.name)).toEqual([FORM_COOKIE_NAME]);
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(unaffectedCookie)).toEqual(unaffectedRecord);
        expect(JSON.stringify(body)).not.toContain(ref);
        expect(JSON.stringify(body)).not.toContain(holder);
        if (body.action !== "render") throw new Error("not rendered");
        const fields = { authRequest, csrf: body.csrf };

        const refused = await post(jar, "login/otp/handoff", fields);
        expect(refused.statusCode).toBe(200);
        expect(refused.json()).toEqual({ status: "handoff_refused" });
        expect(redeem).toHaveBeenCalledWith(ref);
        expect(noSend).not.toHaveBeenCalled();
        expect(noEmail).not.toHaveBeenCalled();
        expect(noSms).not.toHaveBeenCalled();
        expect(finalise).not.toHaveBeenCalled();
        expect(terminate).not.toHaveBeenCalled();

        const requested = await post(jar, "login/otp/request", {
          identifier: participant,
          channel: "email",
          ...fields,
        });
        expect(requested.statusCode).toBe(200);
        expect(noSend).toHaveBeenCalledTimes(1);
        expect(noSend).toHaveBeenCalledWith(
          { identifier: participant, channel: "email" },
          expect.objectContaining({ ip: "127.0.0.1" }),
        );
        expect(noEmail).toHaveBeenCalledTimes(1);
        expect(noSms).not.toHaveBeenCalled();
        expect(finalise).not.toHaveBeenCalled();

        const accepted = await post(jar, "login/otp", {
          identifier: participant,
          code: FAKE_VALID_CODE,
          channel: "email",
          ...fields,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toMatchObject({ status: "redirect" });
        expect(accepted.cookies.map((c) => c.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(accepted.cookies.map((c) => c.name)).not.toContain(
          SESSION_COOKIE_NAME,
        );
        const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(newCookie).toBeTruthy();
        expect(newCookie).not.toBe(oldCookie);
        const participantRecord = await records.find(newCookie);
        expect(participantRecord?.session.sub).toBe(rows[0]!.zitadel_sub);
        expect(await records.find(oldCookie)).toBeNull();
        expect(await records.find(unaffectedCookie)).toEqual(unaffectedRecord);
        expect(await recordRows(holder)).toHaveLength(1);
        expect(await recordRows(participant)).toHaveLength(1);
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(terminate).toHaveBeenCalledWith(oldRecord!.session);
        expect(finalise).toHaveBeenCalledTimes(1);
        expect(finalise).toHaveBeenCalledWith(
          authRequest,
          participantRecord!.session,
        );
        expect(finaliseError).not.toHaveBeenCalled();
        expect(otp).toHaveBeenCalledTimes(1);
        expect(otp).toHaveBeenCalledWith(
          { identifier: participant, channel: "email", code: FAKE_VALID_CODE },
          expect.any(Function),
        );
        expect(JSON.stringify(accepted.json())).not.toContain(ref);

        const unaffectedRequest = hostIdp.seedAuthRequest({ clientId });
        expect(
          (await entry(unaffectedJar, unaffectedRequest)).body.action,
        ).toBe("redirect");
        expect(finalise).toHaveBeenLastCalledWith(
          unaffectedRequest,
          unaffectedRecord!.session,
        );
        expect(noSend).toHaveBeenCalledTimes(1);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    },
  );

  it.each(["unknown", "malformed"] as const)(
    "EARS-44: S174 a %s handoff preserves the colleague record and bound form until ordinary code recovery",
    async (kind) => {
      const holder = await account(`s174-${kind}-holder`);
      const participant = await account(`s174-${kind}-participant`);
      recordNow = new Date();
      const jar = new Jar();
      const other = new Jar();
      await signIn(jar, holder);
      await signIn(other, holder);
      const records = app.get(SignInHostRecordStore);
      const oldCookie = jar.values.get(RECORD_COOKIE_NAME)!;
      const otherCookie = other.values.get(RECORD_COOKIE_NAME)!;
      const oldRecord = await records.find(oldCookie);
      const otherRecord = await records.find(otherCookie);
      expect(oldRecord).not.toBeNull();
      expect(otherRecord).not.toBeNull();
      expect(otherCookie).not.toBe(oldCookie);
      const before = await recordRows(holder);
      expect(before).toHaveLength(2);
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [participant],
      );
      const handoffs = app.get<InMemoryLoginHandoffStore>(LOGIN_HANDOFF_STORE);
      const keys = handoffs.storedKeys();
      const ref =
        kind === "unknown"
          ? randomBytes(32).toString("base64url")
          : "malformed-s174!";
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      const intent = {
        door: "login" as const,
        method: "code" as const,
        handoff: ref,
        clientId: ACADEMY,
      };
      const hint = await state.putIntent(intent, 600);
      const authRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        loginHint: hint,
      });
      const auth = app.get(AuthService);
      const peek = vi.spyOn(handoffs, "peek");
      const redeem = vi.spyOn(handoffs, "redeem");
      const resolve = vi.spyOn(auth, "resolveLoginHandoff");
      const request = vi.spyOn(auth, "requestLoginOtp");
      const send = vi.spyOn(idp, "requestEmailLoginCode");
      const otp = vi.spyOn(auth, "otpStep");
      const verify = vi.spyOn(idp, "submitEmailCode");
      const remove = vi.spyOn(records, "delete");
      const insert = vi.spyOn(records, "insert");
      const terminate = vi.spyOn(idp, "terminateSession");
      const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const noWork = [
        vi.spyOn(auth, "passwordStep"),
        vi.spyOn(auth, "verifyStep"),
        vi.spyOn(idp, "passwordLogin"),
        vi.spyOn(idp, "loginWithEmailOtp"),
        vi.spyOn(idp, "loginWithSmsOtp"),
        vi.spyOn(idp, "requestSmsOtp"),
        vi.spyOn(records, "deleteBySubject"),
        vi.spyOn(records, "touchFinalised"),
        vi.spyOn(hostIdp, "finaliseWithError"),
      ];
      const spies = [
        peek,
        redeem,
        resolve,
        request,
        send,
        otp,
        verify,
        remove,
        insert,
        terminate,
        lifetime,
        finalise,
        ...noWork,
      ];
      const finalised = [...hostIdp.finalised];
      const lifetimes = [...hostIdp.lifetimes];
      try {
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "render",
          storefront: "academy",
          door: "login",
          authRequest,
          csrf: expect.any(String),
          intent: { method: "code", handoff: true },
        });
        if (body.action !== "render") throw new Error("not rendered");
        const formId = jar.values.get(FORM_COOKIE_NAME)!;
        const binding = {
          csrfToken: body.csrf,
          storefront: "academy",
          authRequestId: authRequest,
          intent,
        };
        expect(await state.getForm(formId)).toEqual(binding);
        expect(res.cookies.map((cookie) => cookie.name)).toEqual([
          FORM_COOKIE_NAME,
        ]);
        expect(peek).toHaveBeenCalledExactlyOnceWith(ref);
        expect(await peek.mock.results[0]!.value).toBeNull();
        for (const spy of spies.slice(1)) expect(spy).not.toHaveBeenCalled();
        const projection = JSON.stringify({ body, headers: res.headers });
        for (const secret of [
          ref,
          hint,
          holder,
          participant,
          oldCookie,
          otherCookie,
          oldRecord!.session.sub,
          oldRecord!.session.zitadelSessionId,
          oldRecord!.session.sessionToken,
        ])
          expect(projection).not.toContain(secret);
        const cookies = [...jar.values];
        expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(oldCookie);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        const fields = { authRequest, csrf: body.csrf };

        const refused = await post(jar, "login/otp/handoff", fields);
        expect(refused.statusCode).toBe(200);
        expect(refused.json()).toEqual({ status: "handoff_refused" });
        expect(refused.cookies).toEqual([]);
        expect(resolve).toHaveBeenCalledExactlyOnceWith(ref, undefined);
        expect(await resolve.mock.results[0]!.value).toBeNull();
        expect(redeem).toHaveBeenCalledExactlyOnceWith(ref);
        expect(await redeem.mock.results[0]!.value).toBeNull();
        expect(peek).toHaveBeenCalledTimes(1);
        for (const spy of spies.slice(3)) expect(spy).not.toHaveBeenCalled();
        expect([...jar.values]).toEqual(cookies);
        expect(await state.getForm(formId)).toEqual(binding);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toEqual(before);
        expect(await recordRows(participant)).toEqual([]);
        expect(handoffs.storedKeys()).toEqual(keys);
        expect(hostIdp.finalised).toEqual(finalised);
        expect(hostIdp.lifetimes).toEqual(lifetimes);

        const requested = await post(jar, "login/otp/request", {
          identifier: participant,
          channel: "email",
          ...fields,
        });
        expect(requested.statusCode).toBe(200);
        expect(requested.json()).toEqual({ status: "otp_sent" });
        expect(requested.cookies).toEqual([]);
        expect(request).toHaveBeenCalledExactlyOnceWith(
          { identifier: participant, channel: "email" },
          expect.objectContaining({ ip: "127.0.0.1" }),
        );
        expect(send).toHaveBeenCalledExactlyOnceWith(participant);
        expect(await send.mock.results[0]!.value).toBe("challenge");
        for (const spy of spies.slice(5)) expect(spy).not.toHaveBeenCalled();
        expect([...jar.values]).toEqual(cookies);
        expect(await state.getForm(formId)).toEqual(binding);
        expect(await records.find(oldCookie)).toEqual(oldRecord);
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toEqual(before);
        expect(hostIdp.finalised).toEqual(finalised);
        expect(hostIdp.lifetimes).toEqual(lifetimes);

        const accepted = await post(jar, "login/otp", {
          identifier: participant,
          channel: "email",
          code: FAKE_VALID_CODE,
          ...fields,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(otp).toHaveBeenCalledExactlyOnceWith(
          { identifier: participant, channel: "email", code: FAKE_VALID_CODE },
          expect.any(Function),
        );
        expect(verify).toHaveBeenCalledExactlyOnceWith(
          participant,
          FAKE_VALID_CODE,
          undefined,
        );
        const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(newCookie).toBeTruthy();
        expect([oldCookie, otherCookie]).not.toContain(newCookie);
        const fresh = await records.find(newCookie);
        expect(fresh?.session.sub).toBe(rows[0]!.zitadel_sub);
        expect(fresh?.session.sub).not.toBe(oldRecord!.session.sub);
        expect(await records.find(oldCookie)).toBeNull();
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(await recordRows(holder)).toHaveLength(1);
        expect(await recordRows(participant)).toHaveLength(1);
        expect(remove).toHaveBeenCalledExactlyOnceWith(oldCookie);
        expect(terminate).toHaveBeenCalledExactlyOnceWith(oldRecord!.session);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          authRequest,
          fresh!.session,
        );
        expect(hostIdp.finalised).toEqual([
          ...finalised,
          { id: authRequest, session: fresh!.session },
        ]);
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formId);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

        const nextRequest = hostIdp.seedAuthRequest({
          clientId: ACADEMY,
          prompt: ["none"],
        });
        const reused = await entry(other, nextRequest);
        expect(reused.res.statusCode).toBe(200);
        expect(reused.body).toEqual({
          action: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(reused.res.cookies).toEqual([]);
        expect(finalise).toHaveBeenCalledTimes(2);
        expect(finalise).toHaveBeenLastCalledWith(
          nextRequest,
          otherRecord!.session,
        );
        expect(await records.find(otherCookie)).toEqual(otherRecord);
        expect(other.values.get(RECORD_COOKIE_NAME)).toBe(otherCookie);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(terminate).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(verify).toHaveBeenCalledTimes(1);
        expect(redeem).toHaveBeenCalledTimes(1);
        expect(handoffs.storedKeys()).toEqual(keys);
      } finally {
        for (const spy of spies) spy.mockRestore();
        await state.deleteForm(jar.values.get(FORM_COOKIE_NAME)!);
      }
    },
  );

  it("EARS-24/71: A001 a registration event intent renders once over a live record and reopens as a plain registration form", async () => {
    const address = await account("a001-event-context");
    const jar = new Jar();
    await signIn(jar, address);
    const records = app.get(SignInHostRecordStore);
    const recordId = jar.values.get(RECORD_COOKIE_NAME)!;
    const before = await records.find(recordId);
    expect(before).not.toBeNull();
    const previousForm = jar.values.get(FORM_COOKIE_NAME)!;
    const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
    const previousBinding = await state.getForm(previousForm);
    const eventTarget = "a001-registration-event";
    const intent = {
      door: "register" as const,
      eventTarget,
      clientId: ACADEMY,
    };
    const hint = await state.putIntent(intent, 600);
    const authRequest = hostIdp.seedAuthRequest({
      clientId: ACADEMY,
      prompt: ["create"],
      loginHint: hint,
    });
    const auth = app.get(AuthService);
    const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
    const noWork = [
      vi.spyOn(auth, "register"),
      vi.spyOn(auth, "passwordStep"),
      vi.spyOn(auth, "otpStep"),
      vi.spyOn(auth, "verifyStep"),
      vi.spyOn(auth, "requestLoginOtp"),
      vi.spyOn(auth, "resendEmailVerification"),
      vi.spyOn(auth, "isOwnLoginHandoff"),
      vi.spyOn(auth, "resolveLoginHandoff"),
      vi.spyOn(handoffs, "peek"),
      vi.spyOn(handoffs, "redeem"),
      vi.spyOn(idp, "findUserByEmail"),
      vi.spyOn(idp, "passwordLogin"),
      vi.spyOn(idp, "submitEmailCode"),
      vi.spyOn(idp, "requestEmailLoginCode"),
      vi.spyOn(idp, "requestSmsOtp"),
      vi.spyOn(idp, "terminateSession"),
      vi.spyOn(hostIdp, "setSessionLifetime"),
      vi.spyOn(hostIdp, "finaliseWithSession"),
      vi.spyOn(hostIdp, "finaliseWithError"),
    ];
    try {
      const first = await entry(jar, authRequest);
      expect(first.res.statusCode).toBe(200);
      expect(first.body).toEqual({
        action: "render",
        storefront: "academy",
        door: "register",
        authRequest,
        csrf: expect.any(String),
        intent: { eventTarget, handoff: false },
      });
      if (first.body.action !== "render") throw new Error("not rendered");
      const firstForm = jar.values.get(FORM_COOKIE_NAME)!;
      expect(firstForm).toBeTruthy();
      expect(firstForm).not.toBe(previousForm);
      expect(first.body.csrf).not.toBe(previousBinding?.csrfToken);
      expect(await state.getForm(previousForm)).toBeNull();
      expect(await state.getForm(firstForm)).toEqual({
        csrfToken: first.body.csrf,
        storefront: "academy",
        authRequestId: authRequest,
        intent,
      });
      expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(recordId);
      expect(await records.find(recordId)).toEqual(before);
      for (const spy of noWork) expect(spy).not.toHaveBeenCalled();

      const reopened = await entry(jar, authRequest);
      expect(reopened.res.statusCode).toBe(200);
      expect(reopened.body).toEqual({
        action: "render",
        storefront: "academy",
        door: "register",
        authRequest,
        csrf: expect.any(String),
      });
      if (reopened.body.action !== "render") throw new Error("not rendered");
      const nextForm = jar.values.get(FORM_COOKIE_NAME)!;
      expect(nextForm).toBeTruthy();
      expect(nextForm).not.toBe(firstForm);
      expect(reopened.body.csrf).not.toBe(first.body.csrf);
      expect(await state.getForm(firstForm)).toBeNull();
      expect(await state.getForm(nextForm)).toEqual({
        csrfToken: reopened.body.csrf,
        storefront: "academy",
        authRequestId: authRequest,
      });
      expect(await state.takeIntent(hint)).toBeNull();
      for (const { res } of [first, reopened]) {
        expect(res.cookies.map((cookie) => cookie.name)).toEqual([
          FORM_COOKIE_NAME,
        ]);
        const projection = JSON.stringify({
          body: res.json(),
          headers: res.headers,
        });
        for (const secret of [
          hint,
          address,
          recordId,
          before!.session.sub,
          before!.session.zitadelSessionId,
          before!.session.sessionToken,
        ])
          expect(projection).not.toContain(secret);
      }
      expect(jar.values.get(RECORD_COOKIE_NAME)).toBe(recordId);
      expect(await records.find(recordId)).toEqual(before);
      expect(await recordRows(address)).toHaveLength(1);
      for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of noWork) spy.mockRestore();
    }
  });

  it("EARS-71: S176 denied clients preserve a legitimate Academy login event intent for its rightful request", async () => {
    const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
    const intent = {
      door: "login" as const,
      method: "code" as const,
      eventTarget: "s176-login-event",
      clientId: ACADEMY,
    };
    const hint = await state.putIntent(intent, 600);
    const jar = new Jar();
    const auth = app.get(AuthService);
    const db = app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
    const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
    const take = vi.spyOn(state, "takeIntent");
    const putForm = vi.spyOn(state, "putForm");
    const denied = vi.spyOn(hostIdp, "finaliseWithError");
    const noWork = [
      vi.spyOn(db, "select"),
      vi.spyOn(auth, "passwordStep"),
      vi.spyOn(auth, "otpStep"),
      vi.spyOn(auth, "verifyStep"),
      vi.spyOn(auth, "requestLoginOtp"),
      vi.spyOn(auth, "isOwnLoginHandoff"),
      vi.spyOn(auth, "resolveLoginHandoff"),
      vi.spyOn(handoffs, "peek"),
      vi.spyOn(handoffs, "redeem"),
      vi.spyOn(idp, "findUserByEmail"),
      vi.spyOn(idp, "passwordLogin"),
      vi.spyOn(idp, "submitEmailCode"),
      vi.spyOn(idp, "loginWithEmailOtp"),
      vi.spyOn(idp, "loginWithSmsOtp"),
      vi.spyOn(idp, "requestEmailLoginCode"),
      vi.spyOn(idp, "requestSmsOtp"),
      vi.spyOn(idp, "terminateSession"),
      vi.spyOn(hostIdp, "setSessionLifetime"),
      vi.spyOn(hostIdp, "finaliseWithSession"),
      vi.spyOn(app.get(SignInHostRecordStore), "insert"),
    ];
    const finalised = [...hostIdp.finalised];
    const refusedRequests: string[] = [];
    let rightfulRequest: string | undefined;
    try {
      for (const clientId of [
        process.env.IDP_CLIENT_ID || "admin-client-e2e",
        "unmapped-client-s176",
      ]) {
        const authRequest = hostIdp.seedAuthRequest({
          clientId,
          loginHint: hint,
        });
        refusedRequests.push(authRequest);
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "redirect",
          url: expect.stringContaining("error=access_denied"),
        });
        expect(denied).toHaveBeenLastCalledWith(authRequest, "access_denied");
        expect(await denied.mock.results.at(-1)!.value).toBe(
          body.action === "redirect" && body.url,
        );
        expect(hostIdp.finalised).toEqual([
          ...finalised,
          ...refusedRequests.map((id) => ({ id, error: "access_denied" })),
        ]);
        expect(res.cookies).toEqual([]);
        expect([...jar.values]).toEqual([]);
        expect(take).not.toHaveBeenCalled();
        expect(putForm).not.toHaveBeenCalled();
        expect(JSON.stringify({ body, headers: res.headers })).not.toContain(
          hint,
        );
        for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
      }
      expect(denied).toHaveBeenCalledTimes(2);

      rightfulRequest = hostIdp.seedAuthRequest({
        clientId: ACADEMY,
        loginHint: hint,
      });
      const { res, body } = await entry(jar, rightfulRequest);
      expect(res.statusCode).toBe(200);
      expect(body).toEqual({
        action: "render",
        storefront: "academy",
        door: "login",
        authRequest: rightfulRequest,
        csrf: expect.any(String),
        intent: {
          method: "code",
          eventTarget: intent.eventTarget,
          handoff: false,
        },
      });
      if (body.action !== "render") throw new Error("not rendered");
      expect(take).toHaveBeenCalledExactlyOnceWith(hint);
      expect(await take.mock.results[0]!.value).toEqual(intent);
      expect(denied.mock.invocationCallOrder[1]).toBeLessThan(
        take.mock.invocationCallOrder[0]!,
      );
      const formId = jar.values.get(FORM_COOKIE_NAME)!;
      expect(formId).toBeTruthy();
      const binding = {
        csrfToken: body.csrf,
        storefront: "academy",
        authRequestId: rightfulRequest,
        intent,
      };
      expect(putForm).toHaveBeenCalledExactlyOnceWith(
        formId,
        binding,
        FORM_STATE_TTL_SECONDS,
      );
      expect(await state.getForm(formId)).toEqual(binding);
      expect(res.cookies.map((cookie) => cookie.name)).toEqual([
        FORM_COOKIE_NAME,
      ]);
      expect([...jar.values.keys()]).toEqual([FORM_COOKIE_NAME]);
      const projection = JSON.stringify({ body, headers: res.headers });
      for (const secret of [hint, ACADEMY, ...refusedRequests])
        expect(projection).not.toContain(secret);
      expect(denied).toHaveBeenCalledTimes(2);
      expect(hostIdp.finalised).toEqual([
        ...finalised,
        ...refusedRequests.map((id) => ({ id, error: "access_denied" })),
      ]);
      for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of [take, putForm, denied, ...noWork]) spy.mockRestore();
      const formId = jar.values.get(FORM_COOKIE_NAME);
      if (formId) await state.deleteForm(formId);
      for (const request of refusedRequests) hostIdp.expire(request);
      if (rightfulRequest) hostIdp.expire(rightfulRequest);
    }
  });

  describe("EARS-71: S175 unusable entry intents", () => {
    let intentApp: Awaited<ReturnType<typeof compile>>;
    let intentNow = Date.UTC(2026, 9, 23);
    const state = new InMemorySignInHostStateStore(
      Buffer.alloc(32, 17),
      () => intentNow,
    );

    beforeAll(async () => {
      intentApp = await compile(
        RELAXED_RATE_LIMIT,
        undefined,
        undefined,
        state,
      );
    });
    afterAll(async () => {
      await intentApp.app.close();
    });

    async function openIntent(
      clientId: string,
      door: "login" | "register",
      loginHint?: string,
    ) {
      const authRequest = intentApp.hostIdp.seedAuthRequest({
        clientId,
        prompt: door === "register" ? ["create"] : [],
        ...(loginHint === undefined ? {} : { loginHint }),
      });
      const res = await intentApp.app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
        headers: DEVICE,
      });
      return { res, authRequest };
    }

    for (const [clientId, storefront, foreignClient] of [
      [ACADEMY, "academy", DOCTOR],
      [DOCTOR, "doctor", ACADEMY],
    ] as const) {
      for (const door of ["login", "register"] as const) {
        for (const unusable of [
          "absent",
          "malformed",
          "unknown",
          "spent",
          "expired",
          "foreign-client",
        ] as const) {
          it(`EARS-71: S175 ${storefront} ${door} with an ${unusable} intent renders only the ordinary form and performs no identity or credential work`, async () => {
            const intent = {
              clientId:
                unusable === "foreign-client" ? foreignClient : clientId,
              door:
                door === "login" ? ("register" as const) : ("login" as const),
              method: "code" as const,
              eventTarget: "/webinars/s175-private-event",
              handoff: "s175-private-handoff",
            };
            let hint: string | undefined;
            if (unusable === "malformed") hint = "not-an-intent!";
            else if (unusable === "unknown")
              hint = randomBytes(32).toString("base64url");
            else if (unusable !== "absent") {
              hint = await state.putIntent(intent, 60);
              if (unusable === "spent") {
                const first = await openIntent(clientId, door, hint);
                expect(first.res.statusCode).toBe(200);
                expect(first.res.json()).toMatchObject({
                  action: "render",
                  door: intent.door,
                  intent: {
                    method: "code",
                    eventTarget: intent.eventTarget,
                    handoff: true,
                  },
                });
              }
              if (unusable === "expired") intentNow += 60_000;
            }

            const auth = intentApp.app.get(AuthService);
            const db = intentApp.app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
            const handoffs =
              intentApp.app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
            const noWork = [
              vi.spyOn(db, "select"),
              vi.spyOn(intentApp.idp, "findUserByEmail"),
              vi.spyOn(auth, "isOwnLoginHandoff"),
              vi.spyOn(auth, "resolveLoginHandoff"),
              vi.spyOn(handoffs, "peek"),
              vi.spyOn(handoffs, "redeem"),
              vi.spyOn(auth, "passwordStep"),
              vi.spyOn(auth, "otpStep"),
              vi.spyOn(auth, "requestLoginOtp"),
              vi.spyOn(intentApp.idp, "requestEmailLoginCode"),
              vi.spyOn(intentApp.idp, "requestSmsOtp"),
              vi.spyOn(intentApp.hostIdp, "finaliseWithSession"),
              vi.spyOn(intentApp.hostIdp, "finaliseWithError"),
            ];
            try {
              const assertPlain = async (
                targetClient = clientId,
                targetStorefront = storefront,
              ) => {
                const { res, authRequest } = await openIntent(
                  targetClient,
                  door,
                  hint,
                );
                expect(res.statusCode).toBe(200);
                expect(res.json()).toEqual({
                  action: "render",
                  storefront: targetStorefront,
                  door,
                  authRequest,
                  csrf: expect.any(String),
                });
                const cookie = res.cookies.find(
                  (c) => c.name === FORM_COOKIE_NAME,
                );
                expect(cookie?.value).toBeTruthy();
                expect(await state.getForm(cookie!.value)).toEqual({
                  csrfToken: res.json().csrf,
                  storefront: targetStorefront,
                  authRequestId: authRequest,
                });
                expect(res.cookies.map((c) => c.name)).toEqual([
                  FORM_COOKIE_NAME,
                ]);
              };
              await assertPlain();
              if (unusable === "foreign-client") {
                await assertPlain(
                  foreignClient,
                  storefront === "academy" ? "doctor" : "academy",
                );
              }
              for (const spy of noWork) expect(spy).not.toHaveBeenCalled();
            } finally {
              for (const spy of noWork) spy.mockRestore();
            }
          });
        }
      }
    }
  });

  describe("revoking every session of a subject ends its sign-in-host records", () => {
    it("EARS-12: a reset completed on a storefront deletes the host record and the next entry renders the form", async () => {
      const address = await account("reset-storefront");
      const jar = new Jar();
      await signIn(jar, address);
      const terminate = vi.spyOn(idp, "terminateSession");
      await storefrontResetComplete(address);
      expect(await recordRows(address)).toHaveLength(0);
      expect(terminate).toHaveBeenCalled();
      terminate.mockRestore();
      const { body } = await entry(
        jar,
        hostIdp.seedAuthRequest({ clientId: DOCTOR }),
      );
      expect(body.action).toBe("render");
    });

    it("EARS-12: a reset completed on the host leaves only the record it minted", async () => {
      const address = await account("reset-host");
      const elsewhere = new Jar();
      await signIn(elsewhere, address);
      const jar = new Jar();
      const form = await render(jar, ACADEMY);
      await requestReset(address);
      const res = await post(jar, "password/reset/complete", {
        identifier: address,
        code: FAKE_VALID_CODE,
        newPassword: "Cc3!yet-another-long-pw",
        authRequest: form.authRequest,
        csrf: form.csrf,
      });
      expect(res.statusCode).toBe(200);
      const rows = await recordRows(address);
      expect(rows).toHaveLength(1);
      // The other browser's record is gone: it renders the form.
      const { body } = await entry(
        elsewhere,
        hostIdp.seedAuthRequest({ clientId: DOCTOR }),
      );
      expect(body.action).toBe("render");
      // The host's own new record answers at once.
      const again = await entry(
        jar,
        hostIdp.seedAuthRequest({ clientId: DOCTOR }),
      );
      expect(again.body.action).toBe("redirect");
    });

    it("EARS-12: S164 a wrong reset code preserves every record, then the same form revokes only that subject and its new record reuses", async () => {
      const address = await account("s164-reset");
      const unrelated = await account("s164-unrelated");
      const oldBrowsers = [new Jar(), new Jar()];
      for (const browser of oldBrowsers) await signIn(browser, address);
      const independent = new Jar();
      await signIn(independent, unrelated, DOCTOR);
      const records = app.get(SignInHostRecordStore);
      const oldCookies = oldBrowsers.map((jar) =>
        jar.values.get(RECORD_COOKIE_NAME)!,
      );
      expect(new Set(oldCookies).size).toBe(2);
      const oldRecords = await Promise.all(
        oldCookies.map((cookie) => records.find(cookie)),
      );
      for (const record of oldRecords) expect(record).not.toBeNull();
      const unrelatedCookie = independent.values.get(RECORD_COOKIE_NAME)!;
      const unrelatedRecord = await records.find(unrelatedCookie);
      expect(unrelatedRecord).not.toBeNull();
      expect(unrelatedRecord!.session.sub).not.toBe(oldRecords[0]!.session.sub);
      const before = await recordRows(address);
      const unrelatedBefore = await recordRows(unrelated);
      expect(before).toHaveLength(2);
      expect(unrelatedBefore).toHaveLength(1);
      const jar = new Jar();
      const form = await render(jar, ACADEMY);
      const binding = jar.header();
      const formCookie = jar.values.get(FORM_COOKIE_NAME);
      await requestReset(address);
      const payload = {
        identifier: address,
        newPassword: "S164-new-password",
        authRequest: form.authRequest,
        csrf: form.csrf,
      };
      const complete = vi.spyOn(idp, "completePasswordReset");
      const terminate = vi.spyOn(idp, "terminateSession");
      const remove = vi.spyOn(records, "deleteBySubject");
      const insert = vi.spyOn(records, "insert");
      const lifetime = vi.spyOn(hostIdp, "setSessionLifetime");
      const finalise = vi.spyOn(hostIdp, "finaliseWithSession");
      const finaliseError = vi.spyOn(hostIdp, "finaliseWithError");
      const finalisedBefore = hostIdp.finalised.length;
      const spies = [
        complete,
        terminate,
        remove,
        insert,
        lifetime,
        finalise,
        finaliseError,
      ];
      try {
        const wrong = await post(jar, "password/reset/complete", {
          ...payload,
          code: "000000",
        });
        expect(wrong.statusCode).toBe(400);
        expect(wrong.json()).toMatchObject({
          message: "the request could not be completed",
        });
        expect(wrong.cookies).toEqual([]);
        expect(complete).toHaveBeenCalledExactlyOnceWith(
          address,
          "000000",
          payload.newPassword,
        );
        for (const spy of [
          terminate,
          remove,
          insert,
          lifetime,
          finalise,
          finaliseError,
        ])
          expect(spy).not.toHaveBeenCalled();
        expect(hostIdp.finalised).toHaveLength(finalisedBefore);
        expect(jar.header()).toBe(binding);
        expect(await recordRows(address)).toEqual(before);
        expect(await recordRows(unrelated)).toEqual(unrelatedBefore);
        for (const [index, cookie] of oldCookies.entries()) {
          expect(await records.find(cookie)).toEqual(oldRecords[index]);
          expect(oldBrowsers[index]!.values.get(RECORD_COOKIE_NAME)).toBe(
            cookie,
          );
        }
        expect(await records.find(unrelatedCookie)).toEqual(unrelatedRecord);
        expect(independent.values.get(RECORD_COOKIE_NAME)).toBe(
          unrelatedCookie,
        );

        const accepted = await post(jar, "password/reset/complete", {
          ...payload,
          code: FAKE_VALID_CODE,
        });
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          status: "redirect",
          url: expect.stringContaining("code="),
        });
        expect(complete).toHaveBeenNthCalledWith(
          2,
          address,
          FAKE_VALID_CODE,
          payload.newPassword,
        );
        expect(complete).toHaveBeenCalledTimes(2);
        expect(remove).toHaveBeenCalledExactlyOnceWith(
          oldRecords[0]!.session.sub,
        );
        expect(terminate).toHaveBeenCalledTimes(2);
        for (const record of oldRecords)
          expect(terminate).toHaveBeenCalledWith(record!.session);
        for (const cookie of oldCookies)
          expect(await records.find(cookie)).toBeNull();
        expect(await records.find(unrelatedCookie)).toEqual(unrelatedRecord);
        expect(await recordRows(unrelated)).toEqual(unrelatedBefore);
        const newCookie = jar.values.get(RECORD_COOKIE_NAME)!;
        expect(newCookie).toBeTruthy();
        expect(oldCookies).not.toContain(newCookie);
        const fresh = await records.find(newCookie);
        expect(fresh?.session.sub).toBe(oldRecords[0]!.session.sub);
        expect(await recordRows(address)).toEqual([
          {
            cookie_id_hash: createHash("sha256")
              .update(newCookie)
              .digest("hex"),
            expires_at: fresh!.expiresAt,
            last_finalised_at: fresh!.lastFinalisedAt,
          },
        ]);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
        expect(finalise).toHaveBeenCalledExactlyOnceWith(
          form.authRequest,
          fresh!.session,
        );
        expect(finaliseError).not.toHaveBeenCalled();
        expect(hostIdp.finalised.slice(finalisedBefore)).toEqual([
          { id: form.authRequest, session: fresh!.session },
        ]);
        expect(accepted.cookies.map((cookie) => cookie.name)).toEqual([
          RECORD_COOKIE_NAME,
        ]);
        expect(jar.values.get(FORM_COOKIE_NAME)).toBe(formCookie);
        expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);

        for (const browser of oldBrowsers) {
          const request = hostIdp.seedAuthRequest({ clientId: DOCTOR });
          const count = hostIdp.finalised.length;
          expect((await entry(browser, request)).body.action).toBe("render");
          expect(browser.values.has(RECORD_COOKIE_NAME)).toBe(false);
          expect(hostIdp.finalised).toHaveLength(count);
        }
        for (const [browser, record] of [
          [jar, fresh],
          [independent, unrelatedRecord],
        ] as const) {
          const request = hostIdp.seedAuthRequest({ clientId: DOCTOR });
          const reused = await entry(browser, request);
          expect(reused.body).toEqual({
            action: "redirect",
            url: expect.stringContaining("code="),
          });
          expect(reused.res.cookies).toEqual([]);
          expect(hostIdp.finalised.at(-1)).toEqual({
            id: request,
            session: record!.session,
          });
        }
        expect(complete).toHaveBeenCalledTimes(2);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(lifetime).toHaveBeenCalledTimes(1);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it("EARS-41: the first accepted code of an unverified account ends its earlier host records", async () => {
      const address = email("pre-verify");
      await registerOnStorefront(address);
      const jar = new Jar();
      await signIn(jar, address);
      expect(await recordRows(address)).toHaveLength(1);
      const v = await app.inject({
        method: "POST",
        url: "/v1/auth/verify",
        headers: DEVICE,
        payload: { email: address, code: FAKE_VALID_CODE },
      });
      expect(v.statusCode).toBe(200);
      expect(await recordRows(address)).toHaveLength(0);
    });

    it("EARS-12: a revocation landing between the credential check's start and the record insert leaves no record and refuses the step", async () => {
      const address = await account("race");
      const jar = new Jar();
      const form = await render(jar, ACADEMY);
      const original = idp.passwordLogin.bind(idp);
      // The old password is checked while a reset completes elsewhere: the
      // revocation lands after the check started and before the insert.
      const race = vi
        .spyOn(idp, "passwordLogin")
        .mockImplementationOnce(async (identifier, password) => {
          const result = await original(identifier, password);
          await storefrontResetComplete(address);
          return result;
        });
      const terminate = vi.spyOn(idp, "terminateSession");
      const res = await post(jar, "login", {
        identifier: address,
        password: PASSWORD,
        authRequest: form.authRequest,
        csrf: form.csrf,
      });
      race.mockRestore();
      expect(res.statusCode).toBe(401);
      expect(await recordRows(address)).toHaveLength(0);
      expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(false);
      expect(terminate).toHaveBeenCalled();
      terminate.mockRestore();
    });

    it("EARS-12: a record whose credential step precedes the subject's revocation is refused even if it survived the delete", async () => {
      const address = await account("fence");
      const jar = new Jar();
      await signIn(jar, address);
      const finalised = hostIdp.finalised.at(-1) as {
        session: {
          zitadelSessionId: string;
          sessionToken: string;
          sub: string;
        };
      };
      await storefrontResetComplete(address);
      // A row a concurrent request wrote from a credential step before the
      // revocation (it raced the delete).
      const cookieId = randomBytes(32).toString("base64url");
      const past = new Date(Date.now() - 60_000);
      await app.get(SignInHostRecordStore).insert(cookieId, {
        session: finalised.session,
        fingerprint: deviceFingerprint(),
        lastCredentialAt: past,
        expiresAt: new Date(past.getTime() + 30 * 24 * 3600 * 1000),
      });
      const raced = new Jar();
      raced.values.set(RECORD_COOKIE_NAME, cookieId);
      const { body } = await entry(
        raced,
        hostIdp.seedAuthRequest({ clientId: DOCTOR }),
      );
      expect(body.action).toBe("render");
      expect(raced.values.has(RECORD_COOKIE_NAME)).toBe(false);
    });
  });

  describe("EARS-69: the host credential steps share the storefront's limits", () => {
    let limited: Awaited<ReturnType<typeof compile>>;
    beforeAll(async () => {
      limited = await compile({
        ...RELAXED_RATE_LIMIT,
        perIpPer15Min: 3,
      });
    });
    afterAll(async () => {
      await limited.app.close();
    });

    it("EARS-69: storefront and host attempts from one address meet one per-IP ceiling, with the storefront's own 429", async () => {
      const jar = new Jar();
      const authRequest = limited.hostIdp.seedAuthRequest({
        clientId: ACADEMY,
      });
      const first = await limited.app.inject({
        method: "GET",
        url: `/v1/sign-in-host/entry?authRequest=${authRequest}`,
        headers: DEVICE,
      });
      jar.apply(first.cookies);
      const form = first.json() as { csrf: string };
      const wrong = { identifier: "nobody@ds.test", password: "Wrong-pw-1!x" };
      const storefront = () =>
        limited.app.inject({
          method: "POST",
          url: "/v1/auth/login",
          headers: DEVICE,
          payload: wrong,
        });
      const host = () =>
        limited.app.inject({
          method: "POST",
          url: "/v1/sign-in-host/login",
          headers: {
            ...DEVICE,
            origin: HOST_ORIGIN,
            cookie: jar.header(),
          },
          payload: { ...wrong, authRequest, csrf: form.csrf },
        });
      expect((await storefront()).statusCode).toBe(401);
      expect((await host()).statusCode).toBe(401);
      expect((await storefront()).statusCode).toBe(401);
      const hostThrottled = await host();
      const storefrontThrottled = await storefront();
      expect(hostThrottled.statusCode).toBe(429);
      expect(storefrontThrottled.statusCode).toBe(429);
      expect(hostThrottled.json()).toEqual(storefrontThrottled.json());
    });
  });

  describe("ADR-0015 §4 req. 4: the cookies the API sets", () => {
    /** The raw `Set-Cookie` line the API sent for `name`. */
    function setCookieLine(
      res: { headers: Record<string, unknown> },
      name: string,
    ): string {
      const raw = res.headers["set-cookie"];
      const lines = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
      const line = lines.find((l: string) => l.startsWith(`${name}=`));
      expect(line, `${name} was not set`).toBeDefined();
      return line as string;
    }

    function expectHostOnly(line: string, name: string): number {
      const [pair, ...attrs] = line.split(";").map((p) => p.trim());
      expect(name.startsWith("__Host-")).toBe(true);
      expect(pair!.split("=")[1]).not.toBe("");
      const lower = attrs.map((a) => a.toLowerCase());
      expect(lower).toContain("path=/");
      expect(lower).toContain("secure");
      expect(lower).toContain("httponly");
      expect(lower).toContain("samesite=lax");
      expect(lower.some((a) => a.startsWith("domain"))).toBe(false);
      const maxAge = lower.find((a) => a.startsWith("max-age="));
      expect(maxAge).toBeDefined();
      return Number(maxAge!.slice("max-age=".length));
    }

    it("EARS-66: the form-state cookie is __Host-, Path=/, Secure, HttpOnly, SameSite=Lax and carries no Domain", async () => {
      const authRequest = hostIdp.seedAuthRequest({ clientId: ACADEMY });
      const { res, body } = await entry(new Jar(), authRequest);
      expect(body.action).toBe("render");
      const maxAge = expectHostOnly(
        setCookieLine(res, FORM_COOKIE_NAME),
        FORM_COOKIE_NAME,
      );
      expect(maxAge).toBeGreaterThan(0);
    });

    it("EARS-64: the record cookie is __Host-, Path=/, Secure, HttpOnly, SameSite=Lax, carries no Domain and never outlives the record", async () => {
      const address = await account("cookie-attrs");
      const jar = new Jar();
      const res = await signIn(jar, address);
      const maxAge = expectHostOnly(
        setCookieLine(res, RECORD_COOKIE_NAME),
        RECORD_COOKIE_NAME,
      );
      const [row] = await recordRows(address);
      const leftSeconds = (row!.expires_at.getTime() - Date.now()) / 1000;
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(Math.ceil(leftSeconds) + 1);
    });
  });

  // ADR-0002 §4.8: auth audit is explicit emission at the command site. Each
  // host credential route runs its storefront twin's AuthService step, so it
  // appends the same terminal rows (audit-emission-coverage.ts).
  describe("EARS-18: each host route appends its storefront twin's audit rows", () => {
    const pepper =
      process.env.AUDIT_IDENTIFIER_PEPPER ??
      "test-only-insecure-audit-identifier-pepper";

    async function now(): Promise<string> {
      const { rows } = await pool.query<{ t: string }>(
        "SELECT clock_timestamp()::text AS t",
      );
      return rows[0]!.t;
    }

    /** Event types appended since `since` for `address` (by subject or masked identifier). */
    async function ledger(address: string, since: string): Promise<string[]> {
      const { rows } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE created_at >= $3
            AND (subject_id = (SELECT zitadel_sub FROM users WHERE email = $1)
                 OR metadata->>'identifier_hash' = $2)
          ORDER BY created_at`,
        [address, hashIdentifier(address, pepper), since],
      );
      return rows.map((r) => r.event_type);
    }

    it("EARS-18: the host password step appends auth.login.success, a wrong password auth.login.failure", async () => {
      const address = await account("audit-login");
      const since = await now();
      await signIn(new Jar(), address);
      const jar = new Jar();
      const form = await render(jar, ACADEMY);
      const wrong = await post(jar, "login", {
        identifier: address,
        password: "Zz9!definitely-the-wrong-pw",
        authRequest: form.authRequest,
        csrf: form.csrf,
      });
      expect(wrong.statusCode).toBe(401);
      const events = await ledger(address, since);
      expect(events).toContain("auth.login.success");
      expect(events).toContain("auth.login.failure");
    });

    it("EARS-18: the host code request appends auth.otp.sent, the code step auth.login.success, a wrong code auth.login.failure", async () => {
      const address = await account("audit-otp");
      const since = await now();
      const jar = new Jar();
      const form = await render(jar, ACADEMY);
      const fields = { authRequest: form.authRequest, csrf: form.csrf };
      const sent = await post(jar, "login/otp/request", {
        identifier: address,
        channel: "email",
        ...fields,
      });
      expect(sent.statusCode).toBe(200);
      const wrong = await post(jar, "login/otp", {
        identifier: address,
        code: "000000",
        channel: "email",
        ...fields,
      });
      expect(wrong.statusCode).toBe(401);
      const ok = await post(jar, "login/otp", {
        identifier: address,
        code: FAKE_VALID_CODE,
        channel: "email",
        ...fields,
      });
      expect(ok.statusCode).toBe(200);
      const events = await ledger(address, since);
      expect(events).toContain("auth.otp.sent");
      expect(events).toContain("auth.login.failure");
      expect(events).toContain("auth.login.success");
    });

    it.each([
      ["academy", ACADEMY, DOCTOR],
      ["doctor", DOCTOR, ACADEMY],
    ] as const)(
      "EARS-70: S172 first refused %s hand-off form posts preserve the unused reference for the original valid form",
      async (storefront, clientId, foreignClient) => {
        const address = await account(`s172-first-binding-${storefront}`);
        const { rows } = await pool.query<{ id: string }>(
          "SELECT id FROM users WHERE email = $1",
          [address],
        );
        const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
        const ref = await handoffs.mint(rows[0]!.id, address);
        const reference = await handoffs.peek(ref);
        expect(reference).toEqual({
          accountId: rows[0]!.id,
          identifier: address,
        });
        const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
        const intent = {
          door: "login" as const,
          method: "code" as const,
          handoff: ref,
          clientId,
        };
        const hint = await state.putIntent(intent, 600);
        const authRequest = hostIdp.seedAuthRequest({
          clientId,
          loginHint: hint,
        });
        const foreignRequest = hostIdp.seedAuthRequest({
          clientId: foreignClient,
        });
        const jar = new Jar();
        const { res, body } = await entry(jar, authRequest);
        expect(res.statusCode).toBe(200);
        expect(body).toEqual({
          action: "render",
          storefront,
          door: "login",
          authRequest,
          csrf: expect.any(String),
          intent: { method: "code", handoff: true },
        });
        if (body.action !== "render") throw new Error("not rendered");
        const formId = jar.values.get(FORM_COOKIE_NAME)!;
        const binding = await state.getForm(formId);
        expect(binding).toEqual({
          csrfToken: body.csrf,
          storefront,
          authRequestId: authRequest,
          intent,
        });
        const cookies = [...jar.values];
        const fields = { authRequest, csrf: body.csrf };
        const auth = app.get(AuthService);
        const resolve = vi.spyOn(auth, "resolveLoginHandoff");
        const redeem = vi.spyOn(handoffs, "redeem");
        const request = vi.spyOn(auth, "requestLoginOtp");
        const send = vi.spyOn(idp, "requestEmailLoginCode");
        const noAuthentication = [
          vi.spyOn(auth, "passwordStep"),
          vi.spyOn(auth, "otpStep"),
          vi.spyOn(auth, "verifyStep"),
          vi.spyOn(idp, "passwordLogin"),
          vi.spyOn(idp, "submitEmailCode"),
          vi.spyOn(idp, "loginWithEmailOtp"),
          vi.spyOn(idp, "loginWithSmsOtp"),
          vi.spyOn(idp, "requestSmsOtp"),
          vi.spyOn(hostIdp, "setSessionLifetime"),
          vi.spyOn(hostIdp, "finaliseWithSession"),
          vi.spyOn(hostIdp, "finaliseWithError"),
          vi.spyOn(app.get(SignInHostRecordStore), "insert"),
        ];
        const spies = [resolve, redeem, request, send, ...noAuthentication];
        for (const spy of spies) spy.mockClear();
        try {
          for (const [browser, payload] of [
            [jar, { ...fields, csrf: "wrong" }],
            [new Jar(), fields],
            [jar, { ...fields, authRequest: foreignRequest }],
          ] as const) {
            const refused = await post(browser, "login/otp/handoff", payload);
            expect(refused.statusCode).toBe(403);
            expect(refused.cookies).toEqual([]);
            for (const spy of spies) expect(spy).not.toHaveBeenCalled();
            expect([...jar.values]).toEqual(cookies);
            expect(await state.getForm(formId)).toEqual(binding);
            expect(await handoffs.peek(ref)).toEqual(reference);
          }

          const accepted = await post(jar, "login/otp/handoff", fields);
          expect(accepted.statusCode).toBe(200);
          expect(accepted.json()).toEqual({
            status: "otp_sent",
            identifier: address,
          });
          expect(accepted.cookies).toEqual([]);
          expect(resolve).toHaveBeenCalledExactlyOnceWith(ref, undefined);
          expect(redeem).toHaveBeenCalledExactlyOnceWith(ref);
          expect(request).toHaveBeenCalledExactlyOnceWith(
            { identifier: address, channel: "email" },
            expect.objectContaining({ ip: "127.0.0.1" }),
          );
          expect(send).toHaveBeenCalledExactlyOnceWith(address);
          for (const spy of noAuthentication)
            expect(spy).not.toHaveBeenCalled();
          expect([...jar.values]).toEqual(cookies);
          expect(await state.getForm(formId)).toEqual(binding);
          expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(false);
          expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
          expect(await recordRows(address)).toEqual([]);
        } finally {
          for (const spy of spies) spy.mockRestore();
          await state.deleteForm(formId);
          hostIdp.expire(authRequest);
          hostIdp.expire(foreignRequest);
        }
      },
    );

    it.each([
      ["academy", ACADEMY],
      ["doctor", DOCTOR],
    ] as const)(
      "EARS-43/44: S172 a guest %s hand-off sends once, then reload rotates the binding and refuses stale replay",
      async (storefront, clientId) => {
        const address = await account(`s172-${storefront}`);
        const { rows } = await pool.query<{ id: string; zitadel_sub: string }>(
          "SELECT id, zitadel_sub FROM users WHERE email = $1",
          [address],
        );
        const handoffs = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
        const ref = await handoffs.mint(rows[0]!.id, address);
        const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
        const intent = await state.putIntent(
          { door: "login", method: "code", handoff: ref, clientId },
          600,
        );
        const authRequest = hostIdp.seedAuthRequest({
          clientId,
          loginHint: intent,
        });
        const jar = new Jar();
        const auth = app.get(AuthService);
        const db = app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
        const redeem = vi.spyOn(handoffs, "redeem");
        const resolve = vi.spyOn(auth, "resolveLoginHandoff");
        const own = vi.spyOn(auth, "isOwnLoginHandoff");
        const select = vi.spyOn(db, "select");
        const request = vi.spyOn(auth, "requestLoginOtp");
        const send = vi.spyOn(idp, "requestEmailLoginCode");
        const noAuthentication = [
          vi.spyOn(auth, "passwordStep"),
          vi.spyOn(auth, "otpStep"),
          vi.spyOn(idp, "passwordLogin"),
          vi.spyOn(idp, "submitEmailCode"),
          vi.spyOn(idp, "loginWithEmailOtp"),
          vi.spyOn(idp, "loginWithSmsOtp"),
          vi.spyOn(idp, "requestSmsOtp"),
          vi.spyOn(hostIdp, "setSessionLifetime"),
          vi.spyOn(hostIdp, "finaliseWithSession"),
          vi.spyOn(hostIdp, "finaliseWithError"),
          vi.spyOn(app.get(SignInHostRecordStore), "insert"),
        ];
        try {
          const { res, body } = await entry(jar, authRequest);
          expect(res.statusCode).toBe(200);
          expect(body).toEqual({
            action: "render",
            storefront,
            door: "login",
            authRequest,
            csrf: expect.any(String),
            intent: { method: "code", handoff: true },
          });
          for (const secret of [
            ref,
            address,
            rows[0]!.id,
            rows[0]!.zitadel_sub,
            PASSWORD,
          ]) {
            expect(res.payload).not.toContain(secret);
            expect(JSON.stringify(res.headers)).not.toContain(secret);
          }
          expect(res.cookies.map((cookie) => cookie.name)).toEqual([
            FORM_COOKIE_NAME,
          ]);
          expect(redeem).not.toHaveBeenCalled();
          expect(request).not.toHaveBeenCalled();
          expect(send).not.toHaveBeenCalled();
          if (body.action !== "render") throw new Error("not rendered");
          const oldFormId = jar.values.get(FORM_COOKIE_NAME)!;
          const oldJar = new Jar();
          oldJar.values.set(FORM_COOKIE_NAME, oldFormId);
          const fields = { authRequest, csrf: body.csrf };
          const since = await now();
          const accepted = await post(jar, "login/otp/handoff", fields);
          expect(accepted.statusCode).toBe(200);
          expect(accepted.json()).toEqual({
            status: "otp_sent",
            identifier: address,
          });
          expect(accepted.cookies).toEqual([]);
          expect(redeem).toHaveBeenCalledExactlyOnceWith(ref);
          expect(request).toHaveBeenCalledExactlyOnceWith(
            { identifier: address, channel: "email" },
            expect.objectContaining({ ip: "127.0.0.1" }),
          );
          expect(send).toHaveBeenCalledExactlyOnceWith(address);
          expect(await ledger(address, since)).toEqual(["auth.otp.sent"]);

          const { res: reopened, body: fresh } = await entry(jar, authRequest);
          expect(reopened.statusCode).toBe(200);
          expect(fresh).toEqual({
            action: "render",
            storefront,
            door: "login",
            authRequest,
            csrf: expect.any(String),
          });
          if (fresh.action !== "render") throw new Error("not rendered");
          const freshFormId = jar.values.get(FORM_COOKIE_NAME)!;
          expect(freshFormId).not.toBe(oldFormId);
          expect(fresh.csrf).not.toBe(body.csrf);
          expect(await state.getForm(oldFormId)).toBeNull();
          expect(await state.getForm(freshFormId)).toEqual({
            csrfToken: fresh.csrf,
            storefront,
            authRequestId: authRequest,
          });
          expect(reopened.cookies.map((cookie) => cookie.name)).toEqual([
            FORM_COOKIE_NAME,
          ]);
          expect(redeem).toHaveBeenCalledTimes(1);
          expect(request).toHaveBeenCalledTimes(1);
          expect(send).toHaveBeenCalledTimes(1);

          select.mockClear();
          own.mockClear();
          resolve.mockClear();
          for (const staleJar of [oldJar, jar]) {
            const refused = await post(staleJar, "login/otp/handoff", fields);
            expect(refused.statusCode).toBe(403);
            expect(refused.cookies).toEqual([]);
          }
          expect(select).not.toHaveBeenCalled();
          expect(own).not.toHaveBeenCalled();
          expect(resolve).not.toHaveBeenCalled();
          const refused = await post(jar, "login/otp/handoff", {
            authRequest,
            csrf: fresh.csrf,
          });
          expect(refused.statusCode).toBe(200);
          expect(refused.json()).toEqual({ status: "handoff_refused" });
          expect(refused.cookies).toEqual([]);
          expect(resolve).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
          expect(select).not.toHaveBeenCalled();
          expect(own).not.toHaveBeenCalled();
          expect(redeem).toHaveBeenCalledExactlyOnceWith(ref);
          expect(request).toHaveBeenCalledTimes(1);
          expect(send).toHaveBeenCalledTimes(1);
          for (const spy of noAuthentication)
            expect(spy).not.toHaveBeenCalled();
          expect(jar.values.has(RECORD_COOKIE_NAME)).toBe(false);
          expect(jar.values.has(SESSION_COOKIE_NAME)).toBe(false);
          expect(await recordRows(address)).toEqual([]);
          expect(await ledger(address, since)).toEqual(["auth.otp.sent"]);
        } finally {
          for (const spy of [
            redeem,
            resolve,
            own,
            select,
            request,
            send,
            ...noAuthentication,
          ])
            spy.mockRestore();
        }
      },
    );

    it("EARS-18: a live hand-off redeemed on the host appends exactly one auth.otp.sent", async () => {
      const address = await account("audit-handoff");
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [address],
      );
      const ref = await app
        .get<LoginHandoffStore>(LOGIN_HANDOFF_STORE)
        .mint(rows[0]!.id, address);
      const intent = await app
        .get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE)
        .putIntent(
          { door: "login", method: "code", handoff: ref, clientId: DOCTOR },
          600,
        );
      const since = await now();
      const jar = new Jar();
      const authRequest = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        loginHint: intent,
      });
      const { body } = await entry(jar, authRequest);
      if (body.action !== "render") throw new Error("not rendered");
      const res = await post(jar, "login/otp/handoff", {
        authRequest,
        csrf: body.csrf,
      });
      expect(res.json()).toMatchObject({ status: "otp_sent" });
      expect(
        (await ledger(address, since)).filter((e) => e === "auth.otp.sent"),
      ).toHaveLength(1);
    });

    it("EARS-18: the host Academy registration appends auth.register, its resend auth.otp.sent, its code step auth.account.verified + auth.login.success", async () => {
      const since = await now();
      const jar = new Jar();
      const form = await render(jar, ACADEMY, { prompt: ["create"] });
      const fields = { authRequest: form.authRequest, csrf: form.csrf };
      const address = email("audit-reg-academy");
      const reg = await post(jar, "register", {
        email: address,
        password: PASSWORD,
        consent: CONSENT,
        ...fields,
      });
      expect(reg.statusCode).toBe(200);
      const resend = await post(jar, "verify/resend", {
        identifier: address,
        ...fields,
      });
      expect(resend.statusCode).toBe(200);
      const verified = await post(jar, "verify", {
        email: address,
        code: FAKE_VALID_CODE,
        ...fields,
      });
      expect(verified.statusCode).toBe(200);
      const events = await ledger(address, since);
      expect(events).toContain("auth.register");
      expect(events).toContain("auth.otp.sent");
      expect(events).toContain("auth.account.verified");
      expect(events).toContain("auth.login.success");
    });

    it("EARS-18: the host doctor registration appends auth.register, its code step auth.account.verified + auth.login.success", async () => {
      const since = await now();
      const jar = new Jar();
      const form = await render(jar, DOCTOR, { prompt: ["create"] });
      const fields = { authRequest: form.authRequest, csrf: form.csrf };
      const address = email("audit-reg-doctor");
      const reg = await post(jar, "storefront/doctor/register", {
        email: address,
        password: PASSWORD,
        medicalWorkerDeclaration: true,
        consent: [
          {
            purpose: PARTNER_DATA_SHARING_PURPOSE,
            version: PARTNER_DATA_SHARING_VERSION,
          },
        ],
        ...fields,
      });
      expect(reg.statusCode).toBe(200);
      const verified = await post(jar, "storefront/doctor/verify", {
        email: address,
        code: FAKE_VALID_CODE,
        ...fields,
      });
      expect(verified.statusCode).toBe(200);
      const events = await ledger(address, since);
      expect(events).toContain("auth.register");
      expect(events).toContain("auth.account.verified");
      expect(events).toContain("auth.login.success");
    });

    it("EARS-18: the host reset request appends auth.password.reset_requested, a wrong code auth.password.reset_failed, the completion auth.password.changed", async () => {
      const address = await account("audit-reset");
      const since = await now();
      const jar = new Jar();
      const form = await render(jar, ACADEMY);
      const fields = { authRequest: form.authRequest, csrf: form.csrf };
      const requested = await post(jar, "password/reset", {
        identifier: address,
        ...fields,
      });
      expect(requested.statusCode).toBe(200);
      const wrong = await post(jar, "password/reset/complete", {
        identifier: address,
        code: "000000",
        newPassword: "Dd4!one-more-long-pw",
        ...fields,
      });
      expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
      const done = await post(jar, "password/reset/complete", {
        identifier: address,
        code: FAKE_VALID_CODE,
        newPassword: "Dd4!one-more-long-pw",
        ...fields,
      });
      expect(done.statusCode).toBe(200);
      const events = await ledger(address, since);
      expect(events).toContain("auth.password.reset_requested");
      expect(events).toContain("auth.password.reset_failed");
      expect(events).toContain("auth.password.changed");
    });
  });

  describe("disabled", () => {
    let disabled: Awaited<ReturnType<typeof compile>>;
    beforeAll(async () => {
      disabled = await compile(RELAXED_RATE_LIMIT, { value: null });
    });
    afterAll(async () => {
      await disabled.app.close();
    });

    it("EARS-60: with the sign-in-host block unset every route is a 404", async () => {
      const res = await disabled.app.inject({
        method: "GET",
        url: "/v1/sign-in-host/entry?authRequest=V2_abc",
        headers: DEVICE,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

/** The fingerprint the e2e device yields from the loopback address. */
function deviceFingerprint(): string {
  return computeFingerprint({
    userAgent: DEVICE["user-agent"],
    ip: "127.0.0.1",
    acceptLanguage: DEVICE["accept-language"],
  });
}

/**
 * The live half (CI `api-e2e`, the dev stand): the Zitadel adapter against the
 * real instance, on the provisioned Academy storefront client — an auth
 * request read back and finalised `access_denied`, and a checked session whose
 * lifetime the adapter sets to 30 days, finalised into a code.
 */
const ISSUER = process.env.IDP_ISSUER?.replace(/\/$/, "");
const TOKEN = process.env.IDP_SERVICE_TOKEN;
const PROJECT_ID = process.env.IDP_PROJECT_ID;
const LIVE = Boolean(ISSUER && TOKEN && PROJECT_ID);

describe.skipIf(!LIVE)("Sign-in host — live Zitadel adapter (e2e)", () => {
  const adapter = () =>
    new ZitadelSignInHostIdp({ baseUrl: ISSUER!, serviceToken: TOKEN! });
  let academy: { clientId: string; redirectUri: string };

  beforeAll(async () => {
    const name = process.env.IDP_ACADEMY_APP_NAME ?? "ds-storefront-academy";
    const res = await fetch(
      `${ISSUER}/management/v1/projects/${PROJECT_ID}/apps/_search`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          queries: [
            { nameQuery: { name, method: "TEXT_QUERY_METHOD_EQUALS" } },
          ],
        }),
      },
    );
    const found = (await res.json()) as {
      result?: Array<{
        name: string;
        oidcConfig?: { clientId: string; redirectUris?: string[] };
      }>;
    };
    const app = (found.result ?? []).find((a) => a.name === name);
    if (!app?.oidcConfig?.redirectUris?.[0])
      throw new Error(`app ${name} is not provisioned — run provision.sh`);
    academy = {
      clientId: app.oidcConfig.clientId,
      redirectUri: app.oidcConfig.redirectUris[0],
    };
  });

  /** One authorize hop of the Academy client: the auth request id it opened. */
  async function authorize(): Promise<string> {
    const params = new URLSearchParams({
      client_id: academy.clientId,
      redirect_uri: academy.redirectUri,
      response_type: "code",
      scope: "openid",
      state: randomBytes(16).toString("base64url"),
      code_challenge: createHash("sha256")
        .update(randomBytes(32).toString("base64url"))
        .digest("base64url"),
      code_challenge_method: "S256",
    });
    const res = await fetch(`${ISSUER}/oauth/v2/authorize?${params}`, {
      redirect: "manual",
    });
    const location = res.headers.get("location") ?? "";
    const id = new URL(location, ISSUER).searchParams.get("authRequest");
    if (!id) throw new Error(`authorize opened no auth request: ${res.status}`);
    return id;
  }

  it("EARS-60: a storefront client's auth request reads back its client_id and finalises access_denied", async () => {
    const id = await authorize();
    const view = await adapter().readAuthRequest(id);
    expect(view?.clientId).toBe(academy.clientId);
    const url = await adapter().finaliseWithError(id, "access_denied");
    expect(url).toContain("error=access_denied");
    expect(await adapter().readAuthRequest(id)).toBeNull();
  });

  it("EARS-5: the adapter gives a checked session an explicit 30-day lifetime and finalises with it", async () => {
    const client = new ZitadelIdpClient({
      baseUrl: ISSUER!,
      serviceToken: TOKEN!,
      clientId: process.env.IDP_CLIENT_ID ?? "",
      clientSecret: process.env.IDP_CLIENT_SECRET,
      redirectUri: process.env.IDP_REDIRECT_URI ?? academy.redirectUri,
      projectId: PROJECT_ID!,
    });
    const address = `sih-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
    const password = `Sih-${Date.now()}-aA1!`;
    await client.createUser({ email: address, password });
    const login = await client.passwordLogin(address, password);
    expect(login.outcome).toBe("authenticated");
    if (login.outcome !== "authenticated") return;

    const session = await adapter().setSessionLifetime(
      login.session,
      SIGN_IN_HOST_SESSION_LIFETIME_SECONDS,
    );
    expect(session).not.toBeNull();
    const read = await fetch(
      `${ISSUER}/v2/sessions/${session!.zitadelSessionId}`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const body = (await read.json()) as {
      session?: { expirationDate?: string };
    };
    const days =
      (Date.parse(body.session?.expirationDate ?? "") - Date.now()) /
      (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30.01);

    const url = await adapter().finaliseWithSession(
      await authorize(),
      session!,
    );
    expect(url).toContain("code=");
    await client.terminateSession(session!);
  });
});
