import { afterEach, describe, expect, it } from "vitest";

import {
  HOST_IDS,
  HOSTS,
  HostConfigError,
  SIGN_IN_HOST,
  baseUrlFor,
} from "./hosts.js";

describe("e2e host registry (#3171)", () => {
  const saved = process.env.E2E_LOGIN_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.E2E_LOGIN_URL;
    else process.env.E2E_LOGIN_URL = saved;
  });

  it("keeps the storefront selection unchanged: two storefronts, both kind storefront", () => {
    expect(HOST_IDS).toEqual(["academy", "doctor"]);
    expect(Object.values(HOSTS).map((h) => h.kind)).toEqual([
      "storefront",
      "storefront",
    ]);
  });

  it("registers the sign-in host as its own shape, outside the storefront registry", () => {
    expect(SIGN_IN_HOST).toEqual({
      kind: "sign-in-host",
      id: "login",
      baseUrlEnv: "E2E_LOGIN_URL",
      healthPath: "/healthz",
    });
    expect("login" in HOSTS).toBe(false);
  });

  it("resolves the sign-in host's base URL, and names the missing variable", () => {
    process.env.E2E_LOGIN_URL = "https://login-pr-1.stage.doctor.school/";
    expect(baseUrlFor(SIGN_IN_HOST)).toBe(
      "https://login-pr-1.stage.doctor.school",
    );
    delete process.env.E2E_LOGIN_URL;
    expect(() => baseUrlFor(SIGN_IN_HOST)).toThrow(HostConfigError);
  });
});
