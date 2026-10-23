import { storefrontCallbackAcknowledgement } from "../lib/owned-registration.js";
import { hostCommand, signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import {
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import { runGatedLoginAttempt } from "../lib/login-failure-gate.js";
import { confirmOwnedPhone } from "../lib/owned-phone-confirmation.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { freshConfirmablePhone, smsSinkUrl } from "../lib/sms-sink.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface PhonePassword {
  email: string;
  password: string;
  phone: string;
  context: BrowserContext;
  page: Page;
  httpCredentials: BrowserContextOptions["httpCredentials"];
  closures: APIRequestContext[];
  subject?: string;
  priorCookie?: string | undefined;
}
const journeys = new WeakMap<Page, PhonePassword>();
function journey(page: Page): PhonePassword {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned phone-password journey missing");
  return state;
}
async function sameOwner(state: PhonePassword) {
  const result = await state.page.evaluate(
    async ({ email, phone, subject }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const session = await sessionResponse.json().catch(() => ({}));
      return {
        subject: session.sub as string | undefined,
        safe: {
          profile: profileResponse.status,
          session: sessionResponse.status,
          sameEmail: profile.email === email,
          emailVerified: profile.emailVerified === true,
          samePhone: profile.phone === phone,
          phoneVerified: profile.phoneVerified === true,
          sameSubject:
            typeof session.sub === "string" &&
            !!session.sub &&
            (subject === undefined || session.sub === subject),
        },
      };
    },
    { email: state.email, phone: state.phone, subject: state.subject },
  );
  expect(
    result.safe,
    "exact original verified doctor and confirmed phone",
  ).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    emailVerified: true,
    samePhone: true,
    phoneVerified: true,
    sameSubject: true,
  });
  if (!result.subject) throw new Error("Owned phone-password subject missing");
  state.subject ??= result.subject;
}
async function logout(page: Page) {
  const result = await page.evaluate(async () => {
    const logout = await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const profile = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    return {
      logout: logout.status,
      session: session.status,
      profile: profile.status,
    };
  });
  expect(result, "exact owned browser session revoked").toEqual({
    logout: 200,
    session: 401,
    profile: 401,
  });
  expect(
    (await page.context().cookies()).some((c) => c.name === SESSION),
    "logout removes private cookie",
  ).toBe(false);
}
async function revokeClosure(context: APIRequestContext) {
  const revoked = await context.post("/v1/auth/logout");
  const session = await context.get("/v1/auth/session");
  const profile = await context.get("/v1/me/profile");
  expect(
    {
      logout: revoked.status(),
      session: session.status(),
      profile: profile.status(),
    },
    "exact owned closing session revoked",
  ).toEqual({ logout: 200, session: 401, profile: 401 });
}

