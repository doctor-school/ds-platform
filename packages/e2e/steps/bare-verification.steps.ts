import { AUTH_REQUEST_PARAM, isSignInHostForm } from "../lib/sign-in-host-api.js";
import { isAuthCommandPath } from "../lib/sign-in-host-api.js";
import { TOP_LEVEL_NAVIGATION_HEADERS } from "../lib/storefront-entry.js";
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
  // #3172 — the storefront's `/verify` is an entry into the registration door
  // of the sign-in host: the replacement happens server-side (a `303`), so the
  // page settles on the host's form carrying only the IdP's auth request — the
  // IdP's arrival route, where the host opens the door the entry chose
  // (`apps/login/lib/sign-in-entry.ts` `doorFor`: `verify` → registration).
  // The return target rides the transaction, never the form URL.
  await expect(page.getByTestId("registration-form")).toBeVisible();
  const url = new URL(page.url());
  expect(isSignInHostForm(url)).toBe(true);
  expect(url.origin).not.toBe(new URL(base).origin);
  expect(url.pathname).not.toBe("/verify");
  expect([...url.searchParams.keys()]).toEqual([AUTH_REQUEST_PARAM]);
  const entry = entries.get(page);
  expect(entry?.origin, "the arrival entered through the storefront").toBe(
    new URL(base).origin,
  );
  expect(entry?.pathname).toBe("/verify");
  expect(entry?.searchParams.get("returnTo") ?? null).toBe(returnTo);
  await expectNoVerificationRender(page);
  expect(await page.evaluate(() => window.history.length)).toBeLessThanOrEqual(
    2,
  );

  await page.goBack();
  await expect.poll(() => page.url()).toBe("about:blank");
  await page.goForward();
  await expect(page.getByTestId("registration-form")).toBeVisible();
  expect(page.url()).toBe(url.toString());
  await expectNoVerificationRender(page);
}

/** The first request of the arrival's redirect chain (the storefront entry). */
const entries = new WeakMap<Page, URL>();

async function arrive(page: Page, target: string): Promise<void> {
  const response = await page.goto(target);
  let request = response?.request() ?? null;
  while (request?.redirectedFrom()) request = request.redirectedFrom();
  if (request) entries.set(page, new URL(request.url()));
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
      if (isAuthCommandPath(new URL(request.url()).pathname)) {
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
    await arrive(state.page, new URL("/verify", world.hostBaseUrl).toString());
    await state.page.waitForURL((url) => isSignInHostForm(url));
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
    // #3172 — the storefront's `/verify` renders no document at all: it is a
    // `303` entry with an empty body (the host's step HTML is pinned by the
    // sign-in host tier, `apps/login/e2e/academy-verify-bare-entry`).
    const response = await state.context.request.get(
      new URL("/verify", world.hostBaseUrl).toString(),
      { maxRedirects: 0, headers: TOP_LEVEL_NAVIGATION_HEADERS },
    );
    expect(response.status()).toBe(303);
    const html = await response.text();
    expect(html).toBe("");
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
    await arrive(state.page, target.toString());
    await state.page.waitForURL((url) => isSignInHostForm(url));
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
