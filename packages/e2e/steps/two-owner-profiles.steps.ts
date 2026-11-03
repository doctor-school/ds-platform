import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { STOREFRONT_SIGN_OUT_PATH } from "../lib/storefront-sign-out.js";
import {
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface Owner {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  displayName: string;
}
interface Journey {
  base: string;
  owners: Owner[];
}
const journeys = new WeakMap<Page, Journey>();
const SESSION = "__Host-ds_session";

function journey(page: Page): Journey {
  const state = journeys.get(page);
  if (!state || state.owners.length !== 2)
    throw new Error("Two owned profile browsers were not prepared");
  return state;
}

async function ownProfile(owned: Owner, other: Owner) {
  const evidence = await owned.page.evaluate(
    async ({ email, displayName, foreignEmail, foreignName }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await response.json().catch(() => ({}));
      const nameResponse = await fetch("/v1/me/display-name", {
        credentials: "include",
        cache: "no-store",
      });
      const name = await nameResponse.json().catch(() => ({}));
      const visible = document.body.innerText;
      return {
        status: response.status,
        ownEmail: profile.email === email,
        ownName: profile.displayName === displayName,
        verified: profile.emailVerified === true,
        noPhone: profile.phone === null && profile.phoneVerified === null,
        nameStatus: nameResponse.status,
        sameName: name.displayName === displayName,
        foreignProfileAbsent:
          !JSON.stringify(profile).includes(foreignEmail) &&
          !JSON.stringify(profile).includes(foreignName),
        foreignNameAbsent: !JSON.stringify(name).includes(foreignName),
        foreignIdentityNotRendered:
          !visible.includes(foreignEmail) && !visible.includes(foreignName),
      };
    },
    {
      email: owned.email,
      displayName: owned.displayName,
      foreignEmail: other.email,
      foreignName: other.displayName,
    },
  );
  expect(evidence, "both self reads retain only this browser's owner").toEqual({
    status: 200,
    ownEmail: true,
    ownName: true,
    verified: true,
    noPhone: true,
    nameStatus: 200,
    sameName: true,
    foreignProfileAbsent: true,
    foreignNameAbsent: true,
    foreignIdentityNotRendered: true,
  });
  expect(
    await owned.page
      .getByTestId("profile-email")
      .evaluate((element, email) => element.textContent === email, owned.email),
    "rendered email belongs to this browser's owner",
  ).toBe(true);
  await expect(owned.page.getByTestId("profile-name")).toHaveText(
    owned.displayName,
  );
  await expect(owned.page.getByTestId("profile-email-verified")).toBeVisible();
  await expect(owned.page.getByTestId("profile-phone")).toHaveText("не указан");
}

async function refusedProfile(owned: Owner) {
  const evidence = await owned.page.evaluate(async () => {
    const results = [];
    for (const path of ["/v1/me/profile", "/v1/me/display-name"]) {
      const response = await fetch(path, {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      results.push({
        status: response.status,
        generic:
          Object.keys(body).length === 3 &&
          body.statusCode === 401 &&
          body.error === "Unauthorized" &&
          body.message === "authentication required",
      });
    }
    return results;
  });
  expect(evidence, "logged-out browser has no private self reads").toEqual([
    { status: 401, generic: true },
    { status: 401, generic: true },
  ]);
  expect(
    (await owned.context.cookies()).some((cookie) => cookie.name === SESSION),
    "logged-out browser has no private session cookie",
  ).toBe(false);
}

async function reloadAccount(owned: Owner, base: string) {
  const document = await owned.page.reload({ waitUntil: "load" });
  expect(
    {
      status: document?.status(),
      navigation: document?.request().isNavigationRequest(),
      sameOrigin: new URL(owned.page.url()).origin === new URL(base).origin,
      account: new URL(owned.page.url()).pathname === "/account",
    },
    "real owned account document reload",
  ).toEqual({ status: 200, navigation: true, sameOrigin: true, account: true });
  await expect(owned.page.getByTestId("profile-name")).toBeVisible();
}

Given(
  "two independently registered and email-verified Academy browsers have distinct names saved through their account forms",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const state: Journey = { base: world.hostBaseUrl, owners: [] };
    journeys.set(page, state);
    for (const displayName of ["Анна Смирнова", "Борис Соколов"]) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      const owned: Owner = {
        context,
        page: await context.newPage(),
        email: `two-profiles-3203-${randomUUID()}@example.test`,
        password: `Owned-${randomUUID()}-aA1!`,
        displayName,
      };
      state.owners.push(owned);
      await prepareCaptchaForJourney(
        context,
        state.base,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const registered = captureResponse(
        owned.page,
        signInHostApiPath("/v1/auth/register"),
      );
      const { code } = await registerOwnedCredentials(
        owned.page,
        state.base,
        owned,
        "/account",
      );
      const registration = await registered;
      expect(
        registrationEvidence(
          registration.response.request().postData() ?? "",
          registration.body,
          owned,
        ),
      ).toEqual({
        credentialsMatch: true,
        consentMatches: true,
        acknowledgementMatches: true,
      });
      const pending = captureResponse(
        owned.page,
        signInHostApiPath("/v1/auth/verify"),
      );
      await inputSecret(
        owned.page.locator('input[autocomplete="one-time-code"]'),
        code,
      );
      const verified = await pending;
      expect(verified.response.status(), "owned verification accepted").toBe(
        200,
      );
      expect(
        verificationEvidence(
          verified.response.request().postData() ?? "",
          verified.body,
          owned,
          code,
          world.hostBaseUrl,
        ),
      ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
      await owned.page.waitForURL(
        (url) =>
          url.origin === new URL(state.base).origin &&
          url.pathname === "/account",
      );
      await assertSecureSession(owned.page, verified.response, state.base);
      await owned.page.getByTestId("profile-name-edit").click();
      await owned.page.getByTestId("profile-name-input").fill(displayName);
      const saving = owned.page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/me/display-name" &&
          response.request().method() === "PUT",
      );
      await owned.page.getByTestId("profile-name-save").click();
      const saved = await saving;
      expect(saved.status(), "owned inline name save accepted").toBe(200);
      await expect(owned.page.getByTestId("profile-name")).toHaveText(
        displayName,
      );
    }
    expect(
      state.owners[0]!.context !== state.owners[1]!.context,
      "owners use independent browser contexts",
    ).toBe(true);
    expect(
      state.owners[0]!.email !== state.owners[1]!.email,
      "owners have distinct registered identifiers",
    ).toBe(true);
    for (const [index, owned] of state.owners.entries())
      await ownProfile(owned, state.owners[1 - index]!);
  },
);

When(
  "both Academy browsers reload their actual account documents",
  async ({ page }) => {
    const state = journey(page);
    for (const [index, owned] of state.owners.entries()) {
      await reloadAccount(owned, state.base);
      await ownProfile(owned, state.owners[1 - index]!);
    }
  },
);

Then(
  "each browser retains only its own verified profile and signing out either owner leaves the other isolated",
  async ({ page }) => {
    const state = journey(page);
    const first = state.owners[0]!;
    const second = state.owners[1]!;
    for (const owned of [first, second]) {
      const pending = captureResponse(owned.page, STOREFRONT_SIGN_OUT_PATH);
      await owned.page.getByTestId("logout").click();
      const loggedOut = await pending;
      expect(loggedOut.response.status(), "owned UI logout accepted").toBe(200);
      await owned.page.waitForURL(
        (url) =>
          url.origin === new URL(state.base).origin && url.pathname === "/",
      );
      await refusedProfile(owned);
      if (owned === first) {
        await reloadAccount(second, state.base);
        await ownProfile(second, first);
      }
    }
    await refusedProfile(first);
  },
);

After("@two-owner-profiles", async ({ page, $testInfo }) => {
  const state = journeys.get(page);
  if (!state) return;
  let failed = false;
  for (const owned of state.owners) {
    try {
      if (
        (await owned.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        if (owned.page.isClosed()) owned.page = await owned.context.newPage();
        if (!owned.page.url().startsWith(`${state.base}/`))
          await owned.page.goto(`${state.base}/`);
        const status = await owned.page.evaluate(
          async () =>
            (
              await fetch("/v1/auth/logout", {
                method: "POST",
                credentials: "include",
              })
            ).status,
        );
        expect(status, "owned cleanup logout accepted").toBe(200);
        await refusedProfile(owned);
      }
    } catch {
      failed = true;
    } finally {
      owned.password = "";
      await owned.context.close().catch(() => {
        failed = true;
      });
    }
  }
  journeys.delete(page);
  if (failed) {
    if ($testInfo.status !== $testInfo.expectedStatus)
      $testInfo.annotations.push({
        type: "owned-cleanup",
        description:
          "Two-owner profile session cleanup failed; lead must audit the owned fixture",
      });
    else throw new Error("Two-owner profile session cleanup failed");
  }
});
