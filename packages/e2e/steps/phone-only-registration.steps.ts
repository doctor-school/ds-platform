import { randomInt, randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  captchaTestTokenFromEnv,
  prepareCaptchaForJourney,
} from "../lib/captcha-stub.js";
import {
  captureResponse,
  type CapturedResponse,
} from "../lib/captured-response.js";
import {
  readOwnedPhoneAccountCount,
  readOwnedUserCount,
  type OwnedAuthContour,
} from "../lib/owned-auth-observation.js";
import {
  assertNoPrivateRegistrationAccess,
  registerOwnedCredentials,
  registrationEvidence,
  registrationUrl,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface PhoneRefusal {
  response: CapturedResponse;
  evidence: {
    phoneOnlyPayload: boolean;
    captchaProofMatches: boolean;
    genericRefusal: boolean;
    noIdentifierEcho: boolean;
    noCredentialOrToken: boolean;
  };
}

interface PhoneOnlyRegistration extends OwnedCredentials {
  context: BrowserContext;
  page: Page;
  contour: OwnedAuthContour;
  localContour: boolean;
  captchaToken?: string | undefined;
  phones: [string, string];
  refusals: PhoneRefusal[];
  authPosts: string[];
  usersBeforeRefusal?: number;
  usersAfterRefusal?: number;
  phonesBeforeRefusal?: number;
  phonesAfterRefusal?: number;
}

const registrations = new WeakMap<Page, PhoneOnlyRegistration>();

function registration(key: Page): PhoneOnlyRegistration {
  const state = registrations.get(key);
  if (!state) throw new Error("Owned phone-only registration was not prepared");
  return state;
}

function parsedObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function refusalEvidence(
  observed: CapturedResponse,
  phone: string,
  state: PhoneOnlyRegistration,
): PhoneRefusal["evidence"] {
  const request = parsedObject(observed.response.request().postData() ?? "");
  const response = parsedObject(observed.body);
  const errors = response.errors;
  const issue =
    Array.isArray(errors) &&
    errors.length === 1 &&
    errors[0] !== null &&
    typeof errors[0] === "object" &&
    !Array.isArray(errors[0])
      ? (errors[0] as Record<string, unknown>)
      : {};
  const consent = request.consent;
  const accepted =
    Array.isArray(consent) && consent.length === 1 ? consent[0] : null;
  return {
    phoneOnlyPayload:
      Object.keys(request).length === 3 &&
      request.phone === phone &&
      request.password === state.password &&
      !Object.hasOwn(request, "email") &&
      accepted !== null &&
      typeof accepted === "object" &&
      Object.keys(accepted).length === 2 &&
      accepted.purpose === "tos" &&
      accepted.version === "2026-01",
    captchaProofMatches:
      observed.response.request().headers()["x-smartcaptcha-token"] ===
      state.captchaToken,
    genericRefusal:
      Object.keys(response).length === 3 &&
      response.statusCode === 400 &&
      response.message === "Validation failed" &&
      Object.keys(issue).length === 4 &&
      issue.expected === "string" &&
      issue.code === "invalid_type" &&
      Array.isArray(issue.path) &&
      issue.path.length === 1 &&
      issue.path[0] === "email" &&
      typeof issue.message === "string" &&
      issue.message.length > 0,
    noIdentifierEcho: [...state.phones, state.email].every(
      (identifier) =>
        !observed.body.includes(identifier) &&
        !observed.body.includes(encodeURIComponent(identifier)),
    ),
    noCredentialOrToken:
      !observed.body.includes(state.password) &&
      !observed.body.includes(encodeURIComponent(state.password)) &&
      (state.captchaToken === undefined ||
        !observed.body.includes(state.captchaToken)) &&
      !/access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
        observed.body,
      ),
  };
}

