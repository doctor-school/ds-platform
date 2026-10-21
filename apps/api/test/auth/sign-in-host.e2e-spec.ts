import { createHash, randomBytes } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import type pg from "pg";
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
  PARTNER_DATA_SHARING_PURPOSE,
  type SignInHostEntryResponse,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";
import {
  LOGIN_HANDOFF_STORE,
  type LoginHandoffStore,
} from "../../src/auth/login-handoff/login-handoff.store.js";
import {
  computeFingerprint,
  SESSION_COOKIE_NAME,
} from "../../src/auth/session/session.cookie.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import {
  FORM_COOKIE_NAME,
  RECORD_COOKIE_NAME,
} from "../../src/sign-in-host/sign-in-host.cookies.js";
import { FakeSignInHostIdp } from "../../src/sign-in-host/sign-in-host.idp.fake.js";
import {
  SIGN_IN_HOST_IDP,
  ZitadelSignInHostIdp,
} from "../../src/sign-in-host/sign-in-host.idp.js";
import { SIGN_IN_HOST_SESSION_LIFETIME_SECONDS } from "../../src/sign-in-host/sign-in-host.policy.js";
import { SignInHostRecordStore } from "../../src/sign-in-host/sign-in-host-record.store.js";
import {
  SIGN_IN_HOST_STATE_STORE,
  type SignInHostStateStore,
} from "../../src/sign-in-host/sign-in-host-state.store.js";
import { SIGN_IN_HOST_SETTINGS } from "../../src/sign-in-host/sign-in-host.tokens.js";
import { PARTNER_DATA_SHARING_VERSION } from "../../src/storefront/doctor-register.service.js";
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

  beforeAll(async () => {
    ({ app, idp, hostIdp } = await compile());
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
  });
  afterEach(async () => {
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

  it("EARS-66: a stale auth request returns to the storefront the form state recorded", async () => {
    const jar = new Jar();
    const { authRequest } = await render(jar, ACADEMY);
    hostIdp.expire(authRequest);
    const { body } = await entry(jar, authRequest);
    expect(body).toEqual({ action: "redirect", url: ACADEMY_LOGIN });
  });

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

  describe("EARS-44: the hand-off against a live record", () => {
    async function handoffIntent(ref: string): Promise<string> {
      const state = app.get<SignInHostStateStore>(SIGN_IN_HOST_STATE_STORE);
      return state.putIntent(
        { door: "login", method: "code", handoff: ref, clientId: DOCTOR },
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

    it("EARS-44: a live reference of the record's own account finalises with the record, redeems nothing and sends no code", async () => {
      const address = await account("handoff-own");
      const jar = new Jar();
      await signIn(jar, address);
      const ref = await mint(address);
      const store = app.get<LoginHandoffStore>(LOGIN_HANDOFF_STORE);
      const redeem = vi.spyOn(store, "redeem");
      const authRequest = hostIdp.seedAuthRequest({
        clientId: DOCTOR,
        loginHint: await handoffIntent(ref),
      });
      const { body } = await entry(jar, authRequest);
      expect(body.action === "redirect" && body.url).toContain("code=");
      expect(redeem).not.toHaveBeenCalled();
      redeem.mockRestore();
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
