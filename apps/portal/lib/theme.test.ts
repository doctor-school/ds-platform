// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
} from "./theme";

// 006 EARS-12 — the portal-wide theme mechanism (design §10): the theme is the
// `.dark` class on `<html>`; resolution order is the `ds-theme` localStorage key
// (explicit user choice, always wins) → else DARK (the product default — the
// system `prefers-color-scheme` is NEVER consulted); the inline FOUC-guard script
// applies the SAME resolution before first paint. These unit tests pin the
// resolution SSOT and prove the inline script (a self-contained string — it
// cannot import this module) stays behaviourally identical to `resolveTheme`
// across every stored value.

/**
 * Stub an in-memory `localStorage`. jsdom 29's REAL Storage schedules an internal
 * write-behind `setTimeout` per mutation, which the #434 orphan-timer guard
 * rightly flags as a leaked timer — a synchronous fake keeps the tests about the
 * theme contract, not jsdom persistence internals.
 */
function stubStorage(opts: { throwOnAccess?: boolean } = {}) {
  const store = new Map<string, string>();
  const fake = {
    getItem(key: string): string | null {
      if (opts.throwOnAccess) throw new Error("storage disabled");
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      if (opts.throwOnAccess) throw new Error("storage disabled");
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
  vi.stubGlobal("localStorage", fake);
  return fake;
}

/**
 * Assert the module never consults the system scheme: any `matchMedia` call is a
 * spec violation (design §10 — the system `prefers-color-scheme` is never
 * consulted; owner Stage-B decision 2026-07-12).
 */
function stubForbiddenMatchMedia() {
  const spy = vi.fn(() => {
    throw new Error("matchMedia must never be consulted (EARS-12)");
  });
  vi.stubGlobal("matchMedia", spy);
  return spy;
}

beforeEach(() => {
  stubStorage();
  stubForbiddenMatchMedia();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("006 EARS-12 theme resolution — stored explicit choice wins, else dark (system never consulted)", () => {
  it("EARS-12: the storage key is the spec-pinned `ds-theme`", () => {
    expect(THEME_STORAGE_KEY).toBe("ds-theme");
  });

  it("EARS-12: with no stored choice the theme is DARK — the product default", () => {
    expect(resolveTheme(null)).toBe("dark");
  });

  it("EARS-12: a stored explicit choice always wins", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("EARS-12: a corrupt stored value is ignored — dark applies", () => {
    expect(resolveTheme("blue")).toBe("dark");
    expect(resolveTheme("")).toBe("dark");
  });

  it("EARS-12: readStoredTheme returns only the two legal values, else null", () => {
    expect(readStoredTheme()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredTheme()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "junk");
    expect(readStoredTheme()).toBeNull();
  });

  it("EARS-12: applyTheme toggles the `.dark` class on <html> — the DS token scope", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12: persistTheme writes the explicit choice to localStorage AND applies it", () => {
    persistTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    persistTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("006 EARS-12 FOUC-guard inline script — same resolution as resolveTheme, no flash inputs missed", () => {
  /** Execute the inline script exactly as the browser parser would. */
  function runInitScript() {
    new Function(THEME_INIT_SCRIPT)();
  }

  it("EARS-12.1: with no stored choice it applies DARK — never reading the system scheme", () => {
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("EARS-12.2: a stored explicit choice wins (both directions)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("EARS-12.3: it also REMOVES a stale `.dark` (bfcache/restored DOM) when light resolves", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.classList.add("dark");
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12.4: it never throws when storage is unavailable — falls back to dark", () => {
    stubStorage({ throwOnAccess: true });
    expect(runInitScript).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("EARS-12.5: the script matches resolveTheme across every stored value", () => {
    for (const stored of [null, "light", "dark", "junk"] as const) {
      localStorage.clear();
      if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
      document.documentElement.classList.remove("dark");
      runInitScript();
      const expected = resolveTheme(stored) === "dark";
      expect(
        document.documentElement.classList.contains("dark"),
        `stored=${String(stored)}`,
      ).toBe(expected);
    }
  });
});
