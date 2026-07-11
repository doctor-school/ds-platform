// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { THEME_STORAGE_KEY } from "../../../../lib/theme";
import { ThemeToggle } from "./theme-toggle";

// 006 EARS-12 — the room-header theme toggle (the portal's ONLY visible theme
// control until #510): the canvas 44×44 icon-button (`webinar-room.dc.html` line
// 25, ADR-0013 canvas-wins — never the DS form switch). A `<button>` whose
// `aria-pressed` reflects the dark state, glyph ☾ in light / ☀ in dark, the
// accessible name injected from the message catalog (EARS-10). Activating it
// toggles `.dark` on `<html>` AND persists the explicit choice in `localStorage`
// (`ds-theme`).

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

describe("006 EARS-12 room-header theme toggle — canvas icon-button flips `.dark` and persists the choice", () => {
  it("EARS-12: renders as a button named from the catalog copy — light theme: aria-pressed=false, ☾ glyph", async () => {
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("button", { name: LABEL });
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-pressed", "false"),
    );
    expect(toggle).toHaveTextContent("☾");
  });

  it("EARS-12: reflects an already-dark document (the FOUC guard ran before hydration) — aria-pressed=true, ☀ glyph", async () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("button", { name: LABEL });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(toggle).toHaveTextContent("☀");
  });

  it("EARS-12: activating it toggles `.dark` on <html>, persists the explicit choice, and swaps the glyph", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("button", { name: LABEL });

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(toggle).toHaveTextContent("☀");

    await user.click(toggle);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-pressed", "false"),
    );
    expect(toggle).toHaveTextContent("☾");
  });

  it("EARS-12: stays in sync when the class flips OUTSIDE the toggle (the FOUC guard, another consumer)", async () => {
    render(<ThemeToggle label={LABEL} />);
    const toggle = screen.getByRole("button", { name: LABEL });
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-pressed", "false"),
    );

    // Any other consumer of the class SSOT flips the theme.
    document.documentElement.classList.add("dark");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(toggle).toHaveTextContent("☀");
  });
});
