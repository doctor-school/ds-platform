// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { THEME_STORAGE_KEY } from "./theme";
import { ThemeWatcher } from "./theme-watcher";

/**
 * #2478 — a page Next renders on the client (the `__next_error__` document a
 * page-level `notFound()` produces) never runs the inline pre-paint script, so
 * the watcher applies the resolved theme itself when it mounts.
 */
function stubSystemDark(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("ThemeWatcher", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("#2478: applies a stored dark choice on mount", () => {
    stubSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("#2478: with no stored choice applies the system scheme on mount", () => {
    stubSystemDark(true);
    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("#2478: a stored light choice wins over a dark system scheme", () => {
    stubSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.classList.add("dark");
    render(<ThemeWatcher />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("#2478: without system following only a stored choice applies", () => {
    stubSystemDark(true);
    render(<ThemeWatcher followSystem={false} />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeWatcher followSystem={false} />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
