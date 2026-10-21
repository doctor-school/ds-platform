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
  verificationRefusalEvidence,
  type OwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { test, After, Given, When, Then } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface OwnedBrowser {
  context: BrowserContext;
  page: Page;
}
interface Registrant extends OwnedCredentials, OwnedBrowser {
  code: string;
  posts: string[];
  subject?: string | undefined;
  phoneState?: string | undefined;
  cookie?: string | undefined;
}
interface Isolation {
  owners: Registrant[];
  guest?: OwnedBrowser;
}
const states = new WeakMap<Page, Isolation>();
function state(key: Page): Isolation {
  const value = states.get(key);
  if (!value) throw new Error("Owned registration isolation not prepared");
  return value;
}

async function identity(owner: Registrant, page = owner.page) {
  const result = await page.evaluate(
    async ({ email, subject, phoneState }) => {
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
          samePhone: phoneState === undefined || currentPhone === phoneState,
          noPhone: profile.phone === null && profile.phoneVerified === null,
        },
      };
    },
    {
      email: owner.email,
      subject: owner.subject,
      phoneState: owner.phoneState,
    },
  );
  expect(
    result.evidence,
    "verified rightful owner and unchanged absent phone",
  ).toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    subjectPresent: true,
    sameSubject: true,
    samePhone: true,
    noPhone: true,
  });
  owner.subject = result.subject;
  owner.phoneState = result.phoneState;
  expect(
    await page
      .getByTestId("profile-email")
      .evaluate((element, email) => element.textContent === email, owner.email),
    "owned email rendered",
  ).toBe(true);
  await expect(page.getByTestId("profile-email-verified")).toBeVisible();
}

Given(
  "two owned Academy registrants retain distinct actually delivered live confirmation codes",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const value: Isolation = { owners: [] };
    states.set(page, value);
    for (const role of ["a", "b"]) {
      const context = await browser.newContext({
        locale: "ru-RU",
        ...(httpCredentials ? { httpCredentials } : {}),
      });
      const owner: Registrant = {
        context,
        page: await context.newPage(),
        code: "",
        posts: [],
        email: `verification-isolation-3137-${role}-${randomUUID().replaceAll("-", "")}@example.test`,
        password: `Isolation-${randomUUID()}-aA1!`,
      };
      value.owners.push(owner);
      expect(
        owner.email.split("@")[0]!.length <= 64,
        "owned email local part fits the provider limit",
      ).toBe(true);
      owner.page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && path.startsWith("/v1/auth/"))
          owner.posts.push(path);
      });
      await prepareCaptchaForJourney(
        context,
        baseURL ?? world.hostBaseUrl,
        process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
      );
      const registered = await registerOwnedCredentials(
        owner.page,
        world.hostBaseUrl,
        owner,
        "/account",
      );
      owner.code = registered.code;
      expect(
        registrationEvidence(
          registered.response.request().postData() ?? "",
          await registered.response.text(),
          owner,
        ),
      ).toEqual({
        credentialsMatch: true,
        consentMatches: true,
        acknowledgementMatches: true,
      });
      expect(
        /^\d{6}$/.test(owner.code),
        "actual delivered six-digit owner code",
      ).toBe(true);
      await assertNoPrivateRegistrationAccess(
        owner.page,
        (await registered.response.headerValue("set-cookie")) ?? "",
        owner,
      );
    }
    expect(
      value.owners[0]!.code !== value.owners[1]!.code,
      "independently delivered live codes differ; a collision fails without reroll",
    ).toBe(true);
  },
);

When(
  "the second registrant submits the first registrant's live confirmation code",
  async ({ page }) => {
    const [first, second] = state(page).owners as [Registrant, Registrant];
    const pending = captureResponse(second.page, "/v1/auth/verify");
    await inputSecret(
      second.page.locator('input[autocomplete="one-time-code"]'),
      first.code,
    );
    const refused = await pending;
    expect(refused.response.status(), "foreign live code refused").toBe(400);
    expect(
      verificationRefusalEvidence(
        refused.response.request().postData() ?? "",
        refused.body,
        second,
        second.code,
        first.code,
      ),
    ).toEqual({
      credentialsMatch: true,
      wrongCode: true,
      refusalMatches: true,
    });
    await assertNoPrivateRegistrationAccess(
      second.page,
      (await refused.response.headerValue("set-cookie")) ?? "",
      second,
    );
  },
);

