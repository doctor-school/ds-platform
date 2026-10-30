import { describe, expect, it } from "vitest";

import {
  authRequestOf,
  callbackParams,
  setCookiePairs,
} from "./storefront-session-seed.js";

describe("storefront session seed — the pure hops", () => {
  it("reads name=value of every set-cookie header, attributes dropped", () => {
    const pairs = setCookiePairs([
      { name: "content-type", value: "application/json" },
      {
        name: "Set-Cookie",
        value: "__Host-ds_login_form=abc; Path=/; HttpOnly; Secure",
      },
      { name: "set-cookie", value: "__Host-ds_session=s=1; Path=/\nother=2" },
    ]);
    expect([...pairs]).toEqual([
      ["__Host-ds_login_form", "abc"],
      ["__Host-ds_session", "s=1"],
      ["other", "2"],
    ]);
  });

  it("takes the auth request from the IdP's sign-in host Location", () => {
    expect(
      authRequestOf("http://localhost:3005/login?authRequest=V2_123"),
    ).toBe("V2_123");
  });

  it("refuses an authorize answer that names no auth request", () => {
    expect(() => authRequestOf(undefined)).toThrow(
      /no sign-in host auth request/,
    );
    expect(() =>
      authRequestOf("http://localhost:3001/auth/callback?error=x"),
    ).toThrow(/no sign-in host auth request/);
  });

  it("takes code and state from the storefront callback URL, or refuses", () => {
    expect(
      callbackParams("http://localhost:3001/auth/callback?code=c1&state=s1"),
    ).toEqual({ code: "c1", state: "s1" });
    expect(() =>
      callbackParams("http://localhost:3001/auth/callback?error=access_denied"),
    ).toThrow(/no callback code\/state/);
  });
});
