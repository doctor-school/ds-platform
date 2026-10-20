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

const EXTERNAL = "https://unsafe-return-3061.invalid/private";
interface UnsafeReturn {
  context: BrowserContext;
  page: Page;
  base: string;
  email: string;
  password: string;
  subject?: string;
  externalRequests: number;
  externalNavigations: number;
}
const journeys = new WeakMap<Page, UnsafeReturn>();
function journey(page: Page): UnsafeReturn {
  const state = journeys.get(page);
  if (!state) throw new Error("Owned unsafe-return journey missing");
  return state;
}

async function identity(state: UnsafeReturn) {
  const result = await state.page.evaluate(
    async ({ email, subject }) => {
      const profile = await fetch("/v1/me/profile", {
        credentials: "include",
        cache: "no-store",
      });
      const session = await fetch("/v1/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const body = await profile.json().catch(() => ({}));
      const claims = await session.json().catch(() => ({}));
      return {
        subject: typeof claims.sub === "string" ? claims.sub : undefined,
        evidence: {
          profile: profile.status,
          session: session.status,
          sameEmail: body.email === email,
          verified: body.emailVerified === true,
          sameSubject:
            typeof claims.sub === "string" &&
            claims.sub.length > 0 &&
            (subject === undefined || claims.sub === subject),
        },
      };
    },
    { email: state.email, subject: state.subject },
  );
  expect(result.evidence, "same owned verified private account").toEqual({
    profile: 200,
    session: 200,
    sameEmail: true,
    verified: true,
    sameSubject: true,
  });
  state.subject ??= result.subject;
}

async function logout(state: UnsafeReturn) {
  const verdict = await state.page.evaluate(async () => {
    const result = await fetch("/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const profile = await fetch("/v1/me/profile", {
      credentials: "include",
      cache: "no-store",
    });
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    return {
      logout: result.status,
      profile: profile.status,
      session: session.status,
    };
  });
  expect(verdict, "owned session revoked").toEqual({
    logout: 200,
    profile: 401,
    session: 401,
  });
  expect(
    (await state.context.cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
    "owned cookie cleared",
  ).toBe(false);
}

Given(
  "a uniquely owned verified Academy account has logged out before the unsafe-return login",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const state: UnsafeReturn = {
      context,
      page: await context.newPage(),
      base: world.hostBaseUrl,
      email: `unsafe-return-3061-${randomUUID()}@example.test`,
      password: `Owned-${randomUUID()}-aA1!`,
      externalRequests: 0,
      externalNavigations: 0,
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
      state,
      "/account",
    );
    const pending = captureResponse(state.page, "/v1/auth/verify");
    await inputSecret(
      state.page.locator('input[autocomplete="one-time-code"]'),
      code,
    );
    const verified = await pending;
    expect(verified.response.status(), "owned email verified").toBe(200);
    await state.page.waitForURL((url) => url.pathname === "/account");
    await assertSecureSession(state.page, verified.response, state.base);
    await identity(state);
    await logout(state);
  },
);

When(
  "that owner signs in through the actual Academy password form carrying an external HTTPS return target",
  async ({ page, world }) => {
    const state = journey(page);
    const externalHost = new URL(EXTERNAL).hostname;
    // Observe even failed requests. DNS refusal must never count as safe routing.
    state.context.on("request", (request) => {
      if (new URL(request.url()).hostname === externalHost)
        state.externalRequests += 1;
    });
    state.page.on("framenavigated", (frame) => {
      if (
        frame.url().startsWith("https://") &&
        new URL(frame.url()).hostname === externalHost
      )
        state.externalNavigations += 1;
    });
    const login = new URL(world.host.loginPath, state.base);
    login.searchParams.set("method", "password");
    login.searchParams.set("returnTo", EXTERNAL);
    await state.page.goto(login.toString(), { waitUntil: "load" });
    await state.page.waitForLoadState("networkidle");
    expect(
      new URL(state.page.url()).origin === new URL(state.base).origin,
      "login remains on Academy",
    ).toBe(true);
    await inputSecret(
      state.page.locator('input[autocomplete="username"]'),
      state.email,
    );
    await inputSecret(
      state.page.locator('input[autocomplete="current-password"]'),
      state.password,
    );
    const pending = captureResponse(state.page, "/v1/auth/login");
    await state.page.getByRole("button", { name: /Войти|Продолжить/i }).click();
    const accepted = await pending;
    expect(
      {
        status: accepted.response.status(),
        acknowledgementMatches: accepted.body === '{"status":"authenticated"}',
      },
      "real password login succeeds",
    ).toEqual({ status: 200, acknowledgementMatches: true });
    // Academy host config landing.afterLogin and HOSTS.academy.eventsPath agree.
    await state.page.waitForURL(
      (url) =>
        url.origin === new URL(state.base).origin &&
        url.pathname === world.host.eventsPath &&
        url.search === "",
    );
    await assertSecureSession(state.page, accepted.response, state.base);
    const cookie = (await state.context.cookies()).find(
      (item) => item.name === "__Host-ds_session",
    );
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        cookie?.value ?? "",
      ),
      "session cookie is the opaque UUID handle, never a bearer JWT",
    ).toBe(true);
  },
);

Then(
  "Academy uses its current local default landing with the same private owner and attempts no external target request",
  async ({ page, world }) => {
    const state = journey(page);
    await state.page.waitForLoadState("networkidle");
    expect(
      new URL(state.page.url()).origin === new URL(state.base).origin &&
        new URL(state.page.url()).pathname === world.host.eventsPath,
      "actual default Academy destination",
    ).toBe(true);
    await expect(state.page.getByTestId("storefront-header")).toBeVisible();
    await identity(state);
    await state.page.goto(new URL("/account", state.base).toString());
    expect(
      await state.page
        .getByTestId("profile-email")
        .evaluate(
          (element, email) => element.textContent === email,
          state.email,
        ),
      "account screen renders the same owner",
    ).toBe(true);
    await identity(state);
    expect(
      {
        requests: state.externalRequests,
        navigations: state.externalNavigations,
      },
      "no attempted hostile-origin request, including failed navigation",
    ).toEqual({ requests: 0, navigations: 0 });
    await logout(state);
  },
);

After("@login-unsafe-return", async ({ page }) => {
  const state = journeys.get(page);
  if (!state) return;
  try {
    if (
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      )
    ) {
      if (state.page.isClosed()) state.page = await state.context.newPage();
      if (new URL(state.page.url()).origin !== new URL(state.base).origin)
        await state.page.goto(new URL("/login", state.base).toString());
      await logout(state);
    }
  } catch {
    await test.info().attach("owned-session-cleanup-failed", {
      body: "Owned unsafe-return session cleanup failed; no secret diagnostics retained.",
      contentType: "text/plain",
    });
    if (test.info().status === test.info().expectedStatus)
      throw new Error("Owned unsafe-return session cleanup failed");
  } finally {
    state.password = "";
    await state.context.close();
    journeys.delete(page);
  }
});
