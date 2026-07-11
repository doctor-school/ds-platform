"use client";

import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@ds/design-system/lib/utils";
import { persistTheme } from "../../../../lib/theme";

/**
 * 006 EARS-12 — the room-header theme toggle, the portal's ONLY visible theme
 * control until the #510 unified-portal-chrome rollout (owner Stage-A decision,
 * design §10). Activating it flips the portal between light and dark by toggling
 * the `.dark` class on `<html>` and persists the now-EXPLICIT choice under
 * `ds-theme` — from then on the choice wins over the dark default on every load
 * (the layout's inline FOUC guard re-applies it before first paint).
 *
 * The control is the canvas **44×44 icon-button** (`webinar-room.dc.html` line
 * 25, ADR-0013 canvas-wins; owner Stage-B decision 2026-07-12 — never the DS
 * form `switch.tsx`, which stays the FORM switch primitive): a `<button>` with a
 * transparent background, a 2px `header-hairline` border (the on-header muted
 * hairline, hover raising it to full-strength `header-foreground`), and the
 * full-strength header-foreground glyph — ☾ in light / ☀ in dark (the canvas
 * `themeIcon`). `aria-pressed` reflects the dark state; the accessible name is
 * injected from the message catalog by the parent (EARS-10 — no hardcoded
 * user-facing string here); focus-visible uses the DS focus ring.
 *
 * The `<html>` CLASS is the theme's single source of truth (`lib/theme.ts`), so
 * the pressed state is subscribed to the class itself via `useSyncExternalStore`
 * + a MutationObserver — the toggle can never desync from a theme applied outside
 * it (the FOUC guard before hydration), and the server snapshot (`false` = light)
 * is reconciled on the client without a hydration mismatch.
 */
function subscribeToHtmlClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function readIsDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** SSR snapshot — light; the client snapshot reconciles from the real class. */
function serverIsDark(): boolean {
  return false;
}

export function ThemeToggle({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const dark = useSyncExternalStore(
    subscribeToHtmlClass,
    readIsDark,
    serverIsDark,
  );

  const onClick = useCallback(() => {
    // An activation is an EXPLICIT user choice — persist it (it now wins over
    // the dark default) and apply it; the MutationObserver re-renders us.
    persistTheme(readIsDark() ? "light" : "dark");
  }, []);

  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-11 flex-none items-center justify-center border-2 border-header-hairline bg-transparent text-base text-header-foreground hover:border-header-foreground focus-visible:outline-none focus-visible:shadow-focus",
        className,
      )}
    >
      {/* The canvas themeIcon glyph — decorative; the button's aria-label carries
          the accessible name (the glyph must not pollute it). */}
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
    </button>
  );
}