Given(
  "an Academy visitor sees email-only registration and owns two phone-only request identifiers",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const firstPhone = `+1999${randomInt(10_000_000, 99_999_999)}`;
    let secondPhone = `+1999${randomInt(10_000_000, 99_999_999)}`;
    while (secondPhone === firstPhone)
      secondPhone = `+1999${randomInt(10_000_000, 99_999_999)}`;
    const state: PhoneOnlyRegistration = {
      context,
      page: owned,
      localContour: new URL(world.hostBaseUrl).protocol === "http:",
      contour: {
        academyBaseUrl: process.env.E2E_PORTAL_URL ?? "",
        apiBaseUrl: process.env.E2E_API_URL ?? "",
        databaseUrl: process.env.E2E_AUTH_DATABASE_URL ?? "",
        expectedDatabase: process.env.E2E_AUTH_DATABASE_NAME ?? "",
        expectedDatabaseHost: process.env.E2E_AUTH_DATABASE_HOST ?? "",
        expectedDatabasePort: Number(process.env.E2E_AUTH_DATABASE_PORT),
      },
      phones: [firstPhone, secondPhone],
      email: `phone-control-2857-${randomUUID()}@example.test`,
      password: `Phone-control-${randomUUID()}-aA1!`,
      refusals: [],
      authPosts: [],
    };
    registrations.set(page, state);
    owned.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && pathname.startsWith("/v1/auth/"))
        state.authPosts.push(pathname);
    });
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await owned.goto(registrationUrl(world.hostBaseUrl), { waitUntil: "load" });
    await owned.waitForLoadState("networkidle");
    const email = owned.locator('input[autocomplete="email"]');
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("type", "email");
    await expect(
      owned.locator('input[autocomplete="new-password"]'),
    ).toBeVisible();
    await expect(owned.getByTestId("register-submit")).toBeVisible();
    await expect(
      owned.locator('input[type="tel"], input[autocomplete="tel"]'),
    ).toHaveCount(0);
    await assertNoPrivateRegistrationAccess(owned, "", state);
    expect(
      state.contour.academyBaseUrl === world.hostBaseUrl,
      "the count observer belongs to the actual root-owned Academy contour",
    ).toBe(true);
  },
);

When(
  "the visitor sends both phone-without-email payloads to the real Academy registration BFF",
  async ({ page }) => {
    const state = registration(page);
    state.captchaToken =
      state.localContour && process.env.BOT_PROTECTION_ENABLED === "false"
        ? undefined
        : captchaTestTokenFromEnv();
    state.phonesBeforeRefusal = await readOwnedPhoneAccountCount(
      state.contour,
      {
        email: state.email,
        phones: state.phones,
      },
    );
    expect(
      state.phonesBeforeRefusal === 0,
      "neither submitted phone has a pre-existing account mirror",
    ).toBe(true);
    if (state.localContour)
      state.usersBeforeRefusal = await readOwnedUserCount(state.contour, {
        email: state.email,
      });
    for (const phone of state.phones) {
      // 003 EARS-2/16: probe the public request contract without modifying the form.
      const pending = captureResponse(state.page, "/v1/auth/register");
      await state.page.evaluate(
        async ({ phone, password, token }) => {
          try {
            const response = await fetch("/v1/auth/register", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                ...(token !== undefined
                  ? { "x-smartcaptcha-token": token }
                  : {}),
              },
              body: JSON.stringify({
                phone,
                password,
                consent: [{ purpose: "tos", version: "2026-01" }],
              }),
            });
            await response.text();
          } catch {
            throw new Error("Phone-only registration request failed");
          }
        },
        { phone, password: state.password, token: state.captchaToken },
      );
      const response = await pending;
      state.refusals.push({
        response,
        evidence: refusalEvidence(response, phone, state),
      });
      await assertNoPrivateRegistrationAccess(
        state.page,
        (await response.response.headerValue("set-cookie")) ?? "",
        state,
      );
    }
    state.phonesAfterRefusal = await readOwnedPhoneAccountCount(state.contour, {
      email: state.email,
      phones: state.phones,
    });
    if (state.localContour)
      state.usersAfterRefusal = await readOwnedUserCount(state.contour, {
        email: state.email,
      });
  },
);