Then(
  "Academy refuses the foreign code generically and the second account remains unverified without private access",
  async ({ page, browser, baseURL, httpCredentials, world }) => {
    const value = state(page);
    const second = value.owners[1]!;
    await expect
      .poll(
        async () =>
          (await second.page.getByTestId("verify-error").ariaSnapshot()) ===
          "- alert: Код не подошёл. Проверьте его или запросите новый.",
      )
      .toBe(true);
    expect(new URL(second.page.url()).pathname).toBe("/verify");
    expect(
      (await second.page
        .locator('input[autocomplete="one-time-code"]')
        .inputValue()) === "",
      "refused cells cleared",
    ).toBe(true);
    await assertNoPrivateRegistrationAccess(second.page, "", second);
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const guest = { context, page: await context.newPage() };
    value.guest = guest;
    await prepareCaptchaForJourney(
      context,
      baseURL ?? world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    await passwordLogin(guest.page, second, world.hostBaseUrl, 401);
    await assertNoPrivateRegistrationAccess(guest.page, "", second);
  },
);

async function passwordLogin(
  page: Page,
  owner: Registrant,
  base: string,
  expectedStatus: number,
) {
  await page.goto(`${base}/login?returnTo=%2Faccount`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await inputSecret(
    page.locator('input[autocomplete="username"]'),
    owner.email,
  );
  await inputSecret(
    page.locator('input[autocomplete="current-password"]'),
    owner.password,
  );
  const pending = captureResponse(page, "/v1/auth/login");
  await page.getByTestId("password-login-submit").click();
  const result = await pending;
  let exactCredentials = false;
  try {
    const submitted = result.response.request().postDataJSON();
    exactCredentials =
      submitted.identifier === owner.email &&
      submitted.password === owner.password;
  } catch {
    /* Discard credential-bearing parser diagnostics. */
  }
  expect(
    { status: result.response.status(), exactCredentials },
    "original owned password submitted",
  ).toEqual({ status: expectedStatus, exactCredentials: true });
  if (expectedStatus === 401) {
    let generic = false;
    try {
      const body = JSON.parse(result.body);
      generic =
        Object.keys(body).length === 3 &&
        body.statusCode === 401 &&
        body.message === "the request could not be completed" &&
        body.error === "Unauthorized";
    } catch {
      /* Discard private response parser diagnostics. */
    }
    expect(generic, "unverified owner password refused generically").toBe(true);
    expect(
      ((await result.response.headerValue("set-cookie")) ?? "").includes(
        `${SESSION}=`,
      ),
      "unverified password grants no session",
    ).toBe(false);
  }
  return result.response;
}

When(
  "each registrant submits its own retained confirmation code",
  async ({ page, world }) => {
    for (const owner of state(page).owners) {
      const pending = captureResponse(owner.page, "/v1/auth/verify");
      await inputSecret(
        owner.page.locator('input[autocomplete="one-time-code"]'),
        owner.code,
      );
      const accepted = await pending;
      expect(
        accepted.response.status(),
        "retained rightful-owner challenge accepted",
      ).toBe(200);
      expect(
        verificationEvidence(
          accepted.response.request().postData() ?? "",
          accepted.body,
          owner,
          owner.code,
        ),
      ).toEqual({ credentialsMatch: true, acknowledgementMatches: true });
      await owner.page.waitForURL(
        (url) =>
          url.origin === new URL(world.hostBaseUrl).origin &&
          url.pathname === "/account",
      );
      await owner.page.waitForLoadState("networkidle");
      await assertSecureSession(
        owner.page,
        accepted.response,
        world.hostBaseUrl,
      );
      await identity(owner);
      owner.cookie = (await owner.context.cookies()).find(
        (cookie) => cookie.name === SESSION,
      )?.value;
      expect(
        typeof owner.cookie === "string" && owner.cookie.length > 0,
        "owner session retained privately",
      ).toBe(true);
    }
  },
);

Then(
  "both rightful owners reach their own verified Academy profiles with secure sessions surviving reload",
  async ({ page }) => {
    const value = state(page);
    expect(
      value.owners[0]!.posts,
      "first owner never replaces its challenge",
    ).toEqual(["/v1/auth/register", "/v1/auth/verify"]);
    expect(
      value.owners[1]!.posts,
      "second owner retries only the retained challenge",
    ).toEqual(["/v1/auth/register", "/v1/auth/verify", "/v1/auth/verify"]);
    expect(
      value.owners[0]!.subject !== value.owners[1]!.subject,
      "two distinct rightful principals",
    ).toBe(true);
    for (const owner of value.owners) {
      await owner.page.reload({ waitUntil: "load" });
      await owner.page.waitForLoadState("networkidle");
      await identity(owner);
      expect(
        (await owner.context.cookies()).find(
          (cookie) => cookie.name === SESSION,
        )?.value === owner.cookie,
        "same owner cookie survives reload",
      ).toBe(true);
    }
  },
);

Then(
  "the second account's original password now authenticates its previously refused guest",
  async ({ page, world }) => {
    const value = state(page);
    const second = value.owners[1]!;
    const guest = value.guest!;
    const response = await passwordLogin(
      guest.page,
      second,
      world.hostBaseUrl,
      200,
    );
    await guest.page.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === "/account",
    );
    await guest.page.waitForLoadState("networkidle");
    await assertSecureSession(guest.page, response, world.hostBaseUrl, [
      second.cookie!,
    ]);
    await identity(second, guest.page);
  },
);

After("@verification-code-isolation", async ({ page }) => {
  const value = states.get(page);
  if (!value) return;
  let cleanupFailed = false;
  for (const owned of [
    ...value.owners,
    ...(value.guest ? [value.guest] : []),
  ]) {
    try {
      if (
        (await owned.context.cookies()).some(
          (cookie) => cookie.name === SESSION,
        )
      ) {
        const result = await owned.page.evaluate(async () => {
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
        expect(result, "owned isolation session revoked").toEqual({
          logout: 200,
          session: 401,
          profile: 401,
        });
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
      throw new Error("Owned registration isolation cleanup failed");
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned registration isolation cleanup failed; original failure preserved; lead must inspect scoped cleanup.",
    });
  }
});
