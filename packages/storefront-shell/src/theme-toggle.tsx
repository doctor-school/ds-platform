"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Button } from "@ds/design-system/button";
import { cn } from "@ds/design-system/lib/utils";

import { persistTheme } from "./theme";

/**
 * 008 EARS-3 · 017 EARS-1 — the storefront theme control (canvas
 * `ds-shell.dc.html`: the 44×44 icon button on the navy header, both
 * breakpoints). Package-owned since #2180: the two storefronts each carried an
 * identical copy, the twin the DEBT.md 2026-09-03 #1821 line tracked.
 *
 * It is the DS `Button` primitive (`variant="ghost" size="icon"`), not a
 * hand-assembled `<button>`: the primitive owns the hover / active /
 * focus-visible states and the 44×44 icon geometry, and the transparent-at-rest
 * ghost lets the header palette show through. Only the `flex-none` layout class
 * and the `text-header-foreground` glyph colour are call-site classes.
 *
 * `<html class="dark">` is the theme source of truth, so the pressed state
 * subscribes to the CLASS via `useSyncExternalStore` + a MutationObserver rather
 * than to local state — the control can never desync from a theme applied
 * outside it (a host layout pre-paint FOUC guard), and the server snapshot
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

/** Accessible names of the control, one per direction of travel. */
export interface ThemeToggleLabels {
  toDark: string;
  toLight: string;
}

const DEFAULT_LABELS: ThemeToggleLabels = {
  toDark: "Включить тёмную тему",
  toLight: "Включить светлую тему",
};

export function ThemeToggle({
  labels = DEFAULT_LABELS,
  className,
}: {
  /** Override when the host draws its chrome copy from a message catalog. */
  labels?: ThemeToggleLabels | undefined;
  className?: string | undefined;
}) {
  const dark = useSyncExternalStore(
    subscribeToHtmlClass,
    readIsDark,
    serverIsDark,
  );

  const onClick = useCallback(() => {
    // An activation is an EXPLICIT visitor choice — persist it and apply it; the
    // MutationObserver re-renders us.
    persistTheme(readIsDark() ? "light" : "dark");
  }, []);

  return (
    <Button
      data-testid="theme-toggle"
      variant="ghost"
      size="icon"
      type="button"
      aria-pressed={dark}
      aria-label={dark ? labels.toLight : labels.toDark}
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
