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
// (explicit user choice, always wins) → the system `prefers-color-scheme`; the
// inline FOUC-guard script applies the SAME resolution before first paint. These
// unit tests pin the resolution SSOT and prove the inline script (a self-contained
// string — it cannot import this module) stays behaviourally identical to
// `resolveTheme` across every stored × system combination.

/** Stub the system `prefers-color-scheme: dark` media query. */
function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-color-scheme: dark") ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

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

beforeEach(() => {
  stubStorage();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("006 EARS-12 theme resolution — stored explicit choice wins over the system scheme", () => {
  it("EARS-12: the storage key is the spec-pinned `ds-theme`", () => {
    expect(THEME_STORAGE_KEY).toBe("ds-theme");
  });

  it("EARS-12: with no stored choice the theme follows the system prefers-color-scheme", () => {
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
  });

  it("EARS-12: a stored explicit choice wins over the system value", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("EARS-12: a corrupt stored value is ignored — the system value applies", () => {
    expect(resolveTheme("blue", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
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
    stubSystemDark(false);
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

  it("EARS-12.1: with no stored choice it applies the system scheme (both directions)", () => {
    stubSystemDark(true);
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    document.documentElement.classList.remove("dark");
    stubSystemDark(false);
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12.2: a stored explicit choice wins over the system scheme (both directions)", () => {
    stubSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    stubSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12.3: it also REMOVES a stale `.dark` (bfcache/restored DOM) when light resolves", () => {
    stubSystemDark(false);
    document.documentElement.classList.add("dark");
    runInitScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("EARS-12.4: it never throws when storage is unavailable — falls back to the system scheme", () => {
    stubStorage({ throwOnAccess: true });
    stubSystemDark(true);
    expect(runInitScript).not.toThrow();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("EARS-12.5: the script matches resolveTheme across every stored × system combination", () => {
    for (const stored of [null, "light", "dark", "junk"] as const) {
      for (const systemDark of [false, true]) {
        localStorage.clear();
        if (stored !== null) localStorage.setItem(THEME_STORAGE_KEY, stored);
        stubSystemDark(systemDark);
        document.documentElement.classList.remove("dark");
        runInitScript();
        const expected = resolveTheme(stored, systemDark) === "dark";
        expect(
          document.documentElement.classList.contains("dark"),
          `stored=${String(stored)} systemDark=${String(systemDark)}`,
        ).toBe(expected);
      }
    }
  });
});
