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
interface DisplayNameTrim extends OwnedCredentials {
  base: string;
  context: BrowserContext;
  page: Page;
  displayName: string;
  writes: number;
  write?: {
    status: number;
    authenticated: boolean;
    bodyMatches: boolean;
  };
}
const edits = new WeakMap<Page, DisplayNameTrim>();
function edit(key: Page): DisplayNameTrim {
  const state = edits.get(key);
  if (!state) throw new Error("Owned trimmed-name account was not prepared");
  return state;
}

async function assertOwnedProfile(state: DisplayNameTrim, saved: boolean) {
  const result = await state.page.evaluate(
    async ({ email, displayName, saved }) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: body.email === email,
        emailVerified: body.emailVerified === true,
        noPhone: body.phone === null && body.phoneVerified === null,
        nameMatches: (body.displayName === displayName) === saved,
      };
    },
    { email: state.email, displayName: state.displayName, saved },
  );
  expect(
    result,
    "fresh profile belongs to the verified owned identity",
  ).toEqual({
    status: 200,
    sameAccount: true,
    emailVerified: true,
    noPhone: true,
    nameMatches: true,
  });
}

Given(
  "a uniquely registered verified Academy account is ready to submit a padded Unicode name by Enter",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: DisplayNameTrim = {
      base: world.hostBaseUrl,
      context,
      page: owned,
      email: `trim-3221-${randomUUID()}@example.test`,
      password: `Name-${randomUUID()}-aA1!`,
      displayName: "Пётр Иванов",
      writes: 0,
    };
    edits.set(page, state);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const registered = captureResponse(owned, "/v1/auth/register");
    const { response, code } = await registerOwnedCredentials(
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
    await assertNoPrivateRegistrationAccess(
      owned,
      (await response.headerValue("set-cookie")) ?? "",
      state,
    );
    const verified = captureResponse(owned, "/v1/auth/verify").then(
      ({ response, body }) => ({
        response,
        evidence: verificationEvidence(
          response.request().postData() ?? "",
          body,
          state,
          code,
        ),
      }),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const accepted = await verified;
    expect(accepted.response.status(), "fresh addressed code accepted").toBe(
      200,
    );
    expect(accepted.evidence).toEqual({
      credentialsMatch: true,
      acknowledgementMatches: true,
    });
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, accepted.response, world.hostBaseUrl);
    await assertOwnedProfile(state, false);
    await expect(owned.getByTestId("profile-name-edit")).toBeVisible();
    owned.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname === "/v1/me/display-name"
      )
        state.writes += 1;
    });
  },
);

When(
  "the owned Academy user submits a space-padded Unicode display name with Enter",
  async ({ page }) => {
    const state = edit(page);
    await state.page.getByTestId("profile-name-edit").click();
    const input = state.page.getByTestId("profile-name-input");
    await input.fill(`  ${state.displayName}  `);
    expect(
      await input.evaluate(
        (element, name) =>
          (element as HTMLInputElement).value === `  ${name}  `,
        state.displayName,
      ),
      "the browser input contains padding before Enter",
    ).toBe(true);
    const written = state.page
      .waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname === "/v1/me/display-name",
      )
      .then(async (response) => {
        const request = response.request();
        let bodyMatches = false;
        try {
          const body = request.postDataJSON();
          bodyMatches =
            Object.keys(body).length === 1 &&
            body.displayName === state.displayName;
        } catch {
          // Discard request parser diagnostics that could include private bytes.
        }
        return {
          status: response.status(),
          authenticated: ((await request.headerValue("cookie")) ?? "").includes(
            `${SESSION}=`,
          ),
          bodyMatches,
        };
      });
    await input.press("Enter");
    state.write = await written;
  },
);

Then(
  "exactly one authenticated display-name PUT carries only the trimmed Unicode name and is accepted",
  async ({ page }) => {
    const state = edit(page);
    expect(state.write, "actual authenticated display-name write").toEqual({
      status: 200,
      authenticated: true,
      bodyMatches: true,
    });
    expect(state.writes, "one Enter confirmation").toBe(1);
    await expect(state.page.getByTestId("profile-name-input")).toHaveCount(0);
    await expect(state.page.getByTestId("profile-name")).toHaveText(
      state.displayName,
    );
    await expect(state.page.getByTestId("profile-avatar")).toHaveText("ПИ");
  },
);

Then(
  "fresh profile and real account reload preserve the trimmed name, owner identity and Unicode initials",
  async ({ page, world }) => {
    const state = edit(page);
    await assertOwnedProfile(state, true);
    await state.page.waitForLoadState("networkidle");
    const freshRead = state.page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/v1/me/profile",
    );
    const document = await state.page.reload({ waitUntil: "load" });
    expect(document?.status(), "real account document reloaded").toBe(200);
    expect(
      document?.request().isNavigationRequest(),
      "document navigation",
    ).toBe(true);
    expect(new URL(state.page.url()).origin).toBe(
      new URL(world.hostBaseUrl).origin,
    );
    expect(new URL(state.page.url()).pathname).toBe("/account");
    expect(
      (await freshRead).status(),
      "reloaded UI fetches a fresh profile",
    ).toBe(200);
    await assertOwnedProfile(state, true);
    await expect
      .poll(
        async () =>
          (await state.page.getByTestId("profile-email").textContent()) ===
          state.email,
        { message: "rendered profile remains the owned identity" },
      )
      .toBe(true);
    await expect(
      state.page.getByTestId("profile-email-verified"),
    ).toBeVisible();
    await expect(state.page.getByTestId("profile-name")).toHaveText(
      state.displayName,
    );
    await expect(state.page.getByTestId("profile-avatar")).toHaveText("ПИ");
    await expect(state.page.getByTestId("profile-name-edit")).toBeVisible();
    expect(state.writes, "reload adds no display-name write").toBe(1);
  },
);

After("@display-name-trim", async ({ page, $testInfo }) => {
  const state = edits.get(page);
  if (!state) return;
  let failed = false;
  try {
    if (
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      if (state.page.isClosed()) state.page = await state.context.newPage();
      if (new URL(state.page.url()).origin !== new URL(state.base).origin)
        await state.page.goto(`${state.base}/login`);
      const result = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const refusals = [];
        for (const path of ["/v1/me/profile", "/v1/me/display-name"]) {
          const response = await fetch(path, {
            credentials: "include",
            cache: "no-store",
          });
          const body = await response.json().catch(() => ({}));
          refusals.push({
            status: response.status,
            generic:
              Object.keys(body).length === 3 &&
              body.statusCode === 401 &&
              body.error === "Unauthorized" &&
              body.message === "authentication required",
          });
        }
        return { logout: logout.status, refusals };
      });
      expect(
        result,
        "owned trimmed-name session revoked without private reads",
      ).toEqual({
        logout: 200,
        refusals: [
          { status: 401, generic: true },
          { status: 401, generic: true },
        ],
      });
      expect(
        (await state.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        ),
        "cleanup removed the owned private session cookie",
      ).toBe(false);
    }
  } catch {
    failed = true;
  } finally {
    state.password = "";
    await state.context.close().catch(() => {
      failed = true;
    });
    edits.delete(page);
  }
  if (failed) {
    if ($testInfo.status !== $testInfo.expectedStatus)
      $testInfo.annotations.push({
        type: "owned-cleanup",
        description:
          "Trimmed-name session cleanup failed; lead must audit the owned fixture",
      });
    else throw new Error("Trimmed-name session cleanup failed");
  }
});
