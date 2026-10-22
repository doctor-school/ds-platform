import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { freshConfirmablePhone, smsSinkUrl } from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SUBJECT = "Doctor.School — в аккаунте подтверждён номер телефона";
interface NoticeJourney {
  context: BrowserContext;
  page: Page;
  email: string;
  phone: string;
  sink: string;
  mailbox: string;
  subject?: string;
  cookie?: string;
  checkpoint?: AddressedMailCheckpoint;
  started?: number;
  completed?: number;
}
const journeys = new WeakMap<Page, NoticeJourney>();
function journey(page: Page): NoticeJourney {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned phone-notice journey is missing");
  return state;
}

async function assertIdentity(state: NoticeJourney, confirmed: boolean) {
  const current = await state.page.evaluate(
    async ({ email, phone, subject }) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await profile.json();
      const claims = await session.json();
      return {
        profile: profile.status,
        session: session.status,
        sameEmail: data.email === email,
        emailVerified: data.emailVerified === true,
        expectedPhone: data.phone === phone,
        expectedVerification:
          data.phoneVerified === (phone === null ? null : true),
        sameSubject:
          subject === undefined
            ? typeof claims.sub === "string" && claims.sub.length > 0
            : claims.sub === subject,
        subject: claims.sub as string,
      };
    },
    {
      email: state.email,
      phone: confirmed ? state.phone : null,
      subject: state.subject,
    },
  );
  const { subject, ...safe } = current;
  expect(safe, "same verified account retains its exact phone state").toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    emailVerified: true,
    expectedPhone: true,
    expectedVerification: true,
    sameSubject: true,
  });
  state.subject ??= subject;
  const cookie = (await state.context.cookies()).find(
    (value) => value.name === "__Host-ds_session",
  );
  expect(
    Boolean(cookie) &&
      (state.cookie === undefined || cookie!.value === state.cookie),
    "same private session is retained",
  ).toBe(true);
  state.cookie ??= cookie!.value;
}

