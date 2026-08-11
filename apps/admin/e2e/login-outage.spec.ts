import { expect, test, type Page, type Route } from "@playwright/test";

// The catalog is the copy's single source: an assertion typed by hand here would
// pass while the screen showed something else. Playwright loads this spec as real
// ESM, so the JSON import carries the required attribute.
import ru from "../messages/ru.json" with { type: "json" };

/**
 * 011 EARS-3 + #1217 — what the LOGIN screen tells an operator when the IdP is
 * DOWN rather than when their password is wrong.
 *
 * `POST /v1/admin/auth/login` answers an honest 503 on `IdpUnavailableError`
 * (#1212) and checks nothing. Before this spec the admin client folded that into
 * the uniform «Не удалось войти. Проверьте данные» — telling an operator with
 * correct credentials to go re-check them, at the exact moment nothing about them
 * is in question. What has to be proven is a DISTINCTION between two rendered
 * states, which is precisely the assertion a unit test cannot make: the outage
 * alert present AND the credentials alert absent, with the typed input still in
 * the fields and the submit button still live.
 *
 * **Stand-free by construction.** Every `/v1/admin/auth/*` call is fulfilled by
 * `page.route`, so this drives the real screen in a real browser with NO api, no
 * Postgres and no Zitadel — a 503 from a live IdP is not something a stand can be
 * asked to produce on demand, and faking it at the wire is the only honest way to
 * reach the branch. It therefore needs only a booted admin app:
 *
 *   E2E_ADMIN_URL=http://localhost:3200 \
 *   pnpm --filter @ds/admin exec playwright test \
 *     --config=playwright.flows.config.ts e2e/login-outage.spec.ts
 */
const EMAIL = "admin@doctor.school";
const PASSWORD = "correct-horse-battery";

/** Fulfil the admin-auth surface in the browser: no api, no IdP, no stand. */
async function stubAdminAuth(page: Page, loginStatus: number): Promise<void> {
  await page.route("**/v1/admin/auth/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/state")) {
      // The mount guard: an unauthenticated browser is the one that gets a form.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ state: "unauthenticated" }),
      });
    }
    return route.fulfill({
      status: loginStatus,
      contentType: "application/json",
      body:
        loginStatus === 200
          ? JSON.stringify({ state: "mfa_pending_challenge" })
          : "",
    });
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await page.getByLabel(ru.login.email).fill(EMAIL);
  await page.getByLabel(ru.login.password).fill(PASSWORD);
  await page.getByTestId("login-submit").click();
}

test.describe("Admin login — IdP outage", () => {
  test("EARS-3: a 503 shows the outage warning, not a credentials verdict", async ({
    page,
  }) => {
    await stubAdminAuth(page, 503);
    await signIn(page);

    const outage = page.getByTestId("login-outage");
    await expect(outage).toBeVisible();
    await expect(outage).toContainText(ru.login.errorOutage);
    // The distinction IS the deliverable: the credentials alert must be absent.
    await expect(page.getByTestId("login-error")).toHaveCount(0);
    // Stage-A: no cooldown, no countdown — retry is one click away, with the
    // credentials still typed, because they were never checked.
    await expect(page.getByTestId("login-submit")).toBeEnabled();
    await expect(page.getByLabel(ru.login.email)).toHaveValue(EMAIL);
    await expect(page.getByLabel(ru.login.password)).toHaveValue(PASSWORD);
  });

  test("EARS-3: a 401 still shows the one uniform credentials message", async ({
    page,
  }) => {
    await stubAdminAuth(page, 401);
    await signIn(page);

    await expect(page.getByTestId("login-error")).toContainText(
      ru.login.errorGeneric,
    );
    await expect(page.getByTestId("login-outage")).toHaveCount(0);
  });

  test("EARS-3: a 429 still shows the throttling message", async ({ page }) => {
    await stubAdminAuth(page, 429);
    await signIn(page);

    await expect(page.getByTestId("login-error")).toContainText(
      ru.login.errorThrottled,
    );
    await expect(page.getByTestId("login-outage")).toHaveCount(0);
  });
});
