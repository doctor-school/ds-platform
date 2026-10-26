import { test, expect, type Page } from "@playwright/test";

import {
  doorPath,
  HOST_ORIGIN,
  isIdpCallback,
  storefrontPageUrl,
} from "./support/sign-in-door";

/**
 * 003 EARS-5 / EARS-24 / EARS-70 / EARS-71 (#3172) — the sign-in host is ONE
 * stop of the person's journey. A hop between its doors replaces the host's
 * history entry, the registration code step takes one same-document entry of
 * its own, and the finished credential step leaves by replacing the entry the
 * person is on (off the code step: the form's): browser Back from the page the
 * person returns to is the page they signed in from — never a host address
 * whose auth request is spent, which the API sends on to the storefront's
 * landing (EARS-66), entry after entry. The code step's entry the browser
 * keeps ahead of it opens, on Forward, that spent request: the storefront. The page "before" is a page of the tier's double; the IdP callback
 * stands for the storefront page the callback returns to.
 */
const EVENT_PAGE = storefrontPageUrl("webinars/prp-pri-gonartroze");
const EMAIL = "doctor@clinic.ru";
const PASSWORD = "correct horse battery";

async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length);
}

async function signInWithPassword(page: Page) {
  const form = page.getByTestId("password-login-form");
  await form.getByLabel("Электронная почта или телефон").fill(EMAIL);
  await form.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByTestId("password-login-submit").click();
  await page.waitForURL(isIdpCallback);
}

async function tick(page: Page, testId: string) {
  await page.getByTestId(testId).locator("xpath=ancestor::label[1]").click();
  await expect(page.getByTestId(testId)).toBeChecked();
}

async function submitRegistration(page: Page) {
  await page.getByTestId("register-email").fill(EMAIL);
  await page.getByTestId("register-password").fill(PASSWORD);
  await tick(page, "register-medworker");
  await tick(page, "register-partner-data");
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("verify-back")).toBeVisible();
}

test.describe("003 EARS-5: Back after the sign-in is the page before it", () => {
  test("003 EARS-5: a password sign-in leaves the host by replacing its entry — Back is the storefront page", async ({
    page,
  }) => {
    await page.goto(EVENT_PAGE);
    await page.goto(doorPath("doctor", "login"));
    const depth = await historyLength(page);

    await signInWithPassword(page);

    expect(await historyLength(page)).toBe(depth);
    await page.goBack();
    await expect.poll(() => page.url()).toBe(EVENT_PAGE);
  });

  test("003 EARS-71: a hop between doors replaces the host's entry — Back from the door is the storefront page, Back after the sign-in too", async ({
    page,
  }) => {
    await page.goto(EVENT_PAGE);
    await page.goto(doorPath("doctor", "register"));
    const depth = await historyLength(page);

    await page.getByRole("link", { name: /Уже есть аккаунт/ }).click();
    await expect(page.getByTestId("password-login-form")).toBeVisible();
    expect(await historyLength(page)).toBe(depth);

    await signInWithPassword(page);

    expect(await historyLength(page)).toBe(depth);
    await page.goBack();
    await expect.poll(() => page.url()).toBe(EVENT_PAGE);
  });

  test("003 EARS-24 / EARS-5: the accepted registration code leaves no host entry behind — Back is the storefront page", async ({
    page,
  }) => {
    await page.goto(EVENT_PAGE);
    await page.goto(doorPath("doctor", "register"));
    const depth = await historyLength(page);
    await submitRegistration(page);

    await page.locator('input[autocomplete="one-time-code"]').fill("482913");
    await page.waitForURL(isIdpCallback);

    expect(await historyLength(page)).toBeLessThanOrEqual(depth + 1);
    await page.goBack();
    await expect.poll(() => page.url()).toBe(EVENT_PAGE);
  });

  test("003 EARS-5: Forward past the returned page opens the kept code-step entry, whose spent auth request lands on the storefront — never the sign-in host", async ({
    page,
  }) => {
    const once = `${Date.now().toString(36)}w${test.info().workerIndex}`;
    await page.goto(EVENT_PAGE);
    await page.goto(doorPath("doctor", "register", { once }));
    await submitRegistration(page);

    await page.locator('input[autocomplete="one-time-code"]').fill("482913");
    await page.waitForURL(isIdpCallback);

    await page.goBack();
    await expect.poll(() => page.url()).toBe(EVENT_PAGE);
    await page.goForward();
    await page.waitForURL(isIdpCallback);

    await page.goForward();
    await expect.poll(() => page.url()).toBe(storefrontPageUrl("login"));
    expect(page.url().startsWith(HOST_ORIGIN)).toBe(false);
  });

  test("003 EARS-39: the code accepted on a reloaded code step reaches the IdP callback — the reloaded step leaves by replacing its own entry, never by stepping back to the spent form", async ({
    page,
  }) => {
    const once = `${Date.now().toString(36)}r${test.info().workerIndex}`;
    await page.goto(EVENT_PAGE);
    await page.goto(doorPath("doctor", "register", { once }));
    await submitRegistration(page);

    await page.reload();
    await expect(page.getByTestId("verify-card")).toContainText(EMAIL);
    const formRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/register") {
        formRequests.push(request.url());
      }
    });
    await page.locator('input[autocomplete="one-time-code"]').fill("482913");
    await page.waitForURL(isIdpCallback);
    expect(formRequests).toEqual([]);

    // The form's entry (another document) stays behind the returned page:
    // Back opens its spent auth request, which EARS-66 sends to the storefront.
    await page.goBack();
    await expect.poll(() => page.url()).toBe(storefrontPageUrl("login"));
    expect(page.url().startsWith(HOST_ORIGIN)).toBe(false);
  });
});

test.describe("003 EARS-24: the code step's own history entry", () => {
  test("003 EARS-24: Back from the code step is the filled registration form; Forward is the step again", async ({
    page,
  }) => {
    await page.goto(EVENT_PAGE);
    await page.goto(doorPath("doctor", "register"));
    await submitRegistration(page);
    const step = page.url();
    expect(new URL(step).pathname).toBe("/verify");

    await page.goBack();
    await expect(page.getByTestId("register-email")).toHaveValue(EMAIL);
    await expect(page.getByTestId("register-password")).toHaveValue(PASSWORD);
    await expect(page.getByTestId("register-medworker")).toBeChecked();
    expect(new URL(page.url()).pathname).toBe("/register");

    await page.goForward();
    await expect(page.getByTestId("verify-card")).toContainText(EMAIL);
    expect(page.url()).toBe(step);
  });
});

test.describe("003 EARS-70: the host's door links never prefetch a door", () => {
  for (const door of ["login", "register", "reset"] as const) {
    test(`003 EARS-70: the ${door} door asks the host for nothing but navigations — no refused (403) background request`, async ({
      page,
    }) => {
      const refused: string[] = [];
      page.on("response", (response) => {
        if (response.status() === 403) refused.push(response.url());
      });
      await page.goto(doorPath("doctor", door));
      await page.waitForLoadState("networkidle");
      for (const link of await page.getByRole("link").all()) {
        await link.hover();
      }
      await page.waitForLoadState("networkidle");
      expect(refused).toEqual([]);
    });
  }
});
