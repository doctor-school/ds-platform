// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { THEME_STORAGE_KEY } from "../../../../lib/theme";
import { ThemeToggle } from "./theme-toggle";

// 006 EARS-12 — the room-header theme toggle (the portal's ONLY visible theme
// control until #510): activating it switches the portal between light and dark
// by toggling the `.dark` class on `<html>` AND persists the explicit choice in
// `localStorage` (`ds-theme`). Built on the DS `switch.tsx` primitive (design §7 —
// adopt-before-bespoke, ADR-0013), so the control is a real `role="switch"` with
// the accessible name injected from the message catalog (EARS-10).

const LABEL = "Переключить тему";

/** In-memory localStorage — jsdom's real Storage leaks #434-guarded timers. */
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  stubStorage();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("006 EARS-12 room-header theme toggle — DS switch flips `.dark` and persists the choice", () => {
  it("EARS-12: renders as an accessible switch named from the catalog copy, reflecting the current theme", async () => {
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("switch", { name: LABEL });
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("EARS-12: reflects an already-dark document (the FOUC guard ran before hydration)", async () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("switch", { name: LABEL });
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("EARS-12: activating it toggles `.dark` on <html> and persists the explicit choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("switch", { name: LABEL });

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await waitFor(() => expect(toggle).toBeChecked());

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("EARS-12: stays in sync when the class flips OUTSIDE the toggle (system re-resolve, no stored choice)", async () => {
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("switch", { name: LABEL });
    await waitFor(() => expect(toggle).not.toBeChecked());

    // The ThemeWatcher (or any other consumer of the class SSOT) re-resolves.
    document.documentElement.classList.add("dark");
    await waitFor(() => expect(toggle).toBeChecked());
  });
});