Given(
  "an owned Academy password account verifies email and confirms its fresh phone",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const sink = smsSinkUrl();
    if (!sink)
      throw new Error("Phone-password proof requires E2E_SMS_SINK_URL");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: PhonePassword = {
      email: `wave-p-3086-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
      phone: freshConfirmablePhone(),
      context,
      page: owned,
      httpCredentials,
      closures: [],
    };
    journeys.set(page, state);
    await test.info().attach("owned-fixture", {
      body: JSON.stringify({
        issue: 3086,
        email: state.email,
        phone: state.phone,
      }),
      contentType: "application/json",
    });
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      state,
      "/account",
    );
    const pending = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "real registration email verified").toBe(
      200,
    );
    await owned.waitForURL((url) => url.pathname === "/account");
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, verified.response, world.hostBaseUrl);
    await confirmOwnedPhone(owned, { phone: state.phone, sink });
    await sameOwner(state);
    state.priorCookie = (await context.cookies()).find(
      (c) => c.name === SESSION,
    )?.value;
    expect(Boolean(state.priorCookie), "registration session exists").toBe(
      true,
    );
  },
);

When(
  "that doctor logs out and submits the confirmed phone and password through Academy's password form",
  async ({ page, world }) => {
    const state = journey(page);
    await logout(state.page);
    await state.page.goto(
      new URL(
        "/login?method=password&returnTo=%2Faccount",
        world.hostBaseUrl,
      ).toString(),
      { waitUntil: "load" },
    );
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.getByTestId("login-method-password"),
    ).toHaveAttribute("aria-selected", "true");
    await inputSecret(
      state.page.locator('input[autocomplete="username"]'),
      state.phone,
    );
    await inputSecret(
      state.page.locator('input[autocomplete="current-password"]'),
      state.password,
    );
    let attemptFailed = false;
    const accepted = await runGatedLoginAttempt(
      {
        close: async () => {
          let closure: APIRequestContext | undefined;
          let failed = false;
          try {
            closure = await request.newContext({
              baseURL: world.hostBaseUrl,
              ...(state.httpCredentials
                ? { httpCredentials: state.httpCredentials }
                : {}),
            });
            state.closures.push(closure);
            const response = await closure.post("/v1/auth/login", {
              data: { identifier: state.email, password: state.password },
            });
            expect(
              response.status(),
              "owned successful login closes suite failure gate",
            ).toBe(200);
          } catch {
            failed = true;
          } finally {
            if (closure) {
              try {
                await revokeClosure(closure);
                await closure.dispose();
                state.closures = state.closures.filter((c) => c !== closure);
              } catch {
                failed = true;
              }
            }
          }
          if (failed) {
            if (!attemptFailed)
              throw new Error("Owned login closure or cleanup failed");
            test.info().annotations.push({
              type: "cleanup-failed",
              description:
                "Owned login closure failed; original password attempt failure retained; scoped cleanup required.",
            });
          }
        },
      },
      async () => {
        try {
          const pending = captureResponse(
            state.page,
            signInHostApiPath("/v1/auth/login"),
          );
          await state.page.getByTestId("password-login-submit").click();
          const result = await pending;
          let exactCommand = false;
          try {
            const body = hostCommand(result.response.request().postDataJSON());
            exactCommand =
              Object.keys(body).sort().join(",") === "identifier,password" &&
              body.identifier === state.phone &&
              body.password === state.password;
          } catch {
            /* Project secret-bearing data to a boolean only. */
          }
          expect(
            {
              status: result.response.status(),
              exactCommand,
              tokenFree: storefrontCallbackAcknowledgement(result.body, world.hostBaseUrl),
            },
            "confirmed phone accepted by actual password endpoint",
          ).toEqual({ status: 200, exactCommand: true, tokenFree: true });
          return result;
        } catch (error) {
          attemptFailed = true;
          throw error;
        }
      },
    );
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(
      state.page,
      accepted.response,
      world.hostBaseUrl,
      state.priorCookie ? [state.priorCookie] : [],
    );
    await sameOwner(state);
  },
);

Then(
  "the same confirmed-phone doctor persists after account reload and owned logout removes private access",
  async ({ page }) => {
    const state = journey(page);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await expect(
      state.page.getByTestId("profile-phone-verified"),
    ).toBeVisible();
    await sameOwner(state);
    await logout(state.page);
  },
);

After("@login-phone-password", async ({ page, world }) => {
  const state = journeys.get(page);
  if (!state) return;
  const failures: string[] = [];
  try {
    if ((await state.context.cookies()).some((c) => c.name === SESSION)) {
      const origin = new URL(world.hostBaseUrl).origin;
      const active = state.context.pages().find((p) => {
        try {
          return new URL(p.url()).origin === origin;
        } catch {
          return false;
        }
      });
      if (!active)
        throw new Error(
          "Owned phone-password session has no same-origin cleanup page",
        );
      await logout(active);
    }
  } catch {
    failures.push("owned-browser-session-revocation");
  }
  for (const closure of state.closures) {
    try {
      await revokeClosure(closure);
    } catch {
      failures.push("owned-closing-session-revocation");
    } finally {
      await closure
        .dispose()
        .catch(() => failures.push("closing-context-disposal"));
    }
  }
  await state.context
    .close()
    .catch(() => failures.push("browser-context-close"));
  journeys.delete(page);
  if (failures.length) {
    const message = `Owned phone-password cleanup failed: ${failures.join(", ")}`;
    if (test.info().status === test.info().expectedStatus)
      throw new Error(message);
    test.info().annotations.push({
      type: "cleanup-failed",
      description: `${message}; original scenario failure retained.`,
    });
  }
});
