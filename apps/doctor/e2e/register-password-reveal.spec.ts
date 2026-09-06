import { test, expect } from "@playwright/test";

/**
 * 003 EARS-38 — the show-password toggle on the doctor storefront's registration
 * password field.
 *
 * The doctor host does not wire the affordance itself: `registration-screen.tsx`
 * renders the shared `<PasswordField>` and the toggle arrives with the primitive
 * (AGENTS.md §6 «Cross-front capability reuse before invention»). That is exactly
 * what this spec is for — proving the shared control actually reaches the second
 * storefront, so a future per-app fork would have to fail a test first.
 *
 * Backend-free tier (`playwright.ci.config.ts`): `/register` renders without an
 * api, and nothing here submits.
 *
 * Run locally:
 *   pnpm --filter @ds/doctor build
 *   pnpm --filter @ds/doctor exec playwright test \
 *     --config=playwright.ci.config.ts e2e/register-password-reveal.spec.ts
 */

const PASSWORD = "correct horse 42";

test.describe("003 EARS-38 — doctor /register password reveal", () => {
  test("EARS-38.1: masked by default, reveals and re-masks, value intact", async ({
    page,
  }) => {
    await page.goto("/register");
    const input = page.getByTestId("register-password");
    const toggle = page.getByTestId("register-password-reveal");
    await input.fill(PASSWORD);

    await expect(input).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveText("Показать");
    await expect(toggle).toHaveAttribute("aria-label", "Показать пароль");

    await toggle.click();
    await expect(input).toHaveAttribute("type", "text");
    await expect(input).toHaveValue(PASSWORD);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveText("Скрыть");

    await toggle.click();
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue(PASSWORD);
  });

  test("EARS-38.2: operable by keyboard alone, and the revealed state dies on reload", async ({
    page,
  }) => {
    await page.goto("/register");
    const input = page.getByTestId("register-password");
    const toggle = page.getByTestId("register-password-reveal");
    await input.fill(PASSWORD);
    await input.focus();

    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(input).toHaveAttribute("type", "text");
    await expect(toggle).toBeFocused();

    await page.reload();
    await expect(page.getByTestId("register-password")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(
      page.getByTestId("register-password-reveal"),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
