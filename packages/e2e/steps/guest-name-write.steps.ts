import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface Journey extends OwnedCredentials {
  base: string;
  owner: Page;
  contexts: BrowserContext[];
  guest?: Page;
  displayName: string;
  attemptedName: string;
}
const journeys = new WeakMap<Page, Journey>();
function journey(page: Page) {
  const state = journeys.get(page);
  if (!state) throw new Error("Guest name-write owner was not prepared");
  return state;
}

async function assertOwner(state: Journey) {
  const evidence = await state.owner.evaluate(
    async ({ email, displayName }) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await profile.json();
      const name = await fetch("/v1/me/display-name", {
        credentials: "include",
        cache: "no-store",
      });
      const nameBody = await name.json();
      return {
        profileStatus: profile.status,
        nameStatus: name.status,
        sameOwner: body.email === email,
        verified: body.emailVerified === true,
        unchangedName:
          body.displayName === displayName &&
          nameBody.displayName === displayName,
        renderedOwner:
          document.querySelector('[data-testid="profile-email"]')
            ?.textContent === email,
      };
    },
    { email: state.email, displayName: state.displayName },
  );
  expect(
    evidence,
    "fresh self reads and rendered identity retain the owner",
  ).toEqual({
    profileStatus: 200,
    nameStatus: 200,
    sameOwner: true,
    verified: true,
    unchangedName: true,
    renderedOwner: true,
  });
  await expect(state.owner.getByTestId("profile-name")).toHaveText(
    state.displayName,
  );
  await expect(state.owner.getByTestId("profile-email-verified")).toBeVisible();
}

async function assertGuest(state: Journey) {
  const visitor = state.guest!;
  const evidence = await visitor.evaluate(
    async ({ email, displayName, password }) => {
      const responses = [];
      for (const path of [
        "/v1/me/profile",
        "/v1/me/display-name",
        "/v1/auth/session",
      ]) {
        const response = await fetch(path, {
          credentials: "include",
          cache: "no-store",
        });
        const body = await response.text();
        responses.push({
          status: response.status,
          noSecrets:
            !body.includes(email) &&
            !body.includes(displayName) &&
            !body.includes(password) &&
            !/"(?:sub|roles|mfa|email|phone|displayName|access[_-]?token|refresh[_-]?token)"\s*:|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
              body,
            ),
        });
      }
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return {
        responses,
        readableSecret:
          readable.includes(email) ||
          readable.includes(displayName) ||
          readable.includes(password) ||
          /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
            readable,
          ),
      };
    },
    {
      email: state.email,
      displayName: state.displayName,
      password: state.password,
    },
  );
  expect(
    evidence,
    "guest has no private reads, identity or readable tokens",
  ).toEqual({
    responses: Array.from({ length: 3 }, () => ({
      status: 401,
      noSecrets: true,
    })),
    readableSecret: false,
  });
  expect(
    (await visitor.context().cookies()).some(
      (cookie) => cookie.name === SESSION,
    ),
    "guest has no private session cookie",
  ).toBe(false);
}