Then(
  "both phone-only requests receive the same generic enumeration-safe failure without identifiers or credentials",
  async ({ page }) => {
    const state = registration(page);
    expect(state.refusals.length, "both distinct identifiers were probed").toBe(
      2,
    );
    for (const observed of state.refusals) {
      expect(
        observed.response.response.status(),
        "handled invalid request",
      ).toBe(400);
      expect(
        observed.evidence,
        "privacy-safe phone-only refusal evidence",
      ).toEqual({
        phoneOnlyPayload: true,
        captchaProofMatches: true,
        genericRefusal: true,
        noIdentifierEcho: true,
        noCredentialOrToken: true,
      });
    }
    expect(
      state.refusals[0]!.response.body === state.refusals[1]!.response.body,
      "the entire response is deterministic across the two phone identifiers",
    ).toBe(true);
  },
);

Then(
  "neither phone-only response is a 500 server error and the visitor still has no private session",
  async ({ page }) => {
    const state = registration(page);
    expect(state.refusals.length).toBe(2);
    for (const observed of state.refusals)
      expect(
        observed.response.response.status(),
        "phone-only never 500s",
      ).not.toBe(500);
    expect(new URL(state.page.url()).pathname).toBe("/register");
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

Then(
  "neither owned submitted phone identifier has an account mirror and the isolated local users total remains unchanged when applicable",
  async ({ page }) => {
    const state = registration(page);
    if (
      state.phonesBeforeRefusal === undefined ||
      state.phonesAfterRefusal === undefined
    )
      throw new Error("Owned phone-only account observations are incomplete");
    expect(
      state.phonesBeforeRefusal === 0 && state.phonesAfterRefusal === 0,
      "actual submitted phone identifiers have no account mirror before or after refusal",
    ).toBe(true);
    // 003 EARS-2/16: isolated totals strengthen the request-bound mirror oracle;
    // a shared Stage total would include unrelated concurrent registrations.
    if (state.localContour) {
      if (
        state.usersBeforeRefusal === undefined ||
        state.usersAfterRefusal === undefined
      )
        throw new Error(
          "Required isolated total-users observations are incomplete",
        );
      expect(
        state.usersAfterRefusal === state.usersBeforeRefusal,
        "total isolated users remain unchanged across the phone-only refusals",
      ).toBe(true);
    }
  },
);

When(
  "the same visitor submits the real Academy registration form with a unique valid email as a control",
  async ({ page, world }) => {
    const state = registration(page);
    const pending = captureResponse(state.page, "/v1/auth/register");
    const { response, code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      state,
    );
    const submitted = await pending;
    expect(
      registrationEvidence(
        submitted.response.request().postData() ?? "",
        submitted.body,
        state,
      ),
      "real email control uses the approved registration contract",
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    expect(response.status(), "valid email control is accepted").toBe(200);
    expect(
      /^\d{6}$/.test(code),
      "real addressed registration code mail was delivered",
    ).toBe(true);
    expect(
      new URL(state.page.url()).searchParams.get("email") === state.email,
      "the control code step belongs to the same owned email",
    ).toBe(true);
    const field = state.page.locator('input[autocomplete="one-time-code"]');
    await expect(field).toBeVisible();
    expect(
      (await field.inputValue()) === "",
      "delivered code stays unconsumed",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(
      state.page,
      (await response.headerValue("set-cookie")) ?? "",
      state,
    );
  },
);

Then(
  "the valid email control reaches its delivered-code step without pre-code private access or any phone registration route",
  async ({ page }) => {
    const state = registration(page);
    expect(new URL(state.page.url()).pathname).toBe("/verify");
    expect(
      state.authPosts,
      "two invalid requests and one valid form submission only",
    ).toEqual(["/v1/auth/register", "/v1/auth/register", "/v1/auth/register"]);
    await expect(
      state.page.locator('input[type="tel"], input[autocomplete="tel"]'),
    ).toHaveCount(0);
    await assertNoPrivateRegistrationAccess(state.page, "", state);
  },
);

After("@phone-only-registration", async ({ page }) => {
  const state = registrations.get(page);
  if (!state) return;
  try {
    await Promise.all(state.context.pages().map((owned) => owned.close()));
  } finally {
    await state.context.close();
    registrations.delete(page);
  }
});
