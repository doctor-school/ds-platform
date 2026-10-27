import { hostCommand,
  isAuthCommandPath,
  signInHostApiPath,
} from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  assertNoAddressedMail,
  captureAddressedMailCheckpoint,
  mailpitUrlFor,
  nativeRecoveryMail,
  type AddressedMailCheckpoint,
} from "../lib/mailpit.js";
import {
  assertNoPrivateRegistrationAccess,
  inputSecret,
  registerOwnedCredentials,
  registrationEvidence,
  verificationEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { openHostCodeStep } from "../lib/storefront-entry-watch.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { test, After, Given, Then, When } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface OwnedBrowser {
  context: BrowserContext;
  page: Page;
}
interface ConsumedVerification extends OwnedCredentials, OwnedBrowser {
  guest?: OwnedBrowser;
  code?: string;
  subject?: string;
  phoneState?: string;
  cookie?: string | undefined;
  beforeReplay?: AddressedMailCheckpoint;
  posts: string[];
}
const states = new WeakMap<Page, ConsumedVerification>();
function state(key: Page): ConsumedVerification {
  const value = states.get(key);
  if (!value) throw new Error("Owned consumed registration code not prepared");
  return value;
}

async function assertIdentity(value: ConsumedVerification, page = value.page) {
  const result = await page.evaluate(
    async ({ email, subject, phoneState }) => {
      const profileResponse = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const profile = await profileResponse.json().catch(() => ({}));
      const sessionResponse = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await sessionResponse.json().catch(() => ({}));
      const currentPhone = JSON.stringify([
        profile.phone,
        profile.phoneVerified,
      ]);
      return {
        subject: typeof session.sub === "string" ? session.sub : undefined,
        phoneState: currentPhone,
        evidence: {
          profile: profileResponse.status,
          session: sessionResponse.status,
          sameEmail: profile.email === email,
          verified: profile.emailVerified === true,
          subjectPresent:
            typeof session.sub === "string" && session.sub.length > 0,
          sameSubject: subject === undefined || session.sub === subject,
          samePhone: phoneState === undefined || phoneState === currentPhone,
        },
      };
    },
    {
      email: value.email,
      subject: value.subject,
      phoneState: value.phoneState,
    },
  );
  expect(
    result.evidence,
    "same verified owner and unchanged phone state",
  ).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    subjectPresent: true,
    sameSubject: true,
    samePhone: true,
  });
  value.subject = result.subject;
  value.phoneState = result.phoneState;
  expect(
    await page
      .getByTestId("profile-email")
      .evaluate((element, email) => element.textContent === email, value.email),
    "owned address rendered",
  ).toBe(true);
  await expect(page.getByTestId("profile-email-verified")).toBeVisible();
}

Given(
  "a uniquely registered Academy account accepts its actually delivered registration code once",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const value: ConsumedVerification = {
      context,
      page: owned,
      email: `verification-reuse-3129-${randomUUID()}@example.test`,
      password: `Verified-${randomUUID()}-aA1!`,
      posts: [],
    };
    states.set(page, value);
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const registered = await registerOwnedCredentials(
      owned,
      world.hostBaseUrl,
      value,
      "/account",
    );
    value.code = registered.code;
    expect(
      /^\d{6}$/.test(value.code),
      "actual delivered six-digit registration code",
    ).toBe(true);
    expect(
      registrationEvidence(
        registered.response.request().postData() ?? "",
        registered.body,
        value,
      ),
    ).toEqual({
      credentialsMatch: true,
      consentMatches: true,
      acknowledgementMatches: true,
    });
    await assertNoPrivateRegistrationAccess(
      owned,
      (await registered.response.headerValue("set-cookie")) ?? "",
      value,
    );
    const pending = captureResponse(
      owned,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      owned.locator('input[autocomplete="one-time-code"]'),
      value.code,
    );
    const accepted = await pending;
    expect(
      accepted.response.status(),
      "delivered registration code accepted once",
    ).toBe(200);
    expect(
      verificationEvidence(
        accepted.response.request().postData() ?? "",
        accepted.body,
        value,
        value.code,
        world.hostBaseUrl,
      ),
    ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
    await owned.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await owned.waitForLoadState("networkidle");
    await assertSecureSession(owned, accepted.response, world.hostBaseUrl);
    await assertIdentity(value);
    value.cookie = (await context.cookies()).find(
      (cookie) => cookie.name === SESSION,
    )?.value;
    expect(
      typeof value.cookie === "string" && value.cookie.length > 0,
      "original session retained privately",
    ).toBe(true);
  },
);

