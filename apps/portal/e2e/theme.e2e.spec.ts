import { test, expect, type Page } from "@playwright/test";

/**
 * 006 EARS-12 — the portal-wide theme mechanism + the room-header toggle
 * (spec `apps/docs/content/specs/features/006-webinar-room/`, design §10):
 *   • fresh visit, no stored choice → the portal follows the system
 *     `prefers-color-scheme` (both directions);
 *   • the room-header toggle switches light↔dark by toggling `.dark` on `<html>`
 *     and persists the explicit choice under `ds-theme`;
 *   • a persisted explicit choice WINS over the system value, survives reloads
 *     and rides across routes (the mechanism is portal-wide even though the only
 *     visible control is the room header's, #510);
 *   • the inline FOUC guard applies the resolved theme BEFORE first paint — the
 *     first animation frame already carries the right class (never a flash).
 *
 * Two dev-stand tiers (mirroring `room.spec.ts`): the MECHANISM tests need only a
 * running portal (`E2E_PORTAL_URL`); the TOGGLE tests additionally ride the real
 * EARS-1 gate — a seeded live room + a registered doctor
 * (`E2E_ROOM_SLUG_LIVE`/`E2E_ROOM_SLUG_YOUTUBE`, `E2E_DOCTOR_EMAIL`/`_PASSWORD`).
 * Every test `test.skip`s when its env is absent, so a stray CI invocation is inert.
 */

const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const DOCTOR_EMAIL = process.env.E2E_DOCTOR_EMAIL;
const DOCTOR_PASSWORD = process.env.E2E_DOCTOR_PASSWORD;
const SLUG_LIVE =
  process.env.E2E_ROOM_SLUG_LIVE ?? process.env.E2E_ROOM_SLUG_YOUTUBE;

const THEME_KEY = "ds-theme";

/** Is `.dark` currently on `<html>`? */
function isDark(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

/** The persisted explicit choice, if any. */
function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
}

/**
 * Capture the `<html>` class at the FIRST animation frame — the earliest moment a
 * frame could have painted. The init script runs at document creation (before the
 * inline FOUC guard), so if the guard were late the first frame would carry the
 * wrong class and this capture would expose the flash.
 */
async function armFirstPaintProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      (window as unknown as Record<string, unknown>).__dsFirstFrameDark =
        document.documentElement.classList.contains("dark");
    });
  });
}

function firstFrameDark(page: Page): Promise<boolean | undefined> {
  return page.waitForFunction(
    () =>
      (window as unknown as Record<string, unknown>).__dsFirstFrameDark !==
      undefined,
  ).then(() =>
    page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>).__dsFirstFrameDark as
          | boolean
          | undefined,
    ),
  );
}

/** Persist an explicit choice BEFORE any document of the context loads. */
async function seedStoredTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [THEME_KEY, theme] as const,
  );
}

/** The room-header theme switch (the DS `switch.tsx` `role="switch"` input). */
function themeSwitch(page: Page) {
  return page.getByRole("switch", { name: "Переключить тему" });
}

/**
 * The user's CLICK surface: the DS switch keeps its real checkbox visually
 * hidden (`sr-only`), so a pointer activation lands on the wrapping label/track
 * — exactly what a doctor clicks. Keyboard (space) still targets the input.
 */
function themeSwitchClickTarget(page: Page) {
  return themeSwitch(page).locator("xpath=ancestor::label[1]");
}

/** Log the doctor in through the real 003 flow (identifier + password). */
async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /почта|email/i }).fill(DOCTOR_EMAIL!);
  await page
    .getByRole("textbox", { name: /пароль|password/i })
    .fill(DOCTOR_PASSWORD!);
  await page.getByRole("button", { name: /войти|продолжить/i }).click();
  await page.waitForURL(/\/account|\/webinars/);
}

