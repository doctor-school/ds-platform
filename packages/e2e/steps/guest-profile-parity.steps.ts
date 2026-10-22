import { expect, type BrowserContext, type Page } from "@playwright/test";
import { After, Given, Then, When } from "./support/auth-fixtures.js";

const guests = new WeakMap<Page, { context: BrowserContext; page: Page }>();

function guest(key: Page) {
  const state = guests.get(key);
  if (!state) throw new Error("Guest profile browser was not prepared");
  return state;
}

async function assertGenericGuestReads(page: Page) {
  const evidence = await page.evaluate(async () => {
    const refusals = [];
    for (const path of ["/v1/me/profile", "/v1/me/display-name"]) {
      const response = await fetch(path, {
        credentials: "include",
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const record =
        body !== null && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {};
      refusals.push({
        status: response.status,
        genericMessage: record.message === "authentication required",
        genericBody:
          Object.keys(record).sort().join(",") === "error,message,statusCode" &&
          record.statusCode === 401 &&
          record.error === "Unauthorized",
      });
    }
    const session = await fetch("/v1/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    const sessionBody: unknown = await session.json();
    const readable = JSON.stringify({
      url: location.href,
      cookie: document.cookie,
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    });
    return {
      refusals,
      sessionStatus: session.status,
      sessionHasIdentity:
        sessionBody !== null &&
        typeof sessionBody === "object" &&
        Object.keys(sessionBody).some((key) =>
          /^(?:sub|roles|mfa|email|phone|displayName|access_token|refresh_token)$/i.test(
            key,
          ),
        ),
      readableSecret:
        /__Host-ds_session|access[_-]?token|refresh[_-]?token|eyJ[\w-]+\.[\w-]+\.[\w-]+/i.test(
          readable,
        ),
    };
  });
  expect(
    evidence,
    "guest receives only generic refusals without private identity",
  ).toEqual({
    refusals: [
      { status: 401, genericMessage: true, genericBody: true },
      { status: 401, genericMessage: true, genericBody: true },
    ],
    sessionStatus: 401,
    sessionHasIdentity: false,
    readableSecret: false,
  });
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "__Host-ds_session",
    ),
    "guest has no private session cookie",
  ).toBe(false);
}

Given(
  "a cookie-free Academy browser opens the ordinary login page for guest profile reads",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const visitor = await context.newPage();
    guests.set(page, { context, page: visitor });
    expect(await context.cookies(), "fresh guest context").toEqual([]);
    await visitor.goto(
      new URL(world.host.loginPath, world.hostBaseUrl).toString(),
      { waitUntil: "load" },
    );
    await expect(visitor.getByTestId("password-login-submit")).toBeVisible();
  },
);

When(
  "that Academy guest reads its profile and display-name through the actual browser origin",
  async ({ page }) => {
    await assertGenericGuestReads(guest(page).page);
  },
);

Then(
  "both guest reads retain the same generic refusal and account navigation exposes no private profile or session",
  async ({ page, world }) => {
    const visitor = guest(page).page;
    await visitor.goto(`${world.hostBaseUrl}/account`, { waitUntil: "load" });
    await visitor.waitForURL(
      (url) =>
        url.origin === new URL(world.hostBaseUrl).origin &&
        url.pathname === world.host.loginPath,
    );
    await expect(visitor.getByTestId("password-login-submit")).toBeVisible();
    for (const id of [
      "profile-name",
      "profile-email",
      "profile-phone",
      "session-sub",
      "session-roles",
      "logout",
    ]) {
      await expect(visitor.getByTestId(id)).toHaveCount(0);
    }
    await assertGenericGuestReads(visitor);
  },
);

After("@guest-profile-parity", async ({ page }) => {
  const state = guests.get(page);
  if (!state) return;
  try {
    await state.context.close();
  } finally {
    guests.delete(page);
  }
});
