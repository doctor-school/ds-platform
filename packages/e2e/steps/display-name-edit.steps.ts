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
interface DisplayNameEdit extends OwnedCredentials {
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
const edits = new WeakMap<Page, DisplayNameEdit>();
function edit(key: Page): DisplayNameEdit {
  const state = edits.get(key);
  if (!state) throw new Error("Owned display-name account was not prepared");
  return state;
}

async function assertOwnedProfile(state: DisplayNameEdit, saved: boolean) {
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
  "a uniquely registered verified Academy account is on its own account page for inline name editing",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: DisplayNameEdit = {
      context,
      page: owned,
      email: `name-2767-${randomUUID()}@example.test`,
      password: `Name-${randomUUID()}-aA1!`,
      displayName: `Марина Волкова-2767-${randomUUID()}`,
      writes: 0,
    };
    edits.set(page, state);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? "",
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { response, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    expect(
      registrationEvidence(
        response.request().postData() ?? "",
        await response.text(),
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
  "the owned user edits the display name inline and confirms the new value",
  async ({ page }) => {
    const state = edit(page);
    await state.page.getByTestId("profile-name-edit").click();
    const input = state.page.getByTestId("profile-name-input");
    await input.fill(state.displayName);
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
    await state.page.getByTestId("profile-name-save").click();
    state.write = await written;
  },
);

Then(
  "the ordinary inline edit succeeds through the existing authenticated display-name PUT endpoint",
  async ({ page }) => {
    const state = edit(page);
    expect(state.write, "actual authenticated display-name write").toEqual({
      status: 200,
      authenticated: true,
      bodyMatches: true,
    });
    expect(state.writes, "one ordinary inline confirmation").toBe(1);
    await expect(state.page.getByTestId("profile-name-input")).toHaveCount(0);
    await expect(state.page.getByTestId("profile-name")).toHaveText(
      state.displayName,
    );
    await expect(state.page.getByTestId("profile-avatar")).toHaveText("МВ");
  },
);

Then(
  "a real account document reload and fresh profile read preserve that owned identity's name and avatar initials",
  async ({ page, world }) => {
    const state = edit(page);
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
    await expect(state.page.getByTestId("profile-avatar")).toHaveText("МВ");
    await expect(state.page.getByTestId("profile-name-edit")).toBeVisible();
    expect(state.writes, "reload adds no display-name write").toBe(1);
  },
);

After("@inline-display-name-edit", async ({ page }) => {
  const state = edits.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      const result = await state.page.evaluate(async () => {
        const logout = await fetch("/v1/auth/logout", {
          method: "POST",
          credentials: "include",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
        });
        return { logout: logout.status, profile: profile.status };
      });
      expect(result, "owned inline-edit session revoked").toEqual({
        logout: 200,
        profile: 401,
      });
    }
  } finally {
    // Close pages first so failure snapshots cannot retain registration secrets.
    await Promise.all(state.context.pages().map((owned) => owned.close()));
    await state.context.close();
    edits.delete(page);
  }
});
