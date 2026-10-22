import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  THEME_STORAGE_KEY,
  persistTheme,
  syncThemeCookie,
  themeCookie,
  themeCookieDomain,
  themeFromCookieHeader,
} from "./theme";

describe("#3171: the explicit theme choice travels to the sign-in host as a preference cookie", () => {
  it("derives the storefront's parent domain on prod and on stage, and none on a local host", () => {
    expect(themeCookieDomain("academy.doctor.school")).toBe("doctor.school");
    expect(themeCookieDomain("new.doctor.school")).toBe("doctor.school");
    expect(themeCookieDomain("doctor.school")).toBe("doctor.school");
    expect(themeCookieDomain("academy-pr-12.stage.doctor.school")).toBe(
      "stage.doctor.school",
    );
    expect(themeCookieDomain("doctor-main.stage.doctor.school")).toBe(
      "stage.doctor.school",
    );
    for (const local of ["localhost", "app.localhost", "127.0.0.1", "::1"]) {
      expect(themeCookieDomain(local), local).toBeUndefined();
    }
  });

  it("writes light|dark for a year, Path=/, SameSite=Lax, Secure + Domain off localhost", () => {
    expect(themeCookie("dark", "academy.doctor.school")).toBe(
      "ds-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Domain=doctor.school; Secure",
    );
    expect(themeCookie("light", "localhost")).toBe(
      "ds-theme=light; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("clears with the same Domain it was written with", () => {
    expect(themeCookie(null, "doctor-pr-3.stage.doctor.school")).toBe(
      "ds-theme=; Path=/; Max-Age=0; SameSite=Lax; Domain=stage.doctor.school; Secure",
    );
  });

  it("reads only a valid choice back out of a request Cookie header", () => {
    expect(themeFromCookieHeader("a=1; ds-theme=dark; b=2")).toBe("dark");
    expect(themeFromCookieHeader("ds-theme=light")).toBe("light");
    expect(themeFromCookieHeader("ds-theme=purple")).toBeNull();
    expect(themeFromCookieHeader("x-ds-theme=dark")).toBeNull();
    expect(themeFromCookieHeader(null)).toBeNull();
  });

  describe("in the document (jsdom, localhost)", () => {
    const clear = () => {
      document.cookie = "ds-theme=; Path=/; Max-Age=0";
      localStorage.clear();
    };
    beforeEach(clear);
    afterEach(clear);

    it("persistTheme writes the cookie whenever it writes localStorage", () => {
      persistTheme("dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
      expect(document.cookie).toContain("ds-theme=dark");
      persistTheme("light");
      expect(document.cookie).toContain("ds-theme=light");
    });

    it("syncThemeCookie carries an earlier stored choice, and clears the cookie once the choice is gone", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      syncThemeCookie();
      expect(document.cookie).toContain("ds-theme=dark");
      localStorage.removeItem(THEME_STORAGE_KEY);
      syncThemeCookie();
      expect(document.cookie).not.toContain("ds-theme=");
    });
  });
});
