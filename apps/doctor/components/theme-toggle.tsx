"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Button } from "@ds/design-system/button";
import { cn } from "@ds/design-system/lib/utils";
import { persistTheme } from "@/lib/theme";

/**
 * 017 EARS-1 — the storefront shell's theme control (canvas `d-home · шапка`:
 * the 44×44 icon button on the navy header, both breakpoints).
 *
 * It is the DS `Button` primitive (`variant="ghost" size="icon"`), not a
 * hand-assembled `<button>`: the primitive owns the hover / active /
 * focus-visible states and the 44×44 icon geometry, and the transparent-at-rest
 * ghost lets the header palette show through. Only the `flex-none` layout class
 * and the `text-header-foreground` glyph colour are call-site classes.
 *
 * `<html class="dark">` is the theme's source of truth, so the pressed state
 * subscribes to the CLASS via `useSyncExternalStore` + a MutationObserver rather
 * than to local state — the control can never desync from a theme applied
 * outside it (the layout's pre-paint FOUC guard), and the server snapshot
 * (`false` = light, the storefront default) reconciles on the client with no
 * hydration mismatch.
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

/** SSR snapshot — light, the storefront default; the client reconciles it. */
function serverIsDark(): boolean {
  return false;
}

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(
    subscribeToHtmlClass,
    readIsDark,
    serverIsDark,
  );

  const onClick = useCallback(() => {
    persistTheme(readIsDark() ? "light" : "dark");
  }, []);

  return (
    <Button
      data-testid="theme-toggle"
      variant="ghost"
      size="icon"
      type="button"
      aria-pressed={dark}
      aria-label={dark ? "Включить светлую тему" : "Включить тёмную тему"}
      onClick={onClick}
      className={cn("flex-none text-header-foreground", className)}
    >
      {/* Decorative glyph — the accessible name lives on `aria-label`. U+FE0E
          forces monochrome TEXT presentation so the glyph takes the CSS colour
          instead of rasterising as a colour emoji that ignores it. */}
      <span aria-hidden="true">{dark ? "☀︎" : "☾︎"}</span>
    </Button>
  );
}
