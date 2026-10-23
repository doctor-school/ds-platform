import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomInt, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
} from "../lib/owned-registration.js";
import {
  readOwnedPhoneAccountCount,
  type OwnedAuthContour,
} from "../lib/owned-auth-observation.js";
import {
  captureSmsCheckpoint,
  smsOrigin,
  smsSinkMessages,
  smsSinkUrl,
  type SmsCheckpoint,
} from "../lib/sms-sink.js";
import {
  expectEnteredThrough,
  lastStorefrontEntry,
  watchStorefrontEntries,
} from "../lib/storefront-entry-watch.js";
import { Given, Then, When, test } from "./support/auth-fixtures.js";

const SMS_HINT =
  "Код по SMS придёт, только если телефон подтверждён в профиле. Если нет — выберите «Эл.\u00a0почта».";
interface SmsVisitor {
  phone: string;
  sink: string;
  email: string;
  password: string;
  requestedAt?: SmsCheckpoint;
  setCookie?: string;
}
const visitors = new WeakMap<Page, SmsVisitor>();
function visitor(page: Page): SmsVisitor {
  const state = visitors.get(page);
  if (!state) throw new Error("SMS sign-in visitor was not prepared");
  return state;
}

async function assertUnconfirmedPhone(page: Page, state: SmsVisitor) {
  const contour: OwnedAuthContour = {
    academyBaseUrl: process.env.E2E_PORTAL_URL ?? "",
    apiBaseUrl: process.env.E2E_API_URL ?? "",
    databaseUrl: process.env.E2E_AUTH_DATABASE_URL ?? "",
    expectedDatabase: process.env.E2E_AUTH_DATABASE_NAME ?? "",
    expectedDatabaseHost: process.env.E2E_AUTH_DATABASE_HOST ?? "",
    expectedDatabasePort: Number(process.env.E2E_AUTH_DATABASE_PORT),
  };
  // #3172: the code door is the sign-in host's; the Academy contour is the
  // storefront whose entry opened it.
  expect(
    contour.academyBaseUrl.replace(/\/$/, "") ===
      lastStorefrontEntry(page)?.origin,
    "the phone observer belongs to the actual Academy contour",
  ).toBe(true);
  // No account mirror at all carries the owned phone, so none has it confirmed.
  expect(
    await readOwnedPhoneAccountCount(contour, {
      email: state.email,
      phones: [state.phone],
    }),
    "the owned phone has no account mirror",
  ).toBe(0);
}

async function noPrivateAccess(page: Page, state: SmsVisitor) {
  await assertNoPrivateRegistrationAccess(page, state.setCookie ?? "", state);
  expect(
    await page.evaluate(
      async () =>
        (await fetch("/v1/auth/session", { credentials: "include" })).status,
    ),
    "SMS request creates no private principal",
  ).toBe(401);
}

Given(
  "a fresh Academy guest opens login by code with a unique unconfirmed phone",
  async ({ page, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink) throw new Error("SMS sign-in requires E2E_SMS_SINK_URL");
    const state: SmsVisitor = {
      // Synthetic owned phone: the request must be neutrally accepted, never delivered.
      phone: `+1999${randomInt(10_000_000, 100_000_000)}`,
      sink,
      email: `sms-hint-2990-${randomUUID()}@example.test`,
      password: `Unsubmitted-${randomUUID()}-aA1!`,
    };
    visitors.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({ issue: 2990, phone: state.phone }),
      contentType: "application/json",
    });
    // A missing or unreadable sink must fail before it can prove absence.
    expect(
      (await smsSinkMessages(sink, state.phone, smsOrigin(state.phone))).length,
    ).toBe(0);
    const target = new URL(
      "/login?method=code&returnTo=%2Faccount",
      world.hostBaseUrl,
    );
    await prepareCaptchaForJourney(
      page.context(),
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    watchStorefrontEntries(page, world.hostBaseUrl);
    await page.goto(target.toString(), { waitUntil: "load" });
    await page.waitForLoadState("networkidle");
    expectEnteredThrough(page, world.hostBaseUrl, {
      pathname: "/login",
      method: "code",
      returnTo: "/account",
    });
    await expect(page.getByTestId("login-method-otp")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await noPrivateAccess(page, state);
    await assertUnconfirmedPhone(page, state);
  },
);