// The leading `006 EARS-12 ` prefix is the ears-test-lint feature scope — a
// parenthesized mid-title does NOT scope.
test.describe("006 EARS-12 portal-wide theme mechanism — system default, explicit override, no FOUC (e2e)", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL,
    "requires a live portal (E2E_PORTAL_URL) — manual gate",
  );

  test("006 EARS-12: with no stored choice a fresh visit follows the system prefers-color-scheme (both directions)", async ({
    browser,
  }) => {
    for (const scheme of ["dark", "light"] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      expect(await storedTheme(page), "fresh visit stores nothing").toBeNull();
      expect(await isDark(page), `system=${scheme}`).toBe(scheme === "dark");
      await context.close();
    }
  });

  test("006 EARS-12: a persisted explicit choice WINS over the system value (both directions)", async ({
    browser,
  }) => {
    for (const [stored, scheme] of [
      ["light", "dark"],
      ["dark", "light"],
    ] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await seedStoredTheme(page, stored);
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      expect(await isDark(page), `stored=${stored} system=${scheme}`).toBe(
        stored === "dark",
      );
      await context.close();
    }
  });

  test("006 EARS-12: the FOUC guard applies the resolved theme BEFORE the first painted frame", async ({
    browser,
  }) => {
    // Stored dark on a light-system browser — the hardest case: any late
    // application would paint the (wrong) light default first.
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await seedStoredTheme(page, "dark");
    await armFirstPaintProbe(page);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    expect(
      await firstFrameDark(page),
      "the first animation frame already carries .dark — no wrong-theme flash",
    ).toBe(true);
    await context.close();
  });

  test("006 EARS-12: the persisted choice rides across routes — every portal surface resolves it", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await seedStoredTheme(page, "dark");
    for (const path of ["/login", "/webinars"]) {
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      expect(await isDark(page), path).toBe(true);
    }
    await context.close();
  });
});

// The leading `006 EARS-12 ` prefix is the ears-test-lint feature scope.
test.describe("006 EARS-12 room-header theme toggle — flips .dark live, persists, survives reload (e2e)", () => {
  test.skip(
    !process.env.E2E_PORTAL_URL || !DOCTOR_EMAIL || !DOCTOR_PASSWORD || !SLUG_LIVE,
    "requires a live portal + a doctor registered for the seeded live room",
  );

  test("006 EARS-12: activating the header toggle switches the theme live, persists it, and the choice survives reload from first paint", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await login(page);
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}/room$`));

    const toggle = themeSwitch(page);
    await expect(themeSwitchClickTarget(page)).toBeVisible();
    await expect(toggle).not.toBeChecked();
    expect(await isDark(page)).toBe(false);

    // Flip to dark — the class lands LIVE (no reload) and the choice persists.
    await themeSwitchClickTarget(page).click();
    await expect(toggle).toBeChecked();
    expect(await isDark(page)).toBe(true);
    expect(await storedTheme(page)).toBe("dark");

    // Reload — the FOUC guard resolves the persisted dark before first paint.
    await armFirstPaintProbe(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await firstFrameDark(page)).toBe(true);
    expect(await isDark(page)).toBe(true);
    await expect(themeSwitch(page)).toBeChecked();

    // The choice rides across routes (portal-wide mechanism, room-only control).
    await page.goto(`${BASE}/webinars`, { waitUntil: "domcontentloaded" });
    expect(await isDark(page)).toBe(true);

    // Back in the room, flip back to light — persisted and stable on reload.
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    const toggleAgain = themeSwitch(page);
    await expect(toggleAgain).toBeChecked();
    await themeSwitchClickTarget(page).click();
    await expect(toggleAgain).not.toBeChecked();
    expect(await isDark(page)).toBe(false);
    expect(await storedTheme(page)).toBe("light");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await isDark(page)).toBe(false);

    await context.close();
  });

  test("006 EARS-12: an explicit light choice beats a dark system scheme on every later room visit", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await seedStoredTheme(page, "light");
    await login(page);
    await page.goto(`${BASE}/webinars/${SLUG_LIVE}/room`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(new RegExp(`/webinars/${SLUG_LIVE}/room$`));
    expect(await isDark(page)).toBe(false);
    await expect(themeSwitch(page)).not.toBeChecked();
    await context.close();
  });
});