Given(
  "a verified Academy owner has a saved name before a separate guest write attempt",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: Journey = {
      base: world.hostBaseUrl,
      owner: await context.newPage(),
      contexts: [context],
      email: `guest-name-3222-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
      displayName: "Марина Волкова",
      attemptedName: "Гость Подменяет",
    };
    journeys.set(page, state);
    await prepareCaptchaForJourney(
      context,
      state.base,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const registering = captureResponse(state.owner, "/v1/auth/register");
    const { code } = await registerOwnedCredentials(
      state.owner,
      state.base,
      state,
      "/account",
    );
    const registration = await registering;
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
    await assertNoPrivateRegistrationAccess(
      state.owner,
      (await registration.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const verifying = captureResponse(state.owner, "/v1/auth/verify");
    await inputSecret(
      state.owner.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await verifying;
    expect(verified.response.status(), "owned verification accepted").toBe(200);
    expect(
      verificationEvidence(
        verified.response.request().postData() ?? "",
        verified.body,
        state,
        code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    await state.owner.waitForURL(
      (url) =>
        url.origin === new URL(state.base).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(state.owner, verified.response, state.base);
    await state.owner.getByTestId("profile-name-edit").click();
    await state.owner.getByTestId("profile-name-input").fill(state.displayName);
    const saving = state.owner.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/me/display-name" &&
        response.request().method() === "PUT",
    );
    await state.owner.getByTestId("profile-name-save").click();
    expect((await saving).status(), "owned name prerequisite saved").toBe(200);
    await expect(state.owner.getByTestId("profile-name")).toHaveText(
      state.displayName,
    );
    await assertOwner(state);
    const guestContext = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    state.contexts.push(guestContext);
    state.guest = await guestContext.newPage();
    expect(
      (await guestContext.cookies()).length,
      "fresh cookie-free guest",
    ).toBe(0);
    await state.guest.goto(`${state.base}/login`, { waitUntil: "load" });
    await expect(
      state.guest.getByTestId("password-login-submit"),
    ).toBeVisible();
    await assertGuest(state);
  },
);

When(
  "the separate cookie-free Academy guest submits a valid display-name PUT",
  async ({ page }) => {
    const state = journey(page);
    const evidence = await state.guest!.evaluate(
      async ({ attemptedName, email, displayName, password }) => {
        const response = await fetch("/v1/me/display-name", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: attemptedName }),
        });
        const text = await response.text();
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(text);
        } catch {
          /* Keep response diagnostics private. */
        }
        return {
          status: response.status,
          generic:
            Object.keys(body).sort().join(",") === "error,message,statusCode" &&
            body.statusCode === 401 &&
            body.error === "Unauthorized" &&
            body.message === "authentication required",
          noSecrets:
            !text.includes(email) &&
            !text.includes(displayName) &&
            !text.includes(password) &&
            !/"(?:sub|roles|mfa|email|phone|displayName|access[_-]?token|refresh[_-]?token)"\s*:|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
              text,
            ),
        };
      },
      {
        attemptedName: state.attemptedName,
        email: state.email,
        displayName: state.displayName,
        password: state.password,
      },
    );
    expect(
      evidence,
      "valid guest write receives only the generic unauthorized refusal",
    ).toEqual({ status: 401, generic: true, noSecrets: true });
  },
);

Then(
  "the guest write exposes no private access and the owner's fresh profile and reloaded account retain the saved name",
  async ({ page, world }) => {
    const state = journey(page);
    await assertGuest(state);
    await state.guest!.goto(`${state.base}/account`, { waitUntil: "load" });
    await state.guest!.waitForURL(
      (url) =>
        url.origin === new URL(state.base).origin &&
        url.pathname === world.host.loginPath,
    );
    await expect(
      state.guest!.getByTestId("password-login-submit"),
    ).toBeVisible();
    for (const id of [
      "profile-name",
      "profile-email",
      "profile-phone",
      "session-sub",
      "session-roles",
      "logout",
    ])
      await expect(state.guest!.getByTestId(id)).toHaveCount(0);
    await assertGuest(state);
    await assertOwner(state);
    const document = await state.owner.reload({ waitUntil: "load" });
    expect(
      {
        status: document?.status(),
        navigation: document?.request().isNavigationRequest(),
        sameOrigin:
          new URL(state.owner.url()).origin === new URL(state.base).origin,
        account: new URL(state.owner.url()).pathname === "/account",
      },
      "real owner account reload",
    ).toEqual({
      status: 200,
      navigation: true,
      sameOrigin: true,
      account: true,
    });
    await expect(state.owner.getByTestId("profile-name")).toHaveText(
      state.displayName,
    );
    await assertOwner(state);
  },
);

After("@guest-name-write", async ({ page, $testInfo }) => {
  const state = journeys.get(page);
  if (!state) return;
  let failed = false;
  for (const context of state.contexts) {
    try {
      if ((await context.cookies()).some((cookie) => cookie.name === SESSION)) {
        const active =
          context.pages().find((candidate) => !candidate.isClosed()) ??
          (await context.newPage());
        if (new URL(active.url()).origin !== new URL(state.base).origin)
          await active.goto(`${state.base}/login`);
        const result = await active.evaluate(async () => {
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
        expect(
          result,
          "established journey session revoked even on failure",
        ).toEqual({ logout: 200, profile: 401 });
        expect(
          (await context.cookies()).some((cookie) => cookie.name === SESSION),
          "cleanup removed private cookie",
        ).toBe(false);
      }
    } catch {
      failed = true;
    } finally {
      await context.close().catch(() => {
        failed = true;
      });
    }
  }
  state.password = "";
  journeys.delete(page);
  if (failed) {
    if ($testInfo.status !== $testInfo.expectedStatus)
      $testInfo.annotations.push({
        type: "owned-cleanup",
        description:
          "Guest name-write session cleanup failed; lead must audit the owned fixture",
      });
    else throw new Error("Guest name-write session cleanup failed");
  }
});
