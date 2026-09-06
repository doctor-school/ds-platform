import { test, expect, type Page } from "@playwright/test";

/**
 * #1933 — the doctor storefront sign-in route as a CHROMELESS auth frame.
 *
 * The 017 shell guest cluster has pointed at `/login` since 017 shipped and the
 * route did not exist, so every signed-out visitor who pressed «Войти» met a
 * 404. This is the browser tier of the fix, and the only tier that can prove
 * what the Vitest projections cannot: that the shared `@ds/design-system/blocks`
 * `<LoginCard>` actually renders inside the doctor `(auth)` frame — no
 * storefront header, navigation or footer from ANY layer — at both the mobile
 * and desktop widths, that the sign-up door beside it leads to `/register` with
 * the arrival context intact, and that a rejected credential surfaces the
 * BLOCK's own error element rather than a doctor-local re-implementation of one.
 *
 * Backend-free tier (`playwright.ci.config.ts`): `/login` takes no server-side
 * api read that can fail the render, so it is collected here rather than in a
 * double-backed tier. The rejected-credential case fulfills `POST /v1/auth/login`
 * with a real 401 at the network edge — a genuinely unreachable api would take
 * the `authErrorMessage` UNAVAILABLE branch instead, which is a different
 * outcome from the one under test.
 */

/** The RU generic the host maps a rejected credential to (`lib/auth-error-message.ts`). */
const WRONG_PASSWORD_COPY = "Не удалось войти. Проверьте почту или телефон и пароль.";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

/** The block's own password form, reached through the ids it publishes. */
function passwordForm(page: Page) {
  return page.getByTestId("password-login-form");
}

for (const [label, viewport] of [
  ["mobile 390", MOBILE],
  ["desktop 1280", DESKTOP],
] as const) {
  test(`017 #1933: /login renders the shared LoginCard in the chromeless frame (${label})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");

    // The card is the SHARED block, identified by the ids it owns — a
    // doctor-local copy of the markup would not carry them.
    await expect(passwordForm(page)).toBeVisible();
    await expect(page.getByTestId("password-login-submit")).toBeVisible();
    await expect(page.getByTestId("login-method-password")).toBeVisible();
    await expect(page.getByTestId("login-method-otp")).toBeVisible();
    await expect(page.getByTestId("login-screen")).toBeVisible();

    // Chromeless, from every layer — the same contract 021 EARS-1.4 pins on the
    // sibling `/register` door: one screen, one CTA, no way to wander off it.
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.locator("footer")).toHaveCount(0);
    await expect(page.locator("nav")).toHaveCount(0);
    await expect(page.getByTestId("storefront-header")).toHaveCount(0);
    await expect(page.getByTestId("storefront-footer")).toHaveCount(0);

    // Exactly one non-empty h1: the block owns the heading, so a host that also
    // rendered one would double it (the defect this pins).
    const h1 = page.locator("h1");
    await expect(h1, "h1 count on /login").toHaveCount(1);
    await expect(h1, "h1 text on /login").not.toHaveText(/^\s*$/);
  });
}

test("017 #1933: the sign-up door leads to /register", async ({ page }) => {
  await page.goto("/login");

  const register = page.getByRole("link", { name: "Создать аккаунт" });
  await expect(register).toHaveAttribute("href", "/register");
  await register.click();
  await expect(page).toHaveURL(/\/register$/);
});

test("017 #1933: the sign-up door carries the arrival context onward", async ({
  page,
}) => {
  // The server validates `returnTo` and rebuilds the href, so a legitimate
  // in-app target must survive the hop into registration rather than be dropped
  // — otherwise a doctor sent to sign in from a gate loses where they were going
  // the moment they decide to register instead. This tier boots no api, so the
  // CONTEXT CARD cannot resolve; the guard-rebuilt href is what is under test
  // here, and it does not depend on that read.
  await page.goto("/login?returnTo=%2Fwebinars%2Fprp-pri-gonartroze");

  await expect(
    page.getByRole("link", { name: "Создать аккаунт" }),
  ).toHaveAttribute("href", "/register?returnTo=%2Fwebinars%2Fprp-pri-gonartroze");
});

test("017 #1933: a rejected credential renders the block's own error", async ({
  page,
}) => {
  await page.route("**/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ statusCode: 401, message: "Unauthorized" }),
    }),
  );

  await page.goto("/login");

  const form = passwordForm(page);
  await form.getByLabel("Почта или телефон").fill("doctor@clinic.ru");
  await form.getByLabel("Пароль", { exact: true }).fill("wrong-password-123");
  await page.getByTestId("password-login-submit").click();

  // `role="alert"` is the design system's `<FormError>` — the assertion is that
  // the message arrives through the BLOCK, carrying the host's RU mapping.
  const alert = form.getByRole("alert").filter({ hasText: WRONG_PASSWORD_COPY });
  await expect(alert).toBeVisible();

  // Still on the door: a failed sign-in must not navigate anywhere.
  await expect(page).toHaveURL(/\/login$/);
});
