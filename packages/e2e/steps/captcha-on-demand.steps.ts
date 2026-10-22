import {
  isAuthCommandPath,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  emitProvider,
  installOnDemandProvider,
  providerCalls,
  tokenMatchesCall,
} from "../lib/captcha-on-demand.js";
import { inputSecret } from "../lib/owned-registration.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

interface Send {
  pathname: string;
  token: string;
  body: Record<string, unknown>;
}
interface Observation {
  context: BrowserContext;
  pages: Page[];
  results: string[];
  idle: number;
  interaction: number;
  duplicates: number;
}
const observations = new WeakMap<Page, Observation>();
function observation(page: Page) {
  const state = observations.get(page);
  if (!state) throw new Error("S064 observation missing");
  return state;
}

async function idle(page: Page, state: Observation) {
  expect(
    await providerCalls(page),
    "idle form has executed no challenge",
  ).toEqual([]);
  await expect(
    page.getByRole("checkbox", { name: /captcha|капч|робот/i }),
  ).toHaveCount(0);
  await expect(page.locator("[data-s064-challenge]")).toHaveCount(0);
  state.idle++;
}

async function installClock(page: Page) {
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 60_000));
}

async function protectedSend(
  page: Page,
  state: Observation,
  sends: Send[],
  label: string,
  pathname: string,
  trigger: () => Promise<void>,
  matches: (body: Record<string, unknown>) => boolean,
  interaction: boolean,
) {
  const index = (await providerCalls(page)).length;
  const before = sends.length;
  await trigger();
  await expect
    .poll(async () => (await providerCalls(page)).length)
    .toBe(index + 1);
  expect(sends.length, "protected request waits for provider proof").toBe(
    before,
  );
  const calls = await providerCalls(page);
  if (index > 0) {
    await emitProvider(page, index - 1, "success", true);
    expect(
      sends.length,
      "retired callback cannot consume a newer pending action",
    ).toBe(before);
  }
  if (!calls[index]) throw new Error("S064 pending provider instance missing");
  expect(
    calls[index].invisible,
    "official adapter requested invisible mode",
  ).toBe(true);
  expect(
    new Set(calls.map((call) => call.id)).size,
    "new provider instance for every send",
  ).toBe(calls.length);
  await expect(page.locator("[data-s064-challenge]")).toHaveCount(0);
  if (interaction) {
    await emitProvider(page, index, "challenge-visible");
    await expect(
      page.getByTitle("S064 deterministic provider interaction"),
    ).toBeVisible();
    expect(sends.length, "interaction event does not submit the action").toBe(
      before,
    );
    state.interaction++;
  }
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === pathname,
  );
  // Both callbacks run in one browser turn, before the first network action settles.
  await emitProvider(page, index, "success", true);
  const response = await accepted;
  let errorCode = "none";
  if (!response.ok()) {
    const body: unknown = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "code" in body &&
      typeof body.code === "string" &&
      /^[A-Z][A-Z0-9_]{1,79}$/.test(body.code)
    ) {
      errorCode = body.code;
    }
  }
  expect(
    response.ok(),
    `real protected send ${label}: path=${pathname}, status=${response.status()}, code=${errorCode}`,
  ).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(
    sends.length,
    "first success resumes exactly one captured action",
  ).toBe(before + 1);
  const sent = sends[before];
  if (!sent) throw new Error("S064 captured protected send missing");
  expect(
    sent.pathname === pathname && matches(sent.body),
    "captured action retains its original values",
  ).toBe(true);
  expect(
    await tokenMatchesCall(page, index, sent.token),
    "request carries its fresh callback token",
  ).toBe(true);
  if (process.env.BOT_PROTECTION_ENABLED === "false") {
    expect(
      sends.slice(0, before).every((prior) => prior.token !== sent.token),
      "BOTOFF browser probe: resend never reuses an earlier token",
    ).toBe(true);
  }
  await expect(page.locator("[data-s064-challenge]")).toHaveCount(0);
  // Exercise the saved callback with its already-used token again after settlement.
  await emitProvider(page, index, "success", true);
  await page.clock.runFor(50);
  expect(
    sends.length,
    "duplicate and used-token callbacks cannot replay a settled send",
  ).toBe(before + 1);
  expect(
    (await providerCalls(page)).length,
    "success returns the provider to idle",
  ).toBe(index + 1);
  state.duplicates++;
  state.results.push(label);
}

Given(
  "no permanent CAPTCHA checkbox is rendered in the auth form",
  async ({ page, browser, httpCredentials, world }) => {
    test.setTimeout(180_000);
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: Observation = {
      context,
      pages: [],
      results: [],
      idle: 0,
      interaction: 0,
      duplicates: 0,
    };
    observations.set(page, state);
    const owned = await context.newPage();
    state.pages.push(owned);
    await installOnDemandProvider(owned);
    await installClock(owned);
    await owned.goto(`${world.hostBaseUrl}/register`, {
      waitUntil: "networkidle",
    });
    await idle(owned, state);
  },
);

