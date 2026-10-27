import { signInHostApiPath } from "../lib/sign-in-host-api.js";
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
interface Cancellation extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  base: string;
  original: string;
  draft: string;
  writes: number;
}
const cancellations = new WeakMap<Page, Cancellation>();
function cancellation(page: Page): Cancellation {
  const state = cancellations.get(page);
  if (!state)
    throw new Error("Owned name-cancellation account was not prepared");
  return state;
}

async function originalProfile(state: Cancellation) {
  const evidence = await state.page.evaluate(
    async ({ email, original, draft }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: profile.email === email,
        verified: profile.emailVerified === true,
        originalName: profile.displayName === original,
        draftAbsent: !JSON.stringify(profile).includes(draft),
      };
    },
    { email: state.email, original: state.original, draft: state.draft },
  );
  expect(
    evidence,
    "fresh profile retains the owned identity and saved name",
  ).toEqual({
    status: 200,
    sameAccount: true,
    verified: true,
    originalName: true,
    draftAbsent: true,
  });
  expect(
    await state.page
      .getByTestId("profile-email")
      .evaluate((element, email) => element.textContent === email, state.email),
    "rendered email remains the owned identity",
  ).toBe(true);
  await expect(state.page.getByTestId("profile-email-verified")).toBeVisible();
  await expect(state.page.getByTestId("profile-name")).toHaveText(
    state.original,
  );
  await expect(state.page.getByTestId("profile-avatar")).toHaveText("АМ");
}

Given(
  "a uniquely registered verified Academy account has an original display name saved through its account form",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: Cancellation = {
      context,
      page: await context.newPage(),
      base: world.hostBaseUrl,
      email: `cancel-3220-${randomUUID()}@example.test`,
      password: `Cancel-${randomUUID()}-aA1!`,
      original: "Анна Морозова",
      draft: "Вера Соколова",
      writes: 0,
    };
    cancellations.set(page, state);
    await prepareCaptchaForJourney(
      context,
      state.base,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const registering = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/register"),
    );
    const { code } = await registerOwnedCredentials(
      state.page,
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
      state.page,
      (await registration.response.headerValue("set-cookie")) ?? "",
      state,
    );
    const verifying = captureResponse(
      state.page,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
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
        world.hostBaseUrl,
      ),
    ).toEqual({
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(state.base).origin &&
        url.pathname === "/account",
    );
    await assertSecureSession(state.page, verified.response, state.base);
    await state.page.getByTestId("profile-name-edit").click();
    await state.page.getByTestId("profile-name-input").fill(state.original);
    const saving = state.page.waitForResponse(
      (res) =>
        res.request().method() === "PUT" &&
        new URL(res.url()).pathname === "/v1/me/display-name",
    );
    await state.page.getByTestId("profile-name-save").click();
    expect((await saving).status(), "prerequisite original name saved").toBe(
      200,
    );
    await originalProfile(state);
    await state.page.waitForLoadState("networkidle");
    state.page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === "/v1/me/display-name"
      )
        state.writes += 1;
    });
  },
);

When(
  "that Academy owner enters a different inline display-name draft and presses Escape",
  async ({ page }) => {
    const state = cancellation(page);
    expect(
      state.draft !== state.original,
      "draft differs from saved name",
    ).toBe(true);
    await state.page.getByTestId("profile-name-edit").click();
    const input = state.page.getByTestId("profile-name-input");
    await expect(input).toHaveValue(state.original);
    await input.fill(state.draft);
    await expect(input).toHaveValue(state.draft);
    await input.press("Escape");
  },
);

Then(
  "Escape restores the saved name without a display-name PUT and fresh profile and document reload preserve the original identity",
  async ({ page }) => {
    const state = cancellation(page);
    await expect(state.page.getByTestId("profile-name-input")).toHaveCount(0);
    await expect(state.page.getByTestId("profile-name-edit")).toBeVisible();
    await originalProfile(state);
    expect(state.writes, "Escape sends no display-name PUT").toBe(0);
    const freshRead = state.page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/v1/me/profile",
    );
    const document = await state.page.reload({ waitUntil: "load" });
    expect(
      {
        status: document?.status(),
        navigation: document?.request().isNavigationRequest(),
        sameOrigin:
          new URL(state.page.url()).origin === new URL(state.base).origin,
        account: new URL(state.page.url()).pathname === "/account",
      },
      "real account document reload",
    ).toEqual({
      status: 200,
      navigation: true,
      sameOrigin: true,
      account: true,
    });
    expect(
      (await freshRead).status(),
      "reloaded UI fetches a fresh profile",
    ).toBe(200);
    await originalProfile(state);
    expect(
      state.writes,
      "cancellation and reload send no display-name PUT",
    ).toBe(0);
  },
);

After("@display-name-cancel", async ({ page, $testInfo }) => {
  const state = cancellations.get(page);
  if (!state) return;
  let failed = false;
  try {
    if (
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      if (state.page.isClosed()) state.page = await state.context.newPage();
      if (!state.page.url().startsWith(`${state.base}/`))
        await state.page.goto(`${state.base}/`);
      const evidence = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const statuses = [];
        for (const path of ["/v1/me/profile", "/v1/me/display-name"])
          statuses.push(
            (await fetch(path, { credentials: "include", cache: "no-store" }))
              .status,
          );
        return { logout: logout.status, statuses };
      });
      expect(
        evidence,
        "owned cancellation session revoked and private reads refused",
      ).toEqual({ logout: 200, statuses: [401, 401] });
      expect(
        (await state.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        ),
        "owned session cookie removed",
      ).toBe(false);
    }
  } catch {
    failed = true;
  } finally {
    state.password = "";
    await state.context.close().catch(() => {
      failed = true;
    });
    cancellations.delete(page);
  }
  if (failed) {
    if ($testInfo.status !== $testInfo.expectedStatus)
      $testInfo.annotations.push({
        type: "owned-cleanup",
        description:
          "Display-name cancellation cleanup failed; lead must audit the owned fixture",
      });
    else throw new Error("Display-name cancellation session cleanup failed");
  }
});
