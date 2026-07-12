/**
 * 006 EARS-12 — the portal-wide theme SSOT (design §10). The theme IS the `.dark`
 * class on `<html>` (`document.documentElement`) — the exact scope the design
 * system's dark tokens target (`packages/design-system/src/styles/tokens.css`
 * overrides every semantic colour under `.dark`), so applying the class re-themes
 * the whole portal from the one token source, no per-component wiring.
 *
 * Resolution order (EARS-12): the `ds-theme` localStorage key — an EXPLICIT user
 * choice, always wins — then the system `prefers-color-scheme`. Key absent (or
 * corrupt, or storage unavailable) = no explicit choice → follow the system value.
 *
 * Three consumers share this module:
 *   • {@link THEME_INIT_SCRIPT} — the inline FOUC-guard `<script>` the root layout
 *     serves as the FIRST element of `<body>` (the App Router owns `<head>`, and a
 *     parser-blocking inline script ahead of all body content runs synchronously
 *     before anything below it can paint — the page never flashes the wrong
 *     theme). It ships as a self-contained string (it cannot import this module at
 *     runtime); `lib/theme.test.ts` EARS-12.5 pins it behaviourally identical to
 *     {@link resolveTheme} across every stored × system combination.
 *   • the room-header {@link ThemeToggle} — flips the class + persists the choice.
 *   • the {@link ThemeWatcher} — with NO stored choice the portal follows the
 *     system value LIVE (a media-query change re-resolves, design §10).
 */

/** The spec-pinned localStorage key (design §10) — `"light" | "dark"`, absent = no explicit choice. */
export const THEME_STORAGE_KEY = "ds-theme";

export type Theme = "light" | "dark";

/** The media query whose `matches` is the system half of the resolution. */
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The one resolution rule: a stored EXPLICIT choice (`"light"`/`"dark"`) wins;
 * anything else (absent/corrupt) falls through to the system scheme.
 */
export function resolveTheme(
  stored: string | null,
  systemPrefersDark: boolean,
): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemPrefersDark ? "dark" : "light";
}

/** Read the persisted explicit choice; `null` on absence, corruption, or blocked storage. */
export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Storage can be unavailable (privacy mode / blocked) — that is "no choice".
    return null;
  }
}

/** Apply a resolved theme to the DOM — the `.dark` class on `<html>` is the theme. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Persist an EXPLICIT user choice (it now wins over the system scheme) and apply it. */
export function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Blocked storage must not break the visible flip — the class still applies;
    // the choice simply won't survive the session (truthful degradation).
  }
  applyTheme(theme);
}

/**
 * The FOUC-guard inline script (EARS-12 — "applies the resolved theme before
 * first paint"). Self-contained ES5-safe source: same resolution as
 * {@link resolveTheme}, `try`-wrapped so blocked storage degrades to the system
 * scheme, and it TOGGLES (never only adds) so a stale `.dark` on a restored DOM
 * is corrected too. Parity with `resolveTheme` is pinned by `theme.test.ts`.
 */
export const THEME_INIT_SCRIPT = `(function () {
  var stored = null;
  try {
    stored = window.localStorage.getItem("${THEME_STORAGE_KEY}");
  } catch (e) {}
  var dark =
    stored === "dark" ||
    (stored !== "light" &&
      window.matchMedia("${SYSTEM_DARK_QUERY}").matches);
  document.documentElement.classList.toggle("dark", dark);
})();`;
