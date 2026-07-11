"use client";

import { useEffect } from "react";
import {
  SYSTEM_DARK_QUERY,
  applyTheme,
  readStoredTheme,
} from "../lib/theme";

/**
 * 006 EARS-12 — the live half of "no stored choice → follow the system
 * `prefers-color-scheme`" (design §10). The inline FOUC guard resolves the theme
 * once, before first paint; this watcher keeps an OPEN page in step when the
 * SYSTEM scheme changes underneath it (OS dark-mode schedule, manual OS flip) —
 * but only while the user has made no explicit choice. A persisted `ds-theme`
 * always wins, so with a stored value the change event is deliberately ignored
 * (and choosing later via the room-header toggle persists a choice that this
 * watcher then respects).
 *
 * Renders nothing; mounted once in the portal root layout so the mechanism is
 * portal-wide even though the only visible control is the room header's (#510
 * carries the wider placement).
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
