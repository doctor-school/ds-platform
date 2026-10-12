import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  fetchRecoveryCode,
  mailpitUrlFor,
  nativeRecoveryMail,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  registrationUrl,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface CodeScreenVisitor extends OwnedCredentials {
  kind: "new" | "existing";
  context: BrowserContext;
  page: Page;
  consentStatement?: string;
  screenSignature?: string;
  separateAuthBlock?: boolean;
  existenceLeak?: boolean;
  codeStepObserved: boolean;
  authPosts: string[];
}
interface CodeScreens {
  preparation: BrowserContext;
  visitors: CodeScreenVisitor[];
}
const screens = new WeakMap<Page, CodeScreens>();
function codeScreens(key: Page): CodeScreens {
  const state = screens.get(key);
  if (!state) throw new Error("Owned registration code screens not prepared");
  return state;
}

async function observeCodeStep(visitor: CodeScreenVisitor, base: string) {
  const owned = visitor.page;
  const card = owned.getByTestId("verify-card");
  await expect(card.getByRole("heading", { level: 1 })).toHaveText(
    "Проверьте почту",
  );
  const url = new URL(owned.url());
  expect(url.origin).toBe(new URL(base).origin);
  expect(url.pathname).toBe("/verify");
  expect(
    url.searchParams.get("email") === visitor.email,
    "exact typed route address",
  ).toBe(true);
  expect(url.searchParams.get("returnTo")).toBe("/account");
  expect(
    (await card.locator("strong").innerText()) === visitor.email,
    "exact unmasked typed destination",
  ).toBe(true);
  const field = card.locator('input[autocomplete="one-time-code"]');
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("maxlength", "6");
  expect((await field.inputValue()) === "", "code remains unentered").toBe(
    true,
  );
  const cells = card.locator("[data-input-otp-container] .aspect-square");
  await expect(cells).toHaveCount(6);
  for (const cell of await cells.all()) await expect(cell).toBeVisible();
  const resend = card.getByTestId("verify-resend");
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/^Отправить снова · [1-9]\d* с$/);
  visitor.screenSignature = (await card.innerText())
    .split(visitor.email)
    .join("<address>")
    .replace(/Отправить снова · \d+ с/g, "Отправить снова · <seconds> с");
  visitor.separateAuthBlock =
    (await card.locator('a[href*="/login"], a[href*="/reset"]').count()) > 0 ||
    (await card
      .getByText(/^(Вход|Войти|Сброс пароля|Сбросить пароль|Забыли пароль\??)$/)
      .count()) > 0;
  visitor.existenceLeak =
    (await card
      .getByText(/уже занят|уже зарегистрирован|аккаунт существует/i)
      .count()) > 0;
  visitor.codeStepObserved = true;
}

