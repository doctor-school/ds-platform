import { test, expect } from "@playwright/test";
import {
  desktopThemeToggle,
  isDark,
  storedTheme,
} from "../support/shell";

/**
 * 008 EARS-3 — the header theme toggle switches the portal between light and dark
 * and PERSISTS the choice under `localStorage['ds-theme']`, so it survives a reload
 * and rides across navigation. The theme mechanism itself (system default, FOUC
 * guard, the room-header control) is pinned by 006 `theme.e2e.spec.ts`; HERE we
 * prove the APP-SHELL header's toggle drives that mechanism (EARS-3).
 *
 * Public-surface tier: only a running portal is needed (`E2E_PORTAL_URL`); the
 * toggle rides the guest header on `/`. `test.skip`s cleanly on a bare CI run.
 */

test.describe("008 EARS-3 app-shell theme toggle flips + persists (e2e)", () => {
  test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

  test("008 EARS-3: activating the header toggle flips the theme and persists it across reload and navigation", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const toggle = desktopThemeToggle(page);
    await expect(toggle).toBeVisible();

    // Flip the theme — read the resting state first so the assertion holds
    // regardless of the fresh-visit system default (headless chromium = light).
    const before = await isDark(page);
    await toggle.click();
    await expect
      .poll(() => isDark(page), { message: "the toggle flips .dark live" })
      .toBe(!before);
    // aria-pressed tracks the now-dark state, and the EXPLICIT choice persists.
    await expect(toggle).toHaveAttribute("aria-pressed", String(!before));
    expect(await storedTheme(page)).toBe(before ? "light" : "dark");

    // The choice survives a full reload (the FOUC guard re-applies it).
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await isDark(page), "persists across reload").toBe(!before);

    // …and rides across navigation to another portal surface.
    await page.goto("/webinars", { waitUntil: "domcontentloaded" });
    expect(await isDark(page), "persists across navigation").toBe(!before);
  });
});
