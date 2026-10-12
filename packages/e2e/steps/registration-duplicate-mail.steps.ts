import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  fetchRecoveryMail,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  registrationUrl,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface RegistrationObservation {
  requestedAt: string;
  status: number;
  evidence: ReturnType<typeof registrationEvidence>;
}

interface DuplicateRegistration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  initial?: Omit<RegistrationObservation, "requestedAt">;
  firstDuplicate?: RegistrationObservation;
  repeated?: RegistrationObservation;
}

const duplicates = new WeakMap<Page, DuplicateRegistration>();

function duplicate(key: Page): DuplicateRegistration {
  const state = duplicates.get(key);
  if (!state) throw new Error("Owned duplicate registration was not prepared");
  return state;
}

async function submitDuplicate(
  state: DuplicateRegistration,
  base: string,
): Promise<RegistrationObservation> {
  const page = state.page;
  await page.goto(registrationUrl(base), { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await inputSecret(page.locator('input[autocomplete="email"]'), state.email);
  await inputSecret(
    page.locator('input[autocomplete="new-password"]'),
    state.password,
  );
  const requestedAt = new Date().toISOString();
  const pending = captureResponse(page, "/v1/auth/register");
  await page.getByTestId("register-submit").click();
  const captured = await pending;
  const evidence = registrationEvidence(
    captured.response.request().postData() ?? "",
    captured.body,
    state,
  );
  expect(evidence, "duplicate registration targets the owned mailbox").toEqual({
    credentialsMatch: true,
    consentMatches: true,
    acknowledgementMatches: true,
  });
  expect(captured.response.status(), "neutral registration accepted").toBe(200);
  await page.waitForURL(
    (url) => url.origin === new URL(base).origin && url.pathname === "/verify",
  );
  await page.waitForLoadState("networkidle");
  expect(
    new URL(page.url()).searchParams.get("email") === state.email,
    "code step retains the submitted mailbox",
  ).toBe(true);
  const code = page.locator('input[autocomplete="one-time-code"]');
  await expect(code).toBeVisible();
  expect((await code.inputValue()) === "", "no code is consumed").toBe(true);
  await assertNoPrivateRegistrationAccess(
    page,
    (await captured.response.headerValue("set-cookie")) ?? "",
    state,
  );
  return { requestedAt, status: captured.response.status(), evidence };
}

Given(
  "an Academy email registered by this scenario with a never-registered response observed",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const account: OwnedCredentials = {
      email: `duplicate-2825-${randomUUID()}@example.test`,
      password: `Duplicate-${randomUUID()}-aA1!`,
    };
    const state: DuplicateRegistration = {
      ...account,
      context,
      page: owned,
    };
    duplicates.set(page, state);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const captured = captureResponse(owned, "/v1/auth/register");
    const { response, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      account,
    );
    const initial = await captured;
    state.initial = {
      status: response.status(),
      evidence: registrationEvidence(
        initial.response.request().postData() ?? "",
        initial.body,
        account,
      ),
    };
    expect(state.initial.status, "never-registered response accepted").toBe(
      200,
    );
    expect(state.initial.evidence).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    expect(/^\d{6}$/.test(code), "fresh account creation mail delivered").toBe(
      true,
    );
    await assertNoPrivateRegistrationAccess(
      owned,
      (await response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Given(
  "a fresh re-registration code mail was delivered for the first duplicate Academy submission",
  async ({ page, world }) => {
    const state = duplicate(page);
    state.firstDuplicate = await submitDuplicate(state, world.hostBaseUrl);
    const mail = await fetchRecoveryMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.firstDuplicate.requestedAt,
      "login",
    );
    const duplicateCopy = "Этот адрес уже зарегистрирован в Doctor.School";
    expect(
      {
        sixDigits: /^\d{6}$/.test(mail.code),
        textMatches:
          typeof mail.text === "string" &&
          mail.text.includes(duplicateCopy) &&
          mail.text.includes(mail.code),
        htmlMatches:
          typeof mail.html === "string" &&
          mail.html.includes(duplicateCopy) &&
          mail.html.includes(mail.code),
      },
      "fresh addressed duplicate mail carries its code in both bodies",
    ).toEqual({ sixDigits: true, textMatches: true, htmlMatches: true });
  },
);

When(
  "the visitor submits the Academy registration form for that email again within the real throttle window",
  async ({ page, world }) => {
    const state = duplicate(page);
    if (!state.firstDuplicate)
      throw new Error("First duplicate registration was not observed");
    state.repeated = await submitDuplicate(state, world.hostBaseUrl);
    // 003 EARS-23: register-notice-throttle.ts owns the unchanged 900-second window.
    expect(
      Date.parse(state.repeated.requestedAt) -
        Date.parse(state.firstDuplicate.requestedAt) <
        900_000,
      "actual repeat occurred inside the production throttle window",
    ).toBe(true);
  },
);

Then(
  "no second addressed code mail is sent over the full delivery horizon inside that throttle window",
  async ({ page, world }) => {
    const state = duplicate(page);
    if (!state.initial || !state.firstDuplicate || !state.repeated)
      throw new Error("Duplicate registration comparison is incomplete");
    await assertNoAddressedMail(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      state.email,
      state.repeated.requestedAt,
    );
    expect(
      Date.now() - Date.parse(state.firstDuplicate.requestedAt) < 900_000,
      "full negative mail horizon remains inside the real throttle window",
    ).toBe(true);
  },
);

Then(
  "the duplicate registration API responses remain indistinguishable from the observed never-registered response",
  async ({ page }) => {
    const state = duplicate(page);
    if (!state.initial || !state.firstDuplicate || !state.repeated)
      throw new Error("Duplicate registration comparison is incomplete");
    for (const observed of [state.firstDuplicate, state.repeated]) {
      expect(observed.status).toBe(state.initial.status);
      expect(observed.evidence).toEqual(state.initial.evidence);
    }
  },
);

After("@registration-duplicate-mail", async ({ page }) => {
  const state = duplicates.get(page);
  if (!state) return;
  try {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    duplicates.delete(page);
  }
});
