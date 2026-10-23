import { signInHostApiPath } from "../lib/sign-in-host-api.js";
import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { prepareCaptchaForJourney } from "../lib/captcha-stub.js";
import { captureResponse } from "../lib/captured-response.js";
import {
  inputSecret,
  registerOwnedCredentials,
} from "../lib/owned-registration.js";
import { assertSecureSession } from "../lib/secure-session.js";
import { After, Given, Then, When, test } from "./support/auth-fixtures.js";

const SESSION = "__Host-ds_session";
interface RefreshJourney {
  context: BrowserContext;
  page: Page;
  email: string;
  cookie?: string;
  subject?: string;
  profile?: string;
}
const journeys = new WeakMap<Page, RefreshJourney>();
function journey(page: Page): RefreshJourney {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned explicit-refresh journey missing");
  return state;
}

async function assertSameOwner(state: RefreshJourney, base: string) {
  const result = await state.page.evaluate(
    async ({ email, subject, previous }) => {
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
      const readable = JSON.stringify({
        url: location.href,
        cookie: document.cookie,
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      return {
        profile: JSON.stringify(profile),
        subject: session.sub as string | undefined,
        evidence: {
          profileStatus: profileResponse.status,
          sessionStatus: sessionResponse.status,
          sameEmail: profile.email === email,
          verified: profile.emailVerified === true,
          sameSubject:
            subject === undefined
              ? typeof session.sub === "string" && !!session.sub
              : subject === session.sub,
          unchangedProfile:
            previous === undefined || previous === JSON.stringify(profile),
          noReadableSecrets:
            !/__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
              readable,
            ),
        },
      };
    },
    { email: state.email, subject: state.subject, previous: state.profile },
  );
  expect(
    result.evidence,
    "refresh retains the same private verified owner",
  ).toEqual({
    profileStatus: 200,
    sessionStatus: 200,
    sameEmail: true,
    verified: true,
    sameSubject: true,
    unchangedProfile: true,
    noReadableSecrets: true,
  });
  if (!result.subject) throw new Error("Owned refresh subject missing");
  state.subject ??= result.subject;
  state.profile ??= result.profile;
  const cookies = (await state.context.cookies()).filter(
    (cookie) => cookie.name === SESSION,
  );
  const cookie = cookies[0];
  expect(
    {
      count: cookies.length,
      same: state.cookie === undefined || cookie?.value === state.cookie,
      host: cookie?.domain === new URL(base).hostname,
      path: cookie?.path,
      secure: cookie?.secure,
      httpOnly: cookie?.httpOnly,
      sameSite: cookie?.sameSite,
    },
    "the original secure opaque session cookie survives refresh",
  ).toEqual({
    count: 1,
    same: true,
    host: true,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
  if (!cookie) throw new Error("Owned refresh session cookie missing");
  state.cookie ??= cookie.value;
}

Given(
  "a uniquely owned verified Academy account has a real private session for explicit refresh",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: RefreshJourney = {
      context,
      page: await context.newPage(),
      email: `session-refresh-3059-${randomUUID()}@example.test`,
    };
    journeys.set(page, state);
    await prepareCaptchaForJourney(
      context,
      world.hostBaseUrl,
      process.env.BOT_PROTECTION_ENABLED === "false" ? false : undefined,
    );
    const { code } = await registerOwnedCredentials(
      state.page,
      world.hostBaseUrl,
      { email: state.email, password: `Owned-${randomUUID()}-aA1!` },
      "/account",
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
    expect(
      verified.response.status(),
      "actual addressed email code verified",
    ).toBe(200);
    await state.page.waitForURL((url) => url.pathname === "/account");
    await state.page.waitForLoadState("networkidle");
    await assertSecureSession(state.page, verified.response, world.hostBaseUrl);
    await assertSameOwner(state, world.hostBaseUrl);
  },
);

When(
  "that Academy browser explicitly refreshes its actual provider-backed session",
  async ({ page, world }) => {
    const state = journey(page);
    const pending = captureResponse(state.page, "/v1/auth/refresh");
    const evidence = await state.page.evaluate(async () => {
      const response = await fetch("/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      return {
        status: response.status,
        acknowledgement:
          Object.keys(body).length === 1 && body.status === "refreshed",
        noTokens: !/token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
          JSON.stringify(body),
        ),
      };
    });
    const refreshed = await pending;
    expect(
      evidence,
      "real explicit refresh acknowledgement contains no tokens",
    ).toEqual({
      status: 200,
      acknowledgement: true,
      noTokens: true,
    });
    expect(
      (await refreshed.response.headerValue("set-cookie")) === null,
      "server-side refresh issues no new browser cookie",
    ).toBe(true);
    await assertSameOwner(state, world.hostBaseUrl);
    await state.page.reload({ waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    await assertSameOwner(state, world.hostBaseUrl);
  },
);

Then(
  "a cookie-free Academy browser cannot refresh while the original refreshed owner remains signed in",
  async ({ page, browser, httpCredentials, world }) => {
    const state = journey(page);
    const anonymous = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(world.hostBaseUrl, { waitUntil: "load" });
      expect(
        (await anonymous.cookies()).some((cookie) => cookie.name === SESSION),
        "negative boundary has no owner cookie",
      ).toBe(false);
      const pending = captureResponse(visitor, "/v1/auth/refresh");
      const refused = await visitor.evaluate(async () => {
        const response = await fetch("/v1/auth/refresh", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        const session = await fetch("/v1/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        const profile = await fetch("/v1/me/profile", {
          credentials: "include",
          cache: "no-store",
        });
        return {
          status: response.status,
          generic:
            Object.keys(body).length === 3 &&
            body.statusCode === 401 &&
            body.error === "Unauthorized" &&
            body.message === "authentication required",
          session: session.status,
          profile: profile.status,
        };
      });
      const response = await pending;
      expect(
        refused,
        "cookie-free refresh is generically refused without private access",
      ).toEqual({
        status: 401,
        generic: true,
        session: 401,
        profile: 401,
      });
      expect(
        (await response.response.headerValue("set-cookie")) === null,
        "anonymous refusal mints no session",
      ).toBe(true);
      expect(
        (await anonymous.cookies()).some((cookie) => cookie.name === SESSION),
      ).toBe(false);
    } finally {
      await anonymous.close();
    }
    await assertSameOwner(state, world.hostBaseUrl);
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "reloaded Academy renders the same owner",
    ).toBe(true);
  },
);

After("@session-explicit-refresh", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some((cookie) => cookie.name === SESSION)
    ) {
      const revoked = await state.page.evaluate(async () => {
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
      expect(revoked, "only the owned refresh session is revoked").toEqual({
        logout: 200,
        session: 401,
        profile: 401,
      });
    }
  } catch (error) {
    if (test.info().status === test.info().expectedStatus) throw error;
    test.info().annotations.push({
      type: "cleanup-failed",
      description:
        "Owned refresh logout failed; original scenario failure retained; lead must inspect scoped cleanup.",
    });
  } finally {
    await state.context.close();
    journeys.delete(page);
  }
});
