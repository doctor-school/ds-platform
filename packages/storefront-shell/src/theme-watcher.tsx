"use client";

import { useEffect, useLayoutEffect } from "react";

import { SYSTEM_DARK_QUERY, applyTheme, readStoredTheme } from "./theme";

export interface ThemeWatcherProps {
  /**
   * Whether the host follows the system `prefers-color-scheme` when no choice
   * is stored (the Academy, 006 EARS-12). `false` = the doctor storefront,
   * which applies only a stored explicit choice.
   */
  followSystem?: boolean;
}

/**
 * The client half of a storefront's theme mechanism; renders nothing.
 *
 * On mount it applies the resolved theme (stored explicit choice, then — when
 * `followSystem` — the system scheme). The host's inline pre-paint script
 * normally did that already and this is a no-op; but a document Next renders
 * on the client (the `__next_error__` document of a page-level `notFound()`,
 * #2478) never executes that inline script, so without this the page ignores
 * the visitor's theme. A layout effect runs before the client-rendered tree
 * paints, so that page does not flash either.
 *
 * With `followSystem` it also keeps an OPEN page in step when the SYSTEM
 * scheme changes underneath it (006 EARS-12, design §10) while the visitor
 * has made no explicit choice — a persisted `ds-theme` always wins.
 *
 * Mounted by both storefront root layouts and by the sign-in host's Academy
 * variant (#3170).
 */
export function ThemeWatcher({ followSystem = true }: ThemeWatcherProps) {
  useLayoutEffect(() => {
    const stored = readStoredTheme();
    if (stored !== null) {
      applyTheme(stored);
      return;
    }
    if (followSystem) {
      applyTheme(
        window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light",
      );
    }
  }, [followSystem]);

  useEffect(() => {
    if (!followSystem) return;
    const media = window.matchMedia(SYSTEM_DARK_QUERY);
    const onChange = (event: MediaQueryListEvent | { matches: boolean }) => {
      if (readStoredTheme() !== null) return; // explicit choice wins
      applyTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [followSystem]);

  return null;
}
