import { expect, type Page, type Locator } from "@playwright/test";

/**
 * 008 shared shell E2E helpers — the persistent app-shell header
 * (`components/app-shell-header.tsx`) selectors + the small live-stand actions the
 * per-EARS shell specs and the shell journey both need. Kept locale-agnostic where
 * possible (stable `data-testid`s minted by the header component) and RU-text only
 * where the user-facing string IS the surface under test (the theme-toggle
 * accessible name, the «Войти» chip), mirroring the sibling 004/005/006 specs.
 */

/** The theme-toggle accessible name (shell catalog `themeToggle`, EARS-13). */
export const THEME_TOGGLE_LABEL = "Переключить тему";
/** The discovery front-door poster heading (feature-004 `webinars.title`). */
export const DISCOVERY_HEADING = "Расписание эфиров";
/** The retired scaffold card copy (EARS-9) — must be unreachable in the portal. */
export const SCAFFOLD_COPY = "Каркас приложения";
/** The `localStorage` theme key the vendored canvas persists (EARS-3). */
export const THEME_KEY = "ds-theme";

/**
 * The persistent app-shell header region — scoped by the logo test-id so it is
 * never confused with the feature-004 discovery poster `<header>` inside `<main>`.
 */
export function shellHeader(page: Page): Locator {
  return page.locator('header:has([data-testid="shell-logo"])');
}

/** The DESKTOP nav's theme toggle (the visible one at the ≥900px `layout` breakpoint). */
export function desktopThemeToggle(page: Page): Locator {
  return page
    .getByTestId("shell-nav-desktop")
    .getByRole("button", { name: THEME_TOGGLE_LABEL });
}

/** Is `.dark` currently on `<html>` (the theme SSOT, `lib/theme.ts`)? */
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
 * ride the request (ADR-0001 §6). A hard reload afterwards makes `useHeaderAuth`
 * re-read the profile (it fetches once per hard load).
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
