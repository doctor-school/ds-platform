"use client";

import { useEffect, useState } from "react";

/**
 * Runtime page-level theme toggle for the showcase shell (#515). Flips the LIVE
 * theme by toggling the `.dark` class on `<html>` — the exact key the design
 * system uses (`packages/design-system/src/styles/tokens.css` scopes every dark
 * semantic-colour override under `.dark`), so the whole catalogue re-themes at
 * once from the one source of truth, no per-component wiring.
 *
 * Why runtime, not only the static side-by-side panels: a reviewer can now flip
 * the ENTIRE page (chrome + every ambient-theme section) to dark on the live URL
 * for a Stage-B eyes-on pass, instead of trusting an isolated `.dark` panel. The
 * §513 specimen pairs stay forced (`.light` / `.dark`) so they keep showing both
 * themes at once regardless of this toggle — the two mechanisms are complementary.
 *
 * Fixed, floating top-right; token-only styling that itself re-themes with the
 * toggle (card/foreground is an AA-safe themed pair in both themes, ≥44px hit
 * target, visible `focus-visible` ring). `aria-pressed` exposes the on/off state.
 */
export function ThemeToggle() {
  // Start `false` and reconcile from the DOM after mount so SSR and the first
  // client render agree (no hydration mismatch); the class is the source of truth.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="fixed right-4 top-4 z-50 inline-flex min-h-11 min-w-11 items-center gap-2 border-2 border-border bg-card px-4 py-2.5 text-sm font-bold text-card-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:shadow-focus"
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
      {dark ? "Light theme" : "Dark theme"}
    </button>
  );
}
