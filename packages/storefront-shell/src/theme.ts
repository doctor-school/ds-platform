/**
 * Theme application + persistence for the shared storefront chrome.
 *
 * The `<html>` CLASS is the single source of truth for the active theme (the
 * design-system tokens declare `:root` for light and `.dark` for dark), and
 * `localStorage["ds-theme"]` records an EXPLICIT visitor choice so it survives
 * reloads. The theme toggle is package-owned (#2180), so this module is too:
 * both storefronts previously carried a per-app copy of exactly this file, and
 * that twin is what the DEBT.md 2026-09-03 #1821 line tracked.
 *
 * The storefront default is LIGHT — the canvas `ds-shell.dc.html` renders its
 * default state light — so the absence of a stored choice means light, and the
 * toggle is what makes dark an explicit, remembered decision.
 */
export type Theme = "light" | "dark";

/** Storage key of the explicit visitor choice. Shared name across DS apps. */
export const THEME_STORAGE_KEY = "ds-theme";

/** Apply a theme by toggling the `.dark` class the DS tokens key off. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Read the stored explicit choice, or `null` when the visitor has never chosen.
 * Storage access throws in some privacy modes — a theme is never worth taking
 * the page down for, so a throw reads as "no stored choice".
 */
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

/** Record an explicit choice and apply it in the same turn. */
export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable — the choice still applies for this document.
  }
  // The sign-in host reads the choice from the cookie (#3171, below).
  writeThemeCookie(theme);
  applyTheme(theme);
}

/**
 * The inline script a host's root layout runs BEFORE first paint, so a
 * remembered dark choice never flashes light. Kept as a string constant (not a
 * module) on purpose: it must execute synchronously in `<head>`, ahead of
 * hydration.
 */
export const THEME_FOUC_GUARD = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark"){document.documentElement.classList.add("dark")}}catch(e){}`;

/** The media query whose `matches` is the system half of the Academy resolution. */
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The Academy's pre-paint theme script (006 EARS-12 — "applies the resolved
 * theme before first paint"): a stored EXPLICIT choice wins, otherwise the
 * system `prefers-color-scheme`. Self-contained ES5-safe source, `try`-wrapped
 * so blocked storage degrades to the system scheme, and it TOGGLES (never only
 * adds) so a stale `.dark` on a restored DOM is corrected too. Unlike
 * {@link THEME_FOUC_GUARD} (the doctor storefront's stored-choice-only guard)
 * it follows the system; {@link ThemeWatcher} keeps an open page in step.
 * Hosts: the Academy root layout and the sign-in host's Academy variant
 * (#3170); its parity with the portal's `resolveTheme` is pinned by the
 * portal's `lib/theme.test.ts`.
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

// --- the explicit choice as a cross-host preference cookie (#3171) -----------
// The sign-in host is its own origin (ADR-0015 §4), so `localStorage` there
// never sees the storefront's choice. The storefront therefore mirrors it into
// a non-auth preference cookie for its parent domain, which the host reads
// server-side. A display preference, not an auth cookie: ADR-0015 §4 req 4
// (host-only cookies) governs auth cookies only.

/** Name of the preference cookie — the same word as the storage key. */
export const THEME_COOKIE_NAME = THEME_STORAGE_KEY;

/** One year, in seconds. */
const THEME_COOKIE_MAX_AGE_S = 31_536_000;

/** `localhost`, a single-label name or a literal IP: no shared parent domain. */
function isLocalHostname(hostname: string): boolean {
  return (
    !hostname.includes(".") ||
    hostname.endsWith(".localhost") ||
    /^[0-9.]+$/.test(hostname) ||
    hostname.includes(":")
  );
}

/**
 * The cookie `Domain` a storefront host shares with the sign-in host: its
 * parent domain (`academy.doctor.school` → `doctor.school`,
 * `doctor-pr-7.stage.doctor.school` → `stage.doctor.school`); a two-label host
 * is its own parent; `undefined` (host-only) on localhost or an IP.
 */
export function themeCookieDomain(hostname: string): string | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isLocalHostname(host)) return undefined;
  const labels = host.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : host;
}

/**
 * The `document.cookie` assignment that records (`theme`) or clears (`null`)
 * the explicit choice for `hostname`. `Secure` everywhere but a local host.
 */
export function themeCookie(theme: Theme | null, hostname: string): string {
  const domain = themeCookieDomain(hostname);
  return [
    `${THEME_COOKIE_NAME}=${theme ?? ""}`,
    "Path=/",
    `Max-Age=${theme ? THEME_COOKIE_MAX_AGE_S : 0}`,
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`, "Secure"] : []),
  ].join("; ");
}

/** Mirror the explicit choice (or its absence) into the preference cookie. */
export function writeThemeCookie(theme: Theme | null): void {
  try {
    document.cookie = themeCookie(theme, window.location.hostname);
  } catch {
    // A cookie-less document keeps its own theme; only the host carry-over is lost.
  }
}

/**
 * Bring the cookie in line with the stored choice: a choice made before the
 * cookie existed starts travelling, and a cleared choice stops travelling.
 */
export function syncThemeCookie(): void {
  writeThemeCookie(readStoredTheme());
}

/** Read the preference cookie out of a request `Cookie` header (server side). */
export function themeFromCookieHeader(header: string | null): Theme | null {
  for (const part of (header ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === THEME_COOKIE_NAME && (value === "dark" || value === "light")) {
      return value;
    }
  }
  return null;
}
