"use client";

import { useEffect } from "react";

import { SYSTEM_DARK_QUERY, applyTheme, readStoredTheme } from "./theme";

/**
 * 006 EARS-12 — the live half of the Academy's "no stored choice → follow the
 * system `prefers-color-scheme`" (design §10). The inline pre-paint script
 * (`THEME_INIT_SCRIPT`) resolves the theme once, before
 * first paint; this watcher keeps an OPEN page in step when the SYSTEM scheme
 * changes underneath it (OS dark-mode schedule, manual OS flip) — but only
 * while the visitor has made no explicit choice. A persisted `ds-theme` always
 * wins, so with a stored value the change event is deliberately ignored.
 *
 * Renders nothing. Mounted by the Academy root layout and by the sign-in
 * host's Academy variant (#3170); the doctor storefront does not follow the
 * system scheme and mounts no watcher.
 */
export function ThemeWatcher() {
  useEffect(() => {
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const onChange = (event: MediaQueryListEvent | { matches: boolean }) => {
      if (readStoredTheme() !== null) return; // explicit choice wins
      applyTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return null;
}
