import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import {
  DOCTOR_GUEST_ROLE,
  IDP_CLIENT,
  type IdpClient,
} from "../../src/auth/idp/idp.types.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  DEFAULT_SMS_BUDGET_THRESHOLDS,
  SMS_BUDGET_THRESHOLDS,
} from "../../src/auth/sms-budget/sms-budget.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * 003 EARS-47…52, 58 (#2449) live harness: the whole api against the
 * dev-stand Zitadel (the real adapter `IdpModule` binds from the env), its
 * HTTP SMS provider delivering to `sms-sink`, and Mailpit. Codes are read
 * from the sink — never from an api response.
 */
export const LIVE_PHONE =
  !!process.env.DATABASE_URL &&
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI;

const SMS_SINK_BASE = (
  process.env.SMS_SINK_URL ?? "http://truenas.local:8090"
).replace(/\/$/, "");
const MAILPIT_BASE = (
  process.env.MAILPIT_URL ?? "http://truenas.local:8025"
).replace(/\/$/, "");

/** The Zitadel event of the phone confirmation SMS (`verifyphone`). */
export const PHONE_CODE_EVENT = "user.human.phone.code.added";
/** The Zitadel event of the SMS sign-in code (`verifysmsotp`). */
export const SMS_LOGIN_EVENT = "session.otp.sms.challenged";

export const DEVICE = { "user-agent": "Test/1.0", "accept-language": "ru-RU" };
export const PASSWORD = "Aa1!phone-confirm-pw";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** A fresh number in the +1 555 fictional range (never a real subscriber). */
export function freshPhone(): string {
  return `+1555${String(Date.now()).slice(-4)}${String(
    Math.floor(Math.random() * 1000),
  ).padStart(3, "0")}`;
}

interface SinkMessage {
  body?: string;
  json?: { args?: { code?: string } } | null;
}

/** Sink messages to `phone` after `afterIso`, newest first. */
export async function sinkMessages(
  phone: string,
  afterIso: string,
  event?: string,
): Promise<SinkMessage[]> {
  const res = await fetch(
    `${SMS_SINK_BASE}/api/messages?to=${encodeURIComponent(phone)}` +
      `&after=${encodeURIComponent(afterIso)}` +
      (event ? `&event=${encodeURIComponent(event)}` : ""),
  );
  if (!res.ok) throw new Error(`sms-sink answered ${res.status}`);
  return ((await res.json()) as { messages?: SinkMessage[] }).messages ?? [];
}

/** Poll the sink for the phone confirmation code sent after `afterIso`. */
export async function phoneCode(
  phone: string,
  afterIso: string,
): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const [hit] = await sinkMessages(phone, afterIso, PHONE_CODE_EVENT);
    const code =
      hit?.json?.args?.code ?? hit?.body?.match(/\b(\d{6})\b/)?.[1] ?? null;
    if (code) return String(code);
    await sleep(500);
  }
  throw new Error(`no phone confirmation SMS reached the sink for ${phone}`);
}

/** Every SMS the sink holds for `phone` (the sink clock is not ours). */
export async function smsCount(phone: string): Promise<number> {
  return (await sinkMessages(phone, new Date(0).toISOString())).length;
}

/** Wait out the async provider hop, then assert no SMS beyond `before`. */
export async function expectNoNewSms(
  phone: string,
  before: number,
): Promise<void> {
  await sleep(4000);
  expect(await smsCount(phone)).toBe(before);
}

/** Mailpit messages to `email` whose subject contains `subject`. */
export async function mailsTo(
  email: string,
  subject: string,
): Promise<{ Subject: string; ID: string }[]> {
  const res = await fetch(
    `${MAILPIT_BASE}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const data = (await res.json()) as {
    messages?: { Subject: string; ID: string }[];
  };
  return (data.messages ?? []).filter((m) => m.Subject.includes(subject));
}

/** The full Mailpit message (`Text` / `HTML`) by id. */
export async function mailBody(
  id: string,
): Promise<{ Text: string; HTML: string }> {
  return (await (await fetch(`${MAILPIT_BASE}/api/v1/message/${id}`)).json()) as {
    Text: string;
    HTML: string;
  };
}

export interface LiveHarness {
  app: NestFastifyApplication;
  pool: pg.Pool;
  idp: IdpClient;
  /** A verified-email account with a password and a signed-in session. */
  account(prefix: string): Promise<{ email: string; sub: string; headers: Record<string, string> }>;
  requestCode(
    headers: Record<string, string>,
    phone: string,
  ): ReturnType<NestFastifyApplication["inject"]>;
  confirm(
    headers: Record<string, string>,
    code: string,
  ): ReturnType<NestFastifyApplication["inject"]>;
  passwordLogin(identifier: string): ReturnType<NestFastifyApplication["inject"]>;
  close(): Promise<void>;
}

export async function liveHarness(): Promise<LiveHarness> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(RATE_LIMIT_THRESHOLDS)
    .useValue(RELAXED_RATE_LIMIT)
    // The per-phone limit stays at its EARS-14 value; the per-IP / per-ASN /
    // global windows are opened because every case sends from one address.
    .overrideProvider(SMS_BUDGET_THRESHOLDS)
    .useValue({
      ...DEFAULT_SMS_BUDGET_THRESHOLDS,
      perIpPerHour: 1_000_000,
      perAsnPerHour: 1_000_000,
      globalPerDay: 1_000_000,
    })
    // The reset request is captcha-gated; not under test here.
    .overrideProvider(BOT_PROTECTION)
    .useValue({
      verify: (): Promise<BotProtectionResult> => Promise.resolve({ ok: true }),
    } satisfies BotProtection)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const pool = app.get<pg.Pool>(DRIZZLE_POOL);
  const idp = app.get<IdpClient>(IDP_CLIENT);
  const created: { email: string; sub: string }[] = [];

  const passwordLogin = (identifier: string) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: DEVICE,
      payload: { identifier, password: PASSWORD },
    });

  return {
    app,
    pool,
    idp,
    async account(prefix) {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      const { sub } = await idp.createUser({ email, password: PASSWORD });
      created.push({ email, sub });
      // The account surface admits `doctor_guest` (EARS-27); the BFF
      // registration grants it, this direct create does the same.
      await idp.grantProjectRole(sub, DOCTOR_GUEST_ROLE);
      // The session door refuses an unverified email (#2662); the projection
      // lags the create, so the flip is retried until it lands.
      for (let i = 0; i < 30; i++) {
        if ((await idp.getUser(sub))?.emailVerified) break;
        await idp.markEmailVerified(sub).catch(() => false);
        await sleep(250);
      }
      let res = await passwordLogin(email);
      for (let i = 0; i < 20 && res.statusCode !== 200; i++) {
        await sleep(500);
        res = await passwordLogin(email);
      }
      expect(res.statusCode, res.body).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      return {
        email,
        sub,
        headers: { ...DEVICE, cookie: `${SESSION_COOKIE_NAME}=${cookie!.value}` },
      };
    },
    requestCode: (headers, phone) =>
      app.inject({ method: "POST", url: "/v1/me/phone", headers, payload: { phone } }),
    confirm: (headers, code) =>
      app.inject({
        method: "POST",
        url: "/v1/me/phone/confirm",
        headers,
        payload: { code },
      }),
    passwordLogin,
    async close() {
      const base = process.env.IDP_ISSUER!.replace(/\/$/, "");
      for (const { email, sub } of created) {
        await deleteUserFixture(pool, "email", email);
        await fetch(`${base}/v2/users/${sub}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN!}` },
        }).catch(() => undefined);
      }
      await app.close();
    },
  };
}
