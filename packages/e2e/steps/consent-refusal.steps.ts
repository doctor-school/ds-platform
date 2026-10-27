import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  captchaTestTokenFromEnv,
  installCaptchaStub,
} from "../lib/captcha-stub.js";
import { sendHostCommandFromForm } from "../lib/captured-response.js";
import { ownedMirrorCount } from "../lib/consent-refusal.js";
import {
  assertNoPrivateRegistrationAccess,
  consentRefusalEvidence,
  inputSecret,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface ConsentRefusal extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  status?: number;
  setCookie?: string;
  evidence?: ReturnType<typeof consentRefusalEvidence>;
}
const refusals = new WeakMap<Page, ConsentRefusal>();
function refusal(key: Page): ConsentRefusal {
  const state = refusals.get(key);
  if (!state) throw new Error("Owned consent-refusal visitor was not prepared");
  return state;
}

Given(
  "an Academy visitor with unique owned credentials for the consent-refusal request",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state = {
      context,
      page: owned,
      email: `register-2704-${randomUUID()}@example.test`,
      password: `Register-${randomUUID()}-aA1!`,
    };
    refusals.set(page, state);
    await installCaptchaStub(context);
    await owned.goto(`${world.hostBaseUrl}/register`, { waitUntil: "load" });
    await owned.waitForLoadState("networkidle");
    await inputSecret(
      owned.locator('input[autocomplete="email"]'),
      state.email,
    );
    await inputSecret(
      owned.locator('input[autocomplete="new-password"]'),
      state.password,
    );
    expect(
      await ownedMirrorCount(world.hostBaseUrl, state.email),
      "unique address has no pre-existing mirror",
    ).toBe(0);
  },
);

When(
  "that browser sends a real Academy BFF registration request without any accepted consent version",
  async ({ page }) => {
    const state = refusal(page);
    // 003 EARS-20: this is a BFF omission probe, not the Academy form's consent
    // projection. #3172 — the registration BFF is the sign-in host's, which
    // takes a command only as the door's own form post (authRequest + csrf),
    // so the probe rides the door's real submit with its body replaced.
    const { response, body, sent } = await sendHostCommandFromForm(
      state.page,
      signInHostApiPath("/v1/auth/register"),
      { email: state.email, password: state.password, consent: [] },
      () => state.page.getByTestId("register-submit").click(),
      { "x-smartcaptcha-token": captchaTestTokenFromEnv() },
    );
    state.status = response.status();
    state.setCookie = (await response.headerValue("set-cookie")) ?? "";
    state.evidence = consentRefusalEvidence(sent, body, state);
  },
);

Then(
  "the consent-free registration request receives the generic validation failure",
  async ({ page }) => {
    const state = refusal(page);
    expect(state.status, "empty accepted consent refused by the BFF").toBe(400);
    expect(state.evidence).toEqual({
      credentialsMatch: true,
      consentAbsent: true,
      refusalMatches: true,
    });
  },
);

Then(
  "no PD-bearing UserMirror row exists for that exact owned registration address",
  async ({ page, world }) => {
    expect(
      await ownedMirrorCount(world.hostBaseUrl, refusal(page).email),
      "no owned PD-bearing mirror after refusal",
    ).toBe(0);
  },
);

Then(
  "the refused registrant has no private session, profile access, password or token exposure",
  async ({ page }) => {
    const state = refusal(page);
    await assertNoPrivateRegistrationAccess(
      state.page,
      state.setCookie ?? "",
      state,
    );
  },
);

After("@consent-refusal", async ({ page }) => {
  const state = refusals.get(page);
  if (!state) return;
  try {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    refusals.delete(page);
  }
});
