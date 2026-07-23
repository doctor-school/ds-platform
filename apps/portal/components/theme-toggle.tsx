"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Button } from "@ds/design-system/button";
import { cn } from "@ds/design-system/lib/utils";
import { persistTheme } from "@/lib/theme";

/**
 * The portal's canvas 44×44 theme icon-button, shared by the persistent app-shell
 * header (008 EARS-3) and the webinar-room header (006 EARS-12) — relocated here
 * from the room folder in #982 so both chrome surfaces mount the identical control
 * (DRY). Activating it flips the portal between light and dark by toggling the
 * `.dark` class on `<html>` and persists the now-EXPLICIT choice under `ds-theme`
 * — from then on the choice wins over the dark default on every load (the layout's
 * inline FOUC guard re-applies it before first paint).
 *
 * The control is the DS `Button` primitive (`variant="ghost" size="icon"` — the
 * 44×44 transparent-at-rest icon control, so the themed header palette shows
 * through and the glyph stays legible on the blue header in both themes; owner
 * Stage-B decision 2026-07-12 — never the DS form `switch.tsx`, which stays the
 * FORM switch primitive). The primitive owns the hover / active / focus-visible
 * states and the visual identity (#1107 re-base off the pre-#828 hand-assembled
 * `<button>`); only the layout `flex-none` and the `text-header-foreground` glyph
 * colour are call-site classes. The glyph is ☾ in
 * light / ☀ in dark (the canvas `themeIcon`). `aria-pressed` reflects the dark
 * state; the accessible name is injected from the message catalog by the parent
 * (no hardcoded user-facing string here); focus-visible uses the DS focus ring.
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
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-pressed={dark}
      aria-label={label}
      onClick={onClick}
      className={cn("flex-none text-header-foreground", className)}
    >
      {/* The canvas themeIcon glyph — decorative; the button's aria-label carries
          the accessible name (the glyph must not pollute it). U+FE0E (VARIATION
          SELECTOR-15) forces monochrome TEXT presentation — bare U+2600 ☀
          rasterizes via Segoe UI Emoji as a COLOR emoji that ignores CSS color
          and would never take `text-header-foreground` (spec §10). */}
      <span aria-hidden="true">{dark ? "☀︎" : "☾︎"}</span>
    </Button>
  );
}