Given(
  "a new Academy visitor and an already-verified owned visitor with fresh guest browsers",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const options = {
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    };
    const preparation = await browser.newContext(options);
    const state: CodeScreens = { preparation, visitors: [] };
    screens.set(page, state);
    const owned = await preparation.newPage();
    const existing = {
      email: `screen-existing-2826-${randomUUID()}@example.test`,
      password: `Screen-${randomUUID()}-aA1!`,
    };
    await prepareCaptchaForJourney(
      preparation,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { response, code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      existing,
      "/account",
    );
    expect(
      registrationEvidence(
        response.request().postData() ?? "",
        await response.text(),
        existing,
      ),
      "existing visitor prerequisite uses the real registration command",
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    const verification = captureResponse(owned, "/v1/auth/verify");
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const accepted = await verification;
    expect(accepted.response.status(), "owned prerequisite code accepted").toBe(
      200,
    );
    expect(
      verificationEvidence(
        accepted.response.request().postData() ?? "",
        accepted.body,
        existing,
        code,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, accepted.response, world.hostBaseUrl);
    const identity = await owned.evaluate(async (email) => {
      const response = await fetch("/v1/me/profile", {
        credentials: "include",
      });
      const profile = await response.json().catch(() => ({}));
      return {
        status: response.status,
        sameAccount: profile.email === email,
        verified: profile.emailVerified === true,
      };
    }, existing.email);
    expect(identity, "existing visitor is a real verified account").toEqual({
      status: 200,
      sameAccount: true,
      verified: true,
    });
    const logout = captureResponse(owned, "/v1/auth/logout");
    await owned.getByTestId("logout").click();
    expect(
      (await logout).response.status(),
      "prerequisite session revoked",
    ).toBe(200);
    await owned.waitForURL((url) => url.pathname === "/");
    await assertNoPrivateRegistrationAccess(owned, "", existing);

    for (const kind of ["new", "existing"] as const) {
      const context = await browser.newContext(options);
      const visitor: CodeScreenVisitor = {
        kind,
        context,
        page: await context.newPage(),
        // A mixed-case local part makes masking/case folding observable on
        // the screen and Back destination, while mail lookup stays normalized.
        email:
          kind === "new"
            ? `Screen-new-2826-${randomUUID()}@example.test`
            : existing.email.replace("screen-", "Screen-"),
        password: `Draft-${randomUUID()}-aA1!`,
        authPosts: [],
        codeStepObserved: false,
      };
      state.visitors.push(visitor);
      await prepareCaptchaForJourney(
        context,
        world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      expect(
        await context.cookies(),
        "arrival uses a clean guest browser",
      ).toEqual([]);
      visitor.page.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
          visitor.authPosts.push(pathname);
      });
    }
  },
);

When(
  "both owned visitors submit the Academy registration form and reach its code step",
  async ({ page, world }) => {
    for (const visitor of codeScreens(page).visitors) {
      const owned = visitor.page;
      await owned.goto(registrationUrl(world.hostBaseUrl, "/account"), {
        waitUntil: "load",
      });
      await owned.waitForLoadState("networkidle");
      await inputSecret(owned.getByTestId("register-email"), visitor.email);
      await inputSecret(
        owned.getByTestId("register-password"),
        visitor.password,
      );
      // 003 EARS-20: bind the recorded acceptance and retain the actual
      // rendered state without inventing an editable consent field.
      visitor.consentStatement = await owned
        .getByTestId("registration-form")
        .getByText(/^Продолжая, вы соглашаетесь/)
        .innerText();
      await expect(owned.getByRole("checkbox")).toHaveCount(0);
      const sentAt = new Date().toISOString();
      const registration = captureResponse(owned, "/v1/auth/register");
      await owned.getByTestId("register-submit").click();
      const registered = await registration;
      expect(
        registered.response.status(),
        `${visitor.kind} registration accepted`,
      ).toBe(200);
      expect(
        registrationEvidence(
          registered.response.request().postData() ?? "",
          registered.body,
          visitor,
        ),
        `${visitor.kind} submits its actual credentials and consent`,
      ).toEqual({
        credentialsMatch: true,
        consentMatches: true,
        acknowledgementMatches: true,
      });
      await owned.waitForURL((url) => url.pathname === "/verify");
      // Observe each real arrival before unrelated mail or another account's
      // network latency can consume this screen's normal resend cooldown.
      await observeCodeStep(visitor, world.hostBaseUrl);
      const code = await fetchRecoveryCode(
        nativeRecoveryMail(),
        process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
        visitor.email.toLowerCase(),
        sentAt,
        visitor.kind === "existing" ? "login" : "register",
      );
      expect(
        /^\d{6}$/.test(code),
        `${visitor.kind} has a fresh unconsumed code`,
      ).toBe(true);
      await assertNoPrivateRegistrationAccess(
        owned,
        (await registered.response.headerValue("set-cookie")) ?? "",
        visitor,
      );
    }
  },
);

Then(
  "both code screens show check your email, the exact typed address, six cells and disabled resend cooldown",
  async ({ page }) => {
    for (const visitor of codeScreens(page).visitors) {
      expect(
        visitor.codeStepObserved,
        `${visitor.kind} actual arrival has the required code-screen controls`,
      ).toBe(true);
    }
  },
);

Then(
  "each actual Change email control returns to registration with its entered fields and consent state kept",
  async ({ page, world }) => {
    for (const visitor of codeScreens(page).visitors) {
      const owned = visitor.page;
      const back = owned.getByTestId("verify-back");
      await expect(back).toHaveText("← Изменить почту");
      await expect(back).toBeEnabled();
      await back.click();
      await owned.waitForURL((url) => url.pathname === "/register");
      await expect(owned.getByTestId("registration-form")).toBeVisible();
      expect(new URL(owned.url()).origin).toBe(
        new URL(world.hostBaseUrl).origin,
      );
      expect(new URL(owned.url()).searchParams.get("returnTo")).toBe(
        "/account",
      );
      await expect
        .poll(
          async () =>
            (await owned.getByTestId("register-email").inputValue()) ===
            visitor.email,
          {
            message: `${visitor.kind} Back preserves the entered email without refilling`,
          },
        )
        .toBe(true);
      await expect
        .poll(
          async () =>
            (await owned.getByTestId("register-password").inputValue()) ===
            visitor.password,
          {
            message: `${visitor.kind} Back preserves the entered password without refilling`,
          },
        )
        .toBe(true);
      expect(
        (await owned
          .getByTestId("registration-form")
          .getByText(/^Продолжая, вы соглашаетесь/)
          .innerText()) === visitor.consentStatement,
        `${visitor.kind} Back keeps the rendered consent statement`,
      ).toBe(true);
      await expect(owned.getByRole("checkbox")).toHaveCount(0);
      await assertNoPrivateRegistrationAccess(owned, "", visitor);
      expect(
        visitor.authPosts,
        "Back sends no replay or code acceptance",
      ).toEqual(["/v1/auth/register"]);
    }
  },
);

Then(
  "neither owned code screen offers a separate Sign in or Reset password block",
  async ({ page }) => {
    const visitors = codeScreens(page).visitors;
    for (const visitor of visitors) {
      expect(
        visitor.separateAuthBlock,
        `${visitor.kind} has no separate sign-in or reset block`,
      ).toBe(false);
    }
  },
);

Then(
  "the owned code screens never branch on whether the email was already registered",
  async ({ page }) => {
    const visitors = codeScreens(page).visitors;
    expect(visitors.map((visitor) => visitor.kind)).toEqual([
      "new",
      "existing",
    ]);
    for (const visitor of visitors) {
      expect(
        visitor.existenceLeak,
        `${visitor.kind} screen discloses no account existence`,
      ).toBe(false);
    }
    expect(
      Boolean(visitors[0]!.screenSignature) &&
        visitors[0]!.screenSignature === visitors[1]!.screenSignature,
      "both actual code screens have the same visible composition",
    ).toBe(true);
  },
);

After("@registration-code-screen", async ({ page }) => {
  const state = screens.get(page);
  if (!state) return;
  const contexts = [
    state.preparation,
    ...state.visitors.map((visitor) => visitor.context),
  ];
  try {
    for (const context of contexts) {
      if (
        (await context.cookies()).some(
          (cookie) => cookie.name === "__Host-ds_session",
        )
      ) {
        const result = await context.pages()[0]!.evaluate(async () => {
          const logout = await fetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
          });
          const profile = await fetch("/v1/me/profile", {
            credentials: "include",
          });
          return { logout: logout.status, profile: profile.status };
        });
        expect(result, "owned prerequisite session revoked on failure").toEqual(
          { logout: 200, profile: 401 },
        );
      }
    }
  } finally {
    for (const context of contexts) {
      // Close pages first: failure snapshots cannot retain credentials.
      await Promise.all(context.pages().map((owned) => owned.close()));
      await context.close();
    }
    screens.delete(page);
  }
});
