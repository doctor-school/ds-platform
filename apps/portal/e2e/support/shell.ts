import { expect, type Page, type Locator } from "@playwright/test";

/**
 * 008 shared shell E2E helpers — selectors of the persistent academy chrome plus
 * the small live-stand actions the per-EARS shell specs and the shell journey
 * both need.
 *
 * Since #2180 the chrome itself is `@ds/storefront-shell`, mounted by
 * `components/academy-shell-header.tsx` (header) and `app/layout.tsx` (footer)
 * from the host values in `lib/shell-config.ts`. The test-ids below are the
 * PACKAGE's, shared with the doctor storefront; the two host-owned ones are the
 * auth-cluster fillers (`shell-login` / `shell-avatar`).
 *
 * Kept locale-agnostic where possible and RU-text only where the user-facing
 * string IS the surface under test (the theme-toggle accessible name, the
 * «Войти» chip), mirroring the sibling 004/005/006 specs.
 */

/** The theme-toggle accessible names — direction-specific since #2180, because
 *  the shared control announces WHICH theme activating it turns on. */
export const THEME_TOGGLE_TO_DARK = "Включить тёмную тему";
export const THEME_TOGGLE_TO_LIGHT = "Включить светлую тему";
/** The discovery front-door poster heading (feature-004 `webinars.title`). */
export const DISCOVERY_HEADING = "Расписание эфиров";
/** The retired scaffold card copy (EARS-9) — must be unreachable in the portal. */
export const SCAFFOLD_COPY = "Каркас приложения";
/** The `localStorage` theme key the vendored canvas persists (EARS-3). */
export const THEME_KEY = "ds-theme";
/** The discovery front-door the logo and «Эфиры» both point at (008 EARS-2). */
export const DISCOVERY_HREF = "/webinars";
/** The single nav item both storefronts ship (owner decision 2026-09-10). */
export const NAV_BROADCASTS = "Эфиры";

/**
 * The persistent chrome header region — scoped by the package's own test-id so
 * it is never confused with the feature-004 discovery poster `<header>` inside
 * `<main>`.
 */
export function shellHeader(page: Page): Locator {
  return page.getByTestId("storefront-header");
}

/** The chrome's wordmark link (package test-id since #2180). */
export function shellLogo(page: Page): Locator {
  return shellHeader(page).getByTestId("storefront-logo");
}

/**
 * The theme toggle. The shared chrome renders exactly ONE at every width (017
 * EARS-1 forbids a second copy in the DOM), so this is no longer a
 * desktop-specific locator.
 */
export function themeToggle(page: Page): Locator {
  return shellHeader(page).getByTestId("theme-toggle");
}

/** Is `.dark` currently on `<html>` (the theme SSOT,
 *  `@ds/storefront-shell/theme`)? */
export function isDark(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
}

/** The persisted explicit theme choice, if any. */
export function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => window.localStorage.getItem(key),
    THEME_KEY,
  );
}

/**
 * The ordered list of event-page links inside `<main>` (the discovery listing's
 * cards) — the fingerprint the guest and doctor renders of `/` must match exactly
 * (EARS-8: `/` does not branch its content on auth state).
 */
export function mainWebinarHrefs(page: Page): Promise<string[]> {
  return page
    .locator('main a[href^="/webinars/"]')
    .evaluateAll((els) =>
      els.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
}

/**
 * Persist a real display name for the currently-logged-in doctor via the shipped
 * `PUT /v1/me/display-name` command (006 EARS-14; no new endpoint), so the header
 * avatar renders GENUINE initials (EARS-5) rather than the no-name fallback glyph.
 * Fired from the page's own origin so the `__Host-ds_session` cookie + fingerprint
 * ride the request (ADR-0001 §6). `useHeaderAuth` reads once on mount and again on
 * the `refreshHeaderAuth()` signal from the auth flows (#1004) — a raw fetch fires
 * no signal, so a hard reload afterwards makes the header re-read the profile.
 */
export async function setMyDisplayName(page: Page, name: string): Promise<void> {
  const status = await page.evaluate(async (displayName) => {
    const res = await fetch("/v1/me/display-name", {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({ displayName }),
    });
    return res.status;
  }, name);
  expect(status, "SetDisplayName should succeed").toBeLessThan(300);
}