When(
  "a cookie-free Academy guest submits that exact consumed registration code without requesting another challenge",
  async ({ page, browser, httpCredentials, world }) => {
    const value = state(page);
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const visitor = await context.newPage();
    value.guest = { context, page: visitor };
    visitor.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && isAuthCommandPath(path))
        value.posts.push(path);
    });
    expect(
      (await context.cookies()).some((cookie) => cookie.name === SESSION),
      "replay browser has no owner's cookie",
    ).toBe(false);
    // #3172 — the code step is the sign-in host's /verify door.
    await openHostCodeStep(visitor, world.hostBaseUrl, value.email, "/account");
    await visitor.waitForLoadState("networkidle");
    await assertNoPrivateRegistrationAccess(visitor, "", value);
    value.beforeReplay = await captureAddressedMailCheckpoint(
      nativeRecoveryMail(),
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      value.email,
    );
    const pending = captureResponse(
      visitor,
      signInHostApiPath("/v1/auth/verify"),
    );
    await inputSecret(
      visitor.locator('input[autocomplete="one-time-code"]'),
      value.code!,
    );
    const refused = await pending;
    let exactReplay = false;
    let generic = false;
    try {
      const request = hostCommand(refused.response.request().postDataJSON());
      const body = JSON.parse(refused.body);
      exactReplay =
        Object.keys(request).length === 2 &&
        request.email === value.email &&
        request.code === value.code;
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 400 &&
        body.message === "the request could not be completed" &&
        body.error === "Bad Request";
    } catch {
      /* Discard code-bearing parser diagnostics. */
    }
    expect(
      { status: refused.response.status(), exactReplay, generic },
      "only the retained consumed code is refused generically",
    ).toEqual({ status: 400, exactReplay: true, generic: true });
    await assertNoPrivateRegistrationAccess(
      visitor,
      (await refused.response.headerValue("set-cookie")) ?? "",
      value,
    );
  },
);

Then(
  "the guest receives only the generic verification refusal without private access",
  async ({ page, request, world }) => {
    const value = state(page);
    const visitor = value.guest!.page;
    await expect
      .poll(
        async () =>
          (await visitor.getByTestId("verify-error").ariaSnapshot()) ===
          "- alert: Код не подошёл. Проверьте его или запросите новый.",
      )
      .toBe(true);
    expect(new URL(visitor.url()).pathname).toBe("/verify");
    expect(
      (await visitor
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "refused cells cleared",
    ).toBe(true);
    expect(
      await visitor.evaluate(
        async () =>
          (
            await fetch("/v1/auth/session", {
              credentials: "include",
              cache: "no-store",
            })
          ).status,
      ),
      "guest has no session principal",
    ).toBe(401);
    await assertNoPrivateRegistrationAccess(visitor, "", value);
    expect(
      value.posts,
      "no new registration, resend or login-code challenge",
    ).toEqual([signInHostApiPath("/v1/auth/verify")]);
    await assertNoAddressedMail(
      request,
      process.env.E2E_MAILPIT_URL ?? mailpitUrlFor(world.hostBaseUrl),
      value.email,
      value.beforeReplay!,
    );
  },
);

Then(
  "the original verified Academy owner retains its identity and secure session after reload",
  async ({ page }) => {
    const value = state(page);
    await value.page.reload({ waitUntil: "load" });
    await value.page.waitForLoadState("networkidle");
    await assertIdentity(value);
    expect(
      (await value.context.cookies()).find((cookie) => cookie.name === SESSION)
        ?.value === value.cookie && value.cookie !== undefined,
      "owner's exact private session survives guest replay and reload",
    ).toBe(true);
  },
);

Then(
  "the original registration password still opens that same verified Academy account",
  async ({ page, baseURL, world }) => {
    const value = state(page);
    const guest = value.guest!;
    await prepareCaptchaForJourney(
      guest.context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await guest.page.goto(`${world.hostBaseUrl}/login?returnTo=%2Faccount`, {
      waitUntil: "load",
    });
    await guest.page.waitForLoadState("networkidle");
    await inputSecret(
      guest.page.locator('input[autocomplete="username"]'),
      value.email,
    );
    await inputSecret(
      guest.page.locator('input[autocomplete="current-password"]'),
      value.password,
    );
    // This positive owned-account probe creates no deliberate login failure to close.
    const pending = captureResponse(
      guest.page,
      signInHostApiPath("/v1/auth/login"),
    );
    await guest.page.getByTestId("password-login-submit").click();
    const loggedIn = await pending;
    let sameCredentials = false;
    try {
      const submitted = hostCommand(loggedIn.response.request().postDataJSON());
      sameCredentials =
        submitted.identifier === value.email &&
        submitted.password === value.password;
    } catch {
      /* Discard credential-bearing parser diagnostics. */
    }
    expect(
      { status: loggedIn.response.status(), sameCredentials },
      "original accepted registration password still authenticates",
    ).toEqual({ status: 200, sameCredentials: true });
    await guest.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await guest.page.waitForLoadState("networkidle");
    await assertSecureSession(
      guest.page,
      loggedIn.response,
      world.hostBaseUrl,
      [value.cookie!],
    );
    await assertIdentity(value, guest.page);
    expect(value.posts).toEqual([
      signInHostApiPath("/v1/auth/verify"),
      signInHostApiPath("/v1/auth/login"),
    ]);
  },
);

After("@verification-code-reuse", async ({ page }) => {
  const value = states.get(page);
  if (!value) return;
  let cleanupFailed = false;
  for (const owned of [value, ...(value.guest ? [value.guest] : [])]) {
    try {
      if (
        (await owned.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        const revoked = await owned.page.evaluate(async () => {
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
        expect(
          revoked,
          "only owned verification replay sessions revoked",
        ).toEqual({ logout: 200, session: 401, profile: 401 });
      }
    } catch {
      cleanupFailed = true;
    } finally {
      try {
        await owned.context.close();
      } catch {
        cleanupFailed = true;
      }
    }
  }
  states.delete(page);
  if (cleanupFailed) {
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned verification replay session cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned verification replay cleanup failed; original failure preserved; lead must inspect scoped cleanup.",
    });
  }
});
