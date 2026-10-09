import { expect, type BrowserContext, type Page } from "@playwright/test";

import { After, Given, Then, When } from "./support/auth-fixtures.js";

interface BareVerification {
  context: BrowserContext;
  page: Page;
  authRequests: number;
}
const arrivals = new WeakMap<Page, BareVerification>();
const RETURN_TO = "/webinars/ahilles-042";

function arrival(key: Page): BareVerification {
  const state = arrivals.get(key);
  if (!state)
    throw new Error("Address-less verification browser was not prepared");
  return state;
}

async function expectNoVerificationRender(page: Page) {
  await expect(page.getByTestId("verify-card")).toHaveCount(0);
  await expect(page.getByText("ваш аккаунт")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __dsBareVerificationRendered?: boolean })
          .__dsBareVerificationRendered,
    ),
    "no address-less verification step, description or frame entered the DOM",
  ).toBe(false);
}

async function expectReplacement(
  page: Page,
  base: string,
  returnTo: string | null,
) {
  await expect(page.getByTestId("registration-form")).toBeVisible();
  const url = new URL(page.url());
  expect(url.origin).toBe(new URL(base).origin);
  expect(url.pathname).toBe("/register");
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
  expect([...url.searchParams.keys()]).toEqual(returnTo ? ["returnTo"] : []);
  if (!returnTo) expect(url.search).toBe("");
  await expectNoVerificationRender(page);
  expect(await page.evaluate(() => window.history.length)).toBeLessThanOrEqual(
    2,
  );

  await page.goBack();
  await expect.poll(() => page.url()).toBe("about:blank");
  await page.goForward();
  await expect(page.getByTestId("registration-form")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/register");
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
  await expectNoVerificationRender(page);
}

Given(
  "a clean Academy browser with no private session for an address-less verification arrival",
  async ({ page, browser, httpCredentials, world }) => {
    expect(world.host.id).toBe("academy");
    const context = await browser.newContext({
      locale: "ru-RU",
      ...(httpCredentials ? { httpCredentials } : {}),
    });
    const owned = await context.newPage();
    const state: BareVerification = { context, page: owned, authRequests: 0 };
    arrivals.set(page, state);
    expect(await context.cookies()).toEqual([]);
    context.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/v1/auth/")) {
        state.authRequests += 1;
      }
    });
    await context.addInitScript(() => {
      const observed = window as Window & {
        __dsBareVerificationRendered?: boolean;
      };
      observed.__dsBareVerificationRendered = false;
      const selector =
        '[data-testid="verify-card"], [data-testid="auth-wordmark"]';
      new MutationObserver((records) => {
        if (
          location.pathname !== "/verify" ||
          new URL(location.href).searchParams.get("email")
        )
          return;
        if (
          document.querySelector(selector) ||
          document.body?.innerText.includes("ваш аккаунт")
        ) {
          observed.__dsBareVerificationRendered = true;
        }
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (
              node instanceof Element &&
              (node.matches(selector) || node.querySelector(selector))
            ) {
              observed.__dsBareVerificationRendered = true;
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
  },
);

When(
  /^that visitor opens bare \/verify and the route mounts$/,
  async ({ page, world }) => {
    const state = arrival(page);
    await state.page.goto(new URL("/verify", world.hostBaseUrl).toString());
    await state.page.waitForURL((url) => url.pathname === "/register");
    await state.page.waitForLoadState("networkidle");
  },
);

Then(
  /^registration replaces that address-less arrival and Back never returns to \/verify$/,
  async ({ page, world }) => {
    await expectReplacement(arrival(page).page, world.hostBaseUrl, null);
  },
);

Then(
  "the bare verification server HTML and mounted journey render no verification step, generic account description or auth frame",
  async ({ page, world }) => {
    const state = arrival(page);
    const response = await state.context.request.get(
      new URL("/verify", world.hostBaseUrl).toString(),
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    const html = await response.text();
    expect(html).not.toContain('data-testid="verify-card"');
    expect(html).not.toContain("ваш аккаунт");
    expect(html).not.toContain('data-testid="auth-wordmark"');
    await expectNoVerificationRender(state.page);
  },
);

When(
  /^that visitor opens \/verify without an address but with a same-origin webinar return target$/,
  async ({ page, world }) => {
    const state = arrival(page);
    state.page = await state.context.newPage();
    const target = new URL("/verify", world.hostBaseUrl);
    target.searchParams.set("returnTo", RETURN_TO);
    await state.page.goto(target.toString());
    await state.page.waitForURL((url) => url.pathname === "/register");
    await state.page.waitForLoadState("networkidle");
  },
);

Then(
  "registration replaces the arrival with that exact return target and grants no private access or auth command",
  async ({ page, world }) => {
    const state = arrival(page);
    await expectReplacement(state.page, world.hostBaseUrl, RETURN_TO);
    expect(
      (await state.context.cookies()).some(
        (cookie) => cookie.name === "__Host-ds_session",
      ),
      "address-less verification grants no private session",
    ).toBe(false);
    const profile = await state.context.request.get(
      new URL("/v1/me/profile", world.hostBaseUrl).toString(),
    );
    expect(profile.status(), "private profile stays inaccessible").toBe(401);
    expect(
      state.authRequests,
      "neither arrival sends an authentication request",
    ).toBe(0);
  },
);

After("@bare-verification", async ({ page }) => {
  const state = arrivals.get(page);
  if (!state) return;
  try {
    await state.context.close();
  } finally {
    arrivals.delete(page);
  }
});
