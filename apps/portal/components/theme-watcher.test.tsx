// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SYSTEM_DARK_QUERY, THEME_STORAGE_KEY } from "../lib/theme";
import { ThemeWatcher } from "./theme-watcher";

// 006 EARS-12 — with NO stored explicit choice the portal follows the system
// `prefers-color-scheme` LIVE: a media-query change re-resolves the theme
// (design §10). A stored explicit choice wins — the watcher must then leave the
// class alone. The watcher renders nothing and unsubscribes on unmount.

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia() {
  const listeners = new Set<Listener>();
  const mql = {
    matches: false,
    media: SYSTEM_DARK_QUERY,
    addEventListener: (_: "change", cb: Listener) => void listeners.add(cb),
    removeEventListener: (_: "change", cb: Listener) => void listeners.delete(cb),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      for (const cb of listeners) cb({ matches });
    },
    listenerCount: () => listeners.size,
  };
}

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

describe("006 EARS-12 ThemeWatcher — no stored choice follows the system scheme live", () => {
  it("EARS-12: a system scheme change re-resolves the theme when no explicit choice is stored", () => {
    const media = stubMatchMedia();
    render(<ThemeWatcher />);

    media.fire(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    media.fire(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12: a stored explicit choice wins — the system change is ignored", () => {
    const media = stubMatchMedia();
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeWatcher />);

    media.fire(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12: unsubscribes from the media query on unmount", () => {
    const media = stubMatchMedia();
    const { unmount } = render(<ThemeWatcher />);
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
