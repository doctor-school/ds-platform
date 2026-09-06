import { test, expect, type Page } from "@playwright/test";

/**
 * 003 EARS-38 — the show-password toggle, browser tier (portal storefront).
 *
 * The RTL tests in `packages/design-system` pin the primitive contract; only a
 * real browser can prove the two halves that jsdom cannot: that the control is
 * operable by KEYBOARD alone (Tab to it, Space to press) and that the input's
 * rendering really flips between masked and plain on the shipped page.
 *
 * Backend-free tier (`playwright.ci.config.ts`, its `testMatch` list): `/login`
 * and `/register` render entirely client-side up to submit, so no api, Postgres
 * or Zitadel is involved — nothing here submits the form.
 *
 * Backend-free but NOT probe-free: both routes mount inside
 * `useRedirectIfAuthenticated`, whose `authClient.session()` read
 * (`GET /v1/auth/session`) never resolves when the BFF upstream is dead (the
 * fetch rejects, the guard stays pending, `<AuthShell>` renders NOTHING and
 * every locator times out) — the #1034 trap the sibling `a11y-axe.e2e.spec.ts`
 * documents at L17-25. Each test therefore opens through `openAnonymous()`,
 * which fulfils that probe with the 401 the real BFF returns for a cookie-less
 * visitor (`authClient.session()` maps 401 to null, i.e. "anonymous") and waits
 * for the page's real form before touching a field.
 *
 * Run locally:
 *   pnpm --filter @ds/portal exec playwright test \
 *     --config=playwright.ci.config.ts e2e/password-reveal.e2e.spec.ts
 */

const PASSWORD = "correct horse 42";

/** The `useRedirectIfAuthenticated` session probe (`authClient.session()`). */
const SESSION_PROBE = "**/v1/auth/session";

/**
 * Open an auth route as a deterministic anonymous visitor: the session probe is
 * fulfilled with a 401 (the cookie-less BFF answer) so the auth shell renders
 * with no backend, and the page's form is awaited so the surface exists before
 * the first `fill`. The route survives `page.reload()`, so the re-mask check
 * needs no re-arming.
 */
async function openAnonymous(page: Page, path: string): Promise<void> {
  await page.route(SESSION_PROBE, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "unauthorized" }),
    }),
  );
  await page.goto(path);
  await page.locator("form").first().waitFor({ state: "visible" });
}

/** The reveal toggle for the single password field on the page. */
function toggle(page: Page) {
  return page.getByRole("button", { name: /^(Показать|Скрыть) пароль$/ });
}

test.describe("003 EARS-38 — show-password toggle", () => {
  test("EARS-38.1: /login — masked by default, reveals on click, re-masks, value intact", async ({
    page,
  }) => {
    await openAnonymous(page, "/login");
    const input = page.locator("input[name='password']");
    await input.fill(PASSWORD);

    // Default state is masked and the control announces itself unpressed.
    await expect(input).toHaveAttribute("type", "password");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page)).toHaveText("Показать");

    await toggle(page).click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue(PASSWORD);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(page)).toHaveText("Скрыть");

    await toggle(page).click();
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue(PASSWORD);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("EARS-38.2: /login — the toggle is reachable and operable by keyboard alone", async ({
    page,
  }) => {
    await openAnonymous(page, "/login");
    const input = page.locator("input[name='password']");
    await input.fill(PASSWORD);
    await input.focus();

    // The control sits immediately after the field in the tab order.
    await page.keyboard.press("Tab");
    await expect(toggle(page)).toBeFocused();

    await page.keyboard.press("Space");
    await expect(input).toHaveAttribute("type", "text");
    // Pressing it from the keyboard must NOT pull focus away, or a second press
    // would be impossible without re-tabbing.
    await expect(toggle(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue(PASSWORD);
  });

  test("EARS-38.3: /register — the creation field carries the same toggle, masked on load", async ({
    page,
  }) => {
    await openAnonymous(page, "/register");
    const input = page.getByTestId("register-password");
    await input.fill(PASSWORD);
    await expect(input).toHaveAttribute("type", "password");

    await page.getByTestId("register-password-reveal").click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue(PASSWORD);

    // The revealed state never survives a page load (003 EARS-38).
    await page.reload();
    await expect(page.getByTestId("register-password")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(page.getByTestId("register-password-reveal")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
