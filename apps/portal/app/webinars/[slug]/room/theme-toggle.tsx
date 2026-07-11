"use client";

import { useCallback, useSyncExternalStore, type ChangeEvent } from "react";
import { Switch } from "@ds/design-system/switch";
import { persistTheme } from "../../../../lib/theme";

/**
 * 006 EARS-12 — the room-header theme toggle, the portal's ONLY visible theme
 * control until the #510 unified-portal-chrome rollout (owner Stage-A decision,
 * design §10). Activating it flips the portal between light and dark by toggling
 * the `.dark` class on `<html>` and persists the now-EXPLICIT choice under
 * `ds-theme` — from then on the choice wins over the system scheme on every load
 * (the layout's inline FOUC guard re-applies it before first paint).
 *
 * Built on the DS `switch.tsx` primitive (design §7 — the shipped neo-brutalist
 * switch, adopt-before-bespoke ADR-0013; a real `role="switch"` checkbox, so
 * keyboard + assistive-tech semantics ride the primitive). The accessible name is
 * injected from the message catalog by the parent (EARS-10 — no hardcoded
 * user-facing string here).
 *
 * The `<html>` CLASS is the theme's single source of truth (`lib/theme.ts`), so
 * the checked state is subscribed to the class itself via `useSyncExternalStore`
 * + a MutationObserver — the toggle can never desync from a theme applied outside
 * it (the FOUC guard before hydration, the ThemeWatcher's live system re-resolve),
 * and the server snapshot (`false` = light) is reconciled on the client without a
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

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    // An activation is an EXPLICIT user choice — persist it (it now wins over
    // the system scheme) and apply it; the MutationObserver re-renders us.
    persistTheme(event.target.checked ? "dark" : "light");
  }, []);

  return (
    <Switch
      checked={dark}
      onChange={onChange}
      aria-label={label}
      className={className}
    />
  );
}
