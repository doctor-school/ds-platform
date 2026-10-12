import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface OwnedProfile {
  context: BrowserContext;
  page: Page;
  email: string;
  password: string;
  displayName: string;
  authPosts: string[];
}
const profiles = new WeakMap<Page, OwnedProfile>();

function profile(key: Page): OwnedProfile {
  const state = profiles.get(key);
  if (!state) throw new Error("Owned account profile was not prepared");
  return state;
}

Given(
  "an authenticated doctor_guest user with a verified email and no attached phone",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: OwnedProfile = {
      context,
      page: owned,
      email: `profile-2766-${randomUUID()}@example.test`,
      password: `Profile-${randomUUID()}-aA1!`,
      displayName: "Анна Смирнова",
      authPosts: [],
    };
    profiles.set(page, state);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const registered = captureResponse(owned, "/v1/auth/register");
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const registration = await registered;
    expect(
      registrationEvidence(
        registration.response.request().postData() ?? "",
        registration.body,
        state,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    const accepted = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await accepted;
    expect(verified.response.status(), "fresh owned code accepted").toBe(200);
    expect(
      verificationEvidence(
        verified.response.request().postData() ?? "",
        verified.body,
        state,
        code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);

    const prepared = await owned.evaluate(
      async ({ email, displayName }) => {
        const saved = await fetch("/v1/me/display-name", {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName }),
        });
        const response = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        const own = await response.json();
        const sessionResponse = await fetch("/v1/auth/session", {
          credentials: "include",
        });
        const session = await sessionResponse.json();
        return {
          nameSaved: saved.ok,
          profileStatus: response.status,
          sameAccount: own.email === email,
          emailVerified: own.emailVerified === true,
          noPhone: own.phone === null && own.phoneVerified === null,
          nameMatches: own.displayName === displayName,
          sessionStatus: sessionResponse.status,
          doctorGuest:
            Array.isArray(session.roles) &&
            session.roles.includes("doctor_guest"),
        };
      },
      { email: state.email, displayName: state.displayName },
    );
    expect(
      prepared,
      "accepted code establishes the owned verified profile",
    ).toEqual({
      nameSaved: true,
      profileStatus: 200,
      sameAccount: true,
      emailVerified: true,
      noPhone: true,
      nameMatches: true,
      sessionStatus: 200,
      doctorGuest: true,
    });
  },
);

When(/^the user opens the \/account page$/, async ({ page, world }) => {
  const owned = profile(page).page;
  await owned.goto(`${world.hostBaseUrl}/account`, { waitUntil: "load" });
  await expect(owned.getByTestId("profile-name")).toBeVisible();
});

Then(
  "the page renders avatar initials and the display name with inline edit",
  async ({ page }) => {
    const state = profile(page);
    await expect(state.page.getByTestId("profile-avatar")).toHaveText("АС");
    await expect(state.page.getByTestId("profile-name")).toHaveText(
      state.displayName,
    );
    await expect(state.page.getByTestId("profile-name-edit")).toBeVisible();
    await expect(state.page.getByTestId("profile-name-edit")).toBeEnabled();
  },
);

Then("the email is shown with its verified state", async ({ page }) => {
  const state = profile(page);
  expect(
    await state.page
      .getByTestId("profile-email")
      .evaluate((element, email) => element.textContent === email, state.email),
    "rendered email belongs to the owned account",
  ).toBe(true);
  await expect(state.page.getByTestId("profile-email-verified")).toBeVisible();
  await expect(state.page.getByTestId("profile-email-verified")).toContainText(
    "подтверждён",
  );
});

Then('the phone row shows the explicit "не указан" state', async ({ page }) => {
  await expect(profile(page).page.getByTestId("profile-phone")).toHaveText(
    "не указан",
  );
});

Then(
  /^a change-password action hands off to the existing \/reset flow$/,
  async ({ page, world }) => {
    const owned = profile(page).page;
    await expect(
      owned.locator('input[autocomplete="new-password"]'),
    ).toHaveCount(0);
    const changePassword = owned.getByRole("link", { name: /Сменить пароль/ });
    await expect(changePassword).toBeVisible();
    await expect(changePassword).toHaveAttribute(
      "href",
      "/reset?returnTo=%2Faccount",
    );
    await changePassword.click();
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/reset" &&
        url.searchParams.get("returnTo") === "/account",
    );
    await expect(owned.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(owned.getByTestId("reset-request-submit")).toBeVisible();
    await owned.goBack({ waitUntil: "load" });
    await expect(owned).toHaveURL(`${world.hostBaseUrl}/account`);
    await expect(owned.getByTestId("profile-name")).toBeVisible();
  },
);

Then(
  'a link to "Мои события" and a sign-out action are present',
  async ({ page }) => {
    const owned = profile(page).page;
    const events = owned
      .getByRole("main")
      .getByRole("link", { name: /Мои события/ });
    await expect(events).toBeVisible();
    await expect(events).toBeEnabled();
    await expect(events).toHaveAttribute("href", "/account/events");
    await expect(owned.getByTestId("logout")).toBeVisible();
    await expect(owned.getByTestId("logout")).toBeEnabled();
  },
);

Then(
  /^no raw session claim \(sub, roles array, raw mfa boolean\) appears anywhere in the page$/,
  async ({ page }) => {
    const state = profile(page);
    await expect(state.page.getByTestId("session-sub")).toHaveCount(0);
    await expect(state.page.getByTestId("session-roles")).toHaveCount(0);
    const claims = await state.page.evaluate(async () => {
      const response = await fetch("/v1/auth/session", {
        credentials: "include",
      });
      const session = await response.json();
      const visible = document.body.innerText;
      const shapeMatches =
        typeof session.sub === "string" &&
        session.sub.length > 0 &&
        Array.isArray(session.roles) &&
        session.roles.length > 0 &&
        session.roles.every((role: unknown) => typeof role === "string") &&
        typeof session.mfa === "boolean";
      return {
        status: response.status,
        shapeMatches,
        subjectVisible: shapeMatches && visible.includes(session.sub),
        roleVisible:
          shapeMatches &&
          session.roles.some((role: string) => visible.includes(role)),
        claimLabelVisible: /\b(?:sub|roles|mfa)\b/i.test(visible),
        rawBooleanVisible: /\b(?:true|false)\b/i.test(visible),
      };
    });
    expect(
      claims,
      "visible page content contains no raw session claims",
    ).toEqual({
      status: 200,
      shapeMatches: true,
      subjectVisible: false,
      roleVisible: false,
      claimLabelVisible: false,
      rawBooleanVisible: false,
    });
    expect(
      state.authPosts,
      "profile inventory requests no reset or logout",
    ).toEqual(["/v1/auth/register", "/v1/auth/verify"]);
  },
);

After("@account-profile-surface", async ({ page }) => {
  const state = profiles.get(page);
  if (!state) return;
  try {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    profiles.delete(page);
  }
});
