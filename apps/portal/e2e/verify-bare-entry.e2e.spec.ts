import { test, expect } from "@playwright/test";

/**
 * 003 EARS-40 (#2394) — a cold `/verify` with no address, browser tier
 * (Academy). The package tests (`@ds/auth-flow` `verify-door.test.tsx`) pin the
 * decision in jsdom; only a real browser proves the shipped page: the server
 * mount hands a bare arrival to the client half, which reads the fragment and,
 * finding no address, REPLACES onto the registration door — the step with a
 * generic «ваш аккаунт» description is never painted.
 *
 * Backend-free tier (`playwright.ci.config.ts`, its `testMatch` list): a
 * cookie-less `/verify` resolves the #675 guard as a guest without an upstream
 * read, the Academy landing is not specialty-aware, and nothing here submits a
 * code — no api, Postgres or Zitadel is involved.
 *
 * Run locally:
 *   pnpm --filter @ds/portal exec playwright test \
 *     --config=playwright.ci.config.ts e2e/verify-bare-entry.e2e.spec.ts
 */

test.describe("003 EARS-40 — /verify without an address goes to /register", () => {
  test("EARS-40: a bare /verify lands on /register, with no step painted on the way", async ({
    page,
  }) => {
    await page.goto("/verify");

    await page.waitForURL((url) => url.pathname === "/register");
    expect(new URL(page.url()).search).toBe("");
    await expect(page.getByTestId("verify-card")).toHaveCount(0);
    await expect(page.getByText("ваш аккаунт")).toHaveCount(0);
    // `replace`, not `push`: Back does not return to the address-less /verify.
    expect(
      await page.evaluate(() => window.history.length),
    ).toBeLessThanOrEqual(2);
  });

  test("EARS-40: the server HTML of a bare /verify carries no step and no shell to flash", async ({
    request,
  }) => {
    const html = await (await request.get("/verify")).text();

    expect(html).not.toContain('data-testid="verify-card"');
    expect(html).not.toContain("ваш аккаунт");
    // Nor the frame: the shell (its wordmark) sits inside the client gate.
    expect(html).not.toContain('data-testid="auth-wordmark"');
  });

  test("EARS-40: a bare /verify carries its returnTo onward to /register", async ({
    page,
  }) => {
    await page.goto("/verify?returnTo=%2Fwebinars%2Fahilles-042");

    await page.waitForURL((url) => url.pathname === "/register");
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(
      "/webinars/ahilles-042",
    );
  });

  test("EARS-40: the /verify#email= deep link still renders the step with the masked address", async ({
    page,
  }) => {
    await page.goto("/verify#email=doc%40example.com");

    await expect(page.getByTestId("verify-card")).toContainText(
      "d•••@e•••.com",
    );
    expect(new URL(page.url()).pathname).toBe("/verify");
  });

  test("EARS-40: the same-tab ?email= hop still renders the step with the masked address", async ({
    page,
  }) => {
    // The server renders this step (so the bare-entry HTML check is not vacuous).
    const html = await (
      await page.request.get("/verify?email=doc%40example.com")
    ).text();
    expect(html).toContain('data-testid="verify-card"');
    expect(html).toContain('data-testid="auth-wordmark"');

    await page.goto("/verify?email=doc%40example.com");

    await expect(page.getByTestId("verify-card")).toContainText(
      "d•••@e•••.com",
    );
    expect(new URL(page.url()).pathname).toBe("/verify");
  });
});