When(
  "the Academy guest selects the real SMS sign-in channel",
  async ({ page }) => {
    await expect(page.getByText(SMS_HINT, { exact: true })).toHaveCount(0);
    await page.getByTestId("otp-channel-sms").click();
  },
);

Then(
  "Academy shows the exact static SMS eligibility hint associated with the channel switch",
  async ({ page }) => {
    const hint = page.getByText(SMS_HINT, { exact: true });
    const field = page.getByTestId("otp-identifier");
    await expect(page.getByTestId("otp-channel-sms")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(field).toHaveAttribute("type", "tel");
    await expect(hint).toBeVisible();
    expect(
      await hint.textContent(),
      "approved sentence including its non-breaking space",
    ).toBe(SMS_HINT);
    const id = await hint.getAttribute("id");
    expect(Boolean(id), "hint has an accessible description id").toBe(true);
    expect(
      (
        await page
          .getByRole("radiogroup", { name: "Канал кода" })
          .getAttribute("aria-describedby")
      )?.split(/\s+/),
      "channel switch describes its SMS eligibility hint",
    ).toContain(id);
    await inputSecret(field, visitor(page).phone);
    expect(
      await hint.textContent(),
      "typing never changes the eligibility hint",
    ).toBe(SMS_HINT);
    await page.getByTestId("otp-channel-email").click();
    await expect(hint).toHaveCount(0);
    await page.getByTestId("otp-channel-sms").click();
    await expect(hint).toBeVisible();
    await inputSecret(field, visitor(page).phone);
  },
);

When(
  "the Academy guest requests an SMS sign-in code for that phone",
  async ({ page }) => {
    const state = visitor(page);
    state.requestedAt = await captureSmsCheckpoint(state.sink, state.phone);
    const pending = captureResponse(
      page,
      signInHostApiPath("/v1/auth/login/otp/request"),
    );
    await page.getByTestId("otp-send").click();
    const captured = await pending;
    let requestMatches = false;
    let neutral = false;
    try {
      const submitted = hostCommand(captured.response.request().postDataJSON());
      requestMatches =
        Object.keys(submitted).sort().join(",") === "channel,identifier" &&
        submitted.channel === "sms" &&
        submitted.identifier === state.phone;
      const body = JSON.parse(captured.body);
      neutral = Object.keys(body).length === 1 && body.status === "otp_sent";
    } catch {
      // Project only booleans so parser diagnostics cannot expose provider tokens.
    }
    expect({
      status: captured.response.status(),
      requestMatches,
      neutral,
    }).toEqual({ status: 200, requestMatches: true, neutral: true });
    state.setCookie = (await captured.response.headerValue("set-cookie")) ?? "";
  },
);

Then(
  "Academy offers the unchanged SMS code step without a private session or addressed SMS for twenty seconds",
  async ({ page }) => {
    const state = visitor(page);
    if (!state.requestedAt) throw new Error("SMS request was not observed");
    const code = page.locator('input[autocomplete="one-time-code"]');
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute("maxlength", "6");
    await expect(code).toHaveAttribute("inputmode", "numeric");
    expect((await code.inputValue()) === "", "no code is submitted").toBe(true);
    await expect(page.getByTestId("otp-verify")).toBeVisible();
    await expect(page.getByTestId("otp-change-method")).toBeEnabled();
    await expect(page.getByTestId("otp-resend")).toBeDisabled();
    await expect(
      page.getByTestId("login-screen").getByRole("alert"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Проверьте телефон" }),
    ).toBeVisible();
    await expect(
      page.getByText("Код действует 5 минут.", { exact: true }),
    ).toBeVisible();
    const deadline = Date.now() + 20_000;
    while (true) {
      const finalObservation = Date.now() >= deadline;
      expect(
        (await smsSinkMessages(state.sink, state.phone, state.requestedAt))
          .length,
        "no addressed SMS throughout the complete delivery horizon",
      ).toBe(0);
      if (finalObservation) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await noPrivateAccess(page, state);
  },
);