When(
  "a visitor submits registration, requests an initial login or reset code, or clicks any code resend",
  async ({ page, world }) => {
    const state = observation(page);
    const email = `captcha-3241-${randomUUID()}@example.test`;
    const password = `Captcha-${randomUUID()}-aA1!`;
    // Unregistered targets exercise the real enumeration-safe send doors without
    // sending provider SMS or modifying a shared seeded account.
    for (const variant of [
      "register",
      "email-login",
      "sms-login",
      "email-reset",
      "sms-reset",
    ] as const) {
      const owned =
        variant === "register" ? state.pages[0] : await state.context.newPage();
      if (!owned) throw new Error("S064 registration page missing");
      if (variant !== "register") {
        state.pages.push(owned);
        await installOnDemandProvider(owned);
        await installClock(owned);
        await owned.goto(
          `${world.hostBaseUrl}/${variant.endsWith("login") ? "login?method=code" : "reset"}`,
          { waitUntil: "networkidle" },
        );
        await idle(owned, state);
      }
      const sends: Send[] = [];
      owned.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (request.method() !== "POST" || !isAuthCommandPath(pathname)) return;
        sends.push({
          pathname,
          token: request.headers()["x-smartcaptcha-token"] ?? "",
          body: JSON.parse(request.postData() ?? "{}") as Record<
            string,
            unknown
          >,
        });
      });
      const identifier = variant.startsWith("sms")
        ? `+7999${String(parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 10_000_000).padStart(7, "0")}`
        : variant === "register"
          ? email
          : `captcha-${variant}-3241-${randomUUID()}@example.test`;
      let path: string;
      let submit: string;
      let resend: string;
      let matches: (body: Record<string, unknown>) => boolean;
      if (variant === "register") {
        await inputSecret(owned.locator('input[autocomplete="email"]'), email);
        await inputSecret(
          owned.locator('input[autocomplete="new-password"]'),
          password,
        );
        path = signInHostApiPath("/v1/auth/register");
        submit = "register-submit";
        resend = "verify-resend";
        matches = (body) => body.email === email && body.password === password;
      } else if (variant.endsWith("login")) {
        if (variant === "sms-login")
          await owned.getByTestId("otp-channel-sms").click();
        await inputSecret(owned.getByTestId("otp-identifier"), identifier);
        path = signInHostApiPath("/v1/auth/login/otp/request");
        submit = "otp-send";
        resend = "otp-resend";
        matches = (body) =>
          body.identifier === identifier &&
          body.channel === (variant === "sms-login" ? "sms" : "email");
      } else {
        await inputSecret(
          owned.locator('input[autocomplete="username"]'),
          identifier,
        );
        path = signInHostApiPath("/v1/auth/password/reset");
        submit = "reset-request-submit";
        resend = "reset-resend";
        matches = (body) => body.identifier === identifier;
      }
      await protectedSend(
        owned,
        state,
        sends,
        `${variant}:initial`,
        path,
        () => owned.getByTestId(submit).click(),
        matches,
        false,
      );
      await expect(owned.getByTestId(resend)).toBeVisible();
      // Each interval decrements React state once; fastForward deliberately
      // coalesces intervals, so drive every synthetic second instead.
      for (let second = 0; second < 61; second++) {
        if (await owned.getByTestId(resend).isEnabled()) break;
        await owned.clock.runFor(1000);
        await owned.evaluate(
          () => new Promise<void>((resolve) => queueMicrotask(resolve)),
        );
      }
      await expect(owned.getByTestId(resend)).toBeEnabled();
      await protectedSend(
        owned,
        state,
        sends,
        `${variant}:resend`,
        variant === "register"
          ? signInHostApiPath("/v1/auth/verify/resend")
          : path,
        () => owned.getByTestId(resend).click(),
        variant === "register" ? (body) => body.identifier === email : matches,
        true,
      );
      await owned.clock.resume();
    }
  },
);

Then(
  "the portal executes a fresh provider-native invisible SmartCaptcha check",
  async ({ page }) => {
    expect(observation(page).results).toEqual([
      "register:initial",
      "register:resend",
      "email-login:initial",
      "email-login:resend",
      "sms-login:initial",
      "sms-login:resend",
      "email-reset:initial",
      "email-reset:resend",
      "sms-reset:initial",
      "sms-reset:resend",
    ]);
    expect(observation(page).idle).toBe(5);
  },
);
Then(
  "provider challenge UI appears only if Yandex requires interaction",
  async ({ page }) => {
    expect(
      observation(page).interaction,
      "five explicit provider interaction events; all initial sends stay invisible",
    ).toBe(5);
  },
);
Then(
  "the first success callback resumes that pending action exactly once with the fresh token",
  async ({ page }) => {
    expect(observation(page).results.length).toBe(10);
  },
);
Then(
  "duplicate callbacks or a previously used token cannot replay the action",
  async ({ page }) => {
    expect(observation(page).duplicates).toBe(10);
  },
);
After("@captcha-on-demand", async ({ page }) => {
  const state = observations.get(page);
  if (!state) return;
  observations.delete(page);
  await state.context.close();
});
