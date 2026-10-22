import { test, expect } from "@playwright/test";

/**
 * 003 EARS-40 (#2394) — a cold `/verify` with no address, browser tier
 * (Academy). The package tests (`@ds/auth-flow` `verify-door.test.tsx`) pin the
 * decision in jsdom; only a real browser proves the shipped page: the server
 * mount hands a bare arrival to the client half, which, finding no address in
 * the query, REPLACES onto the registration door — the step with a
 * generic «ваш аккаунт» description is never painted.
 *
 * Sign-in host tier (`playwright.ci.config.ts`, #3172 — the storefront's
 * `/verify` is a 303 entry now): the host renders the Academy's step from the
 * tier's entry double (`support/sign-in-entry-api.mjs`), and nothing here
 * submits a code — no api, Postgres or Zitadel is involved.
 *
 * Run locally:
 *   pnpm --filter @ds/login exec playwright test \
 *     --config=playwright.ci.config.ts e2e/academy-verify-bare-entry.e2e.spec.ts
 */

test.describe("003 EARS-40 — /verify without an address goes to /register", () => {
  test("003 EARS-29 (#2455): the verification mail carries no link, so a URL fragment is never an address — /verify#email= goes to /register", async ({
    page,
  }) => {
    await page.goto(
      "/verify?authRequest=academy-register#email=doc%40example.com",
    );

    await page.waitForURL((url) => url.pathname === "/register");
    await expect(page.getByTestId("verify-card")).toHaveCount(0);
  });

  test("EARS-40: the same-tab ?email= hop still renders the step with the address as typed", async ({
    page,
  }) => {
    // The server renders this step (so the bare-entry HTML check is not vacuous).
    const html = await (
      await page.request.get(
        "/verify?authRequest=academy-register&email=doc%40example.com",
        // EARS-70: the host renders a credential page only to a navigation.
        {
          headers: {
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
          },
        },
      )
    ).text();
    expect(html).toContain('data-testid="verify-card"');
    expect(html).toContain('data-testid="auth-wordmark"');

    await page.goto(
      "/verify?authRequest=academy-register&email=doc%40example.com",
    );

    await expect(page.getByTestId("verify-card")).toContainText(
      "Мы отправили код на doc@example.com.",
    );
    expect(new URL(page.url()).pathname).toBe("/verify");
  });
});