interface Mail {
  ID?: string;
  Subject?: string;
  Created?: string;
  To?: { Address?: string }[];
  Text?: unknown;
  HTML?: unknown;
}
async function mailJson(state: NoticeJourney, path: string): Promise<unknown> {
  const response = await nativeRecoveryMail().get(
    `${state.mailbox.replace(/\/$/, "")}${path}`,
  );
  if (!response.ok()) throw new Error("Phone-notice mailbox request failed");
  try {
    return await response.json();
  } catch {
    throw new Error("Malformed phone-notice mailbox payload");
  }
}
async function notices(state: NoticeJourney): Promise<Mail[]> {
  if (!state.checkpoint)
    throw new Error("Phone-notice mailbox checkpoint is missing");
  const list = (await mailJson(
    state,
    `/api/v1/search?query=${encodeURIComponent(`to:${state.email}`)}&limit=1000`,
  )) as { messages?: Mail[]; messages_count?: number; start?: number };
  if (
    !list ||
    !Array.isArray(list.messages) ||
    list.messages_count !== list.messages.length ||
    list.start !== 0
  )
    throw new Error("Incomplete phone-notice mailbox search");
  const seen = new Set(state.checkpoint.messageIds);
  for (const message of list.messages) {
    if (
      !message ||
      typeof message.ID !== "string" ||
      !message.ID ||
      typeof message.Subject !== "string" ||
      !message.Created ||
      !Number.isFinite(Date.parse(message.Created)) ||
      !Array.isArray(message.To) ||
      message.To.some((to) => typeof to?.Address !== "string")
    )
      throw new Error("Invalid phone-notice mailbox search");
  }
  return list.messages.filter(
    (message) =>
      !seen.has(message.ID!) &&
      message.To!.some(
        (to) => to.Address!.toLowerCase() === state.email.toLowerCase(),
      ) &&
      message.Subject === SUBJECT,
  );
}
function noticeInstant(at: number): string {
  const options = { timeZone: "Europe/Moscow" };
  const date = new Intl.DateTimeFormat("ru-RU", {
    ...options,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("ru-RU", {
    ...options,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${date} в ${time} по московскому времени.`;
}

Given(
  "an owned verified Academy account is ready to confirm one fresh phone for its security notice",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("Phone-notice proof requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: NoticeJourney = {
      context,
      page: owned,
      email: `phone-notice-3027-${randomUUID()}@example.test`,
      phone: freshConfirmablePhone(),
      sink,
      mailbox: process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
    };
    journeys.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
    );
    const pending = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "owned email verified").toBe(200);
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);
    await assertIdentity(state, false);
  },
);

When(
  "that account confirms the fresh phone through its profile with the actual addressed SMS",
  async ({ page }) => {
    const state = journey(page);
    state.checkpoint = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      state.mailbox,
      state.email,
    );
    state.started = Date.now();
    await confirmOwnedPhone(state.page, {
      phone: state.phone,
      sink: state.sink,
    });
    state.completed = Date.now();
    await assertIdentity(state, true);
  },
);

Then(
  "exactly one addressed phone-success notice over twenty seconds has truthful time and recovery advice without a code phone or link",
  async ({ page }) => {
    const state = journey(page);
    if (state.started === undefined || state.completed === undefined)
      throw new Error("Phone-confirmation action interval is missing");
    const deadline = Date.now() + 20_000;
    let noticeId: string | undefined;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      const found = await notices(state);
      expect(
        found.length <= 1,
        "at most one fresh addressed success notice throughout observation",
      ).toBe(true);
      if (found.length === 1) {
        expect(
          noticeId === undefined || noticeId === found[0]!.ID,
          "the same sole notice persists",
        ).toBe(true);
        noticeId = found[0]!.ID;
      }
      if (finalObservation) {
        expect(
          found.length === 1,
          "exactly one fresh addressed success notice at the full horizon",
        ).toBe(true);
        break;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))),
      );
    }
    if (!noticeId) throw new Error("Phone-success notice is missing");
    const detail = (await mailJson(
      state,
      `/api/v1/message/${encodeURIComponent(noticeId)}`,
    )) as Mail;
    expect(
      Boolean(detail) &&
        detail.ID === noticeId &&
        detail.Subject === SUBJECT &&
        Array.isArray(detail.To) &&
        detail.To.length === 1 &&
        detail.To[0]?.Address?.toLowerCase() === state.email.toLowerCase() &&
        typeof detail.Text === "string" &&
        typeof detail.HTML === "string",
      "full actual notice belongs to the exact owned recipient and observed message",
    ).toBe(true);
    if (typeof detail.Text !== "string" || typeof detail.HTML !== "string")
      throw new Error("Phone-success notice body is missing");
    const instants = new Set<string>();
    for (let at = state.started; at <= state.completed; at += 1000)
      instants.add(noticeInstant(at));
    instants.add(noticeInstant(state.completed));
    const evidence = await state.page.evaluate(
      ({ text, html, phone, instants }) => {
        const document = new DOMParser().parseFromString(html, "text/html");
        const htmlText = document.body.textContent ?? "";
        const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
        const bodies = [normalize(text), normalize(htmlText)];
        const recovery =
          "Если это были не вы, восстановите пароль на странице входа («Забыли пароль?») — после смены пароля все сеансы входа завершатся.";
        const timestamps = bodies.map((body) =>
          instants.filter((instant) => body.includes(instant)),
        );
        return {
          addition: bodies.every((body) =>
            body.includes(
              "В вашем аккаунте Doctor.School добавлен или изменён номер телефона:",
            ),
          ),
          truthfulMatchingTime:
            timestamps.every((matches) => matches.length === 1) &&
            timestamps[0]![0] === timestamps[1]![0],
          recovery: bodies.every((body) => body.includes(recovery)),
          noCode: [text, html.replace(/#[\da-f]{6}\b/gi, ""), htmlText].every(
            (body) => !/\d{6}/.test(body),
          ),
          noPhone: [text, html, htmlText].every(
            (body) =>
              !body.includes(phone) && !/\+?\d[\d\s().-]{8,}\d/.test(body),
          ),
          noLinks:
            document.querySelectorAll("a,area,button,[href],[onclick],form")
              .length === 0 &&
            bodies.every((body) => !/https?:\/\/|www\./i.test(body)),
        };
      },
      {
        text: detail.Text,
        html: detail.HTML,
        phone: state.phone,
        instants: [...instants],
      },
    );
    expect(
      evidence,
      "actual complete text and HTML satisfy the security-notice contract",
    ).toEqual({
      addition: true,
      truthfulMatchingTime: true,
      recovery: true,
      noCode: true,
      noPhone: true,
      noLinks: true,
    });
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    await assertIdentity(state, true);
  },
);

After("@phone-confirmation-notice", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      const evidence = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(evidence, "owned notice session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    await state.context.close();
    journeys.delete(page);
  }
});
