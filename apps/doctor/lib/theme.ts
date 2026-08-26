/**
 * Theme application + persistence for the doctor storefront.
 *
 * The `<html>` CLASS is the single source of truth for the active theme (the
 * design-system tokens declare `:root` for light and `.dark` for dark), and
 * `localStorage["ds-theme"]` records an EXPLICIT visitor choice so it survives
 * reloads. Deliberately a doctor-local copy of the portal's `lib/theme.ts` and
 * not an import: `apps/doctor` and `apps/portal` are separate deployables on
 * separate origins (ADR-0015 §2/§4), and cross-app source imports would couple
 * the storefront's release to the portal's.
 *
 * The storefront default is LIGHT — the canvas `doctor-home.dc.html` renders its
 * default state light (`dark: false`) — so the absence of a stored choice means
 * light, and the toggle is what makes dark an explicit, remembered decision.
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
  applyTheme(theme);
}

/**
 * The inline script the root layout runs BEFORE first paint, so a remembered
 * dark choice never flashes light. Kept as a string constant (not a module) on
 * purpose: it must execute synchronously in `<head>`, ahead of hydration.
 */
export const THEME_FOUC_GUARD = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark"){document.documentElement.classList.add("dark")}}catch(e){}`;
