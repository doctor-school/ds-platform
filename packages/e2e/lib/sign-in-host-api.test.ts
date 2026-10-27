import { describe, expect, it } from "vitest";

import {
  handoffCommandWithoutReference,
  hostCommand,
  isSignInHostForm, signInHostApiPath } from "./sign-in-host-api.js";

describe("signInHostApiPath", () => {
  it("keeps an auth tail under the host API root", () => {
    expect(signInHostApiPath("/v1/auth/login")).toBe("/v1/sign-in-host/login");
    expect(signInHostApiPath("/v1/auth/login/otp/request")).toBe(
      "/v1/sign-in-host/login/otp/request",
    );
    expect(signInHostApiPath("/v1/auth/password/reset/complete")).toBe(
      "/v1/sign-in-host/password/reset/complete",
    );
  });

  it("keeps a storefront command's tail under the host API root", () => {
    expect(signInHostApiPath("/v1/storefront/doctor/verify")).toBe(
      "/v1/sign-in-host/storefront/doctor/verify",
    );
  });

  it("does not treat a longer segment as /auth", () => {
    expect(signInHostApiPath("/v1/authors")).toBe("/v1/sign-in-host/authors");
  });
});

describe("isSignInHostForm", () => {
  it("names the host form by its auth request", () => {
    expect(isSignInHostForm("http://h:3105/login?authRequest=V2_1")).toBe(true);
    expect(isSignInHostForm("http://s:3101/login")).toBe(false);
  });

  it("refuses an auth request on another origin when the host origin is known", () => {
    expect(
      isSignInHostForm("http://s:3101/login?authRequest=x", "http://h:3105"),
    ).toBe(false);
    expect(
      isSignInHostForm("http://h:3105/verify?authRequest=x", "http://h:3105/"),
    ).toBe(true);
  });
});

describe("hostCommand", () => {
  it("is the storefront command without the form-post fields", () => {
    expect(
      hostCommand({
        identifier: "a@b.test",
        channel: "email",
        code: "123456",
        authRequest: "V2_1",
        csrf: "c",
      }),
    ).toEqual({ identifier: "a@b.test", channel: "email", code: "123456" });
  });

  it.each([
    { identifier: "a@b.test", csrf: "c" },
    { identifier: "a@b.test", authRequest: "V2_1" },
    { identifier: "a@b.test", authRequest: "", csrf: "c" },
    null,
    "synthetic",
    [],
  ])("is empty for a body that is not a host form post %#", (body) => {
    expect(hostCommand(body)).toEqual({});
  });
});

describe("handoffCommandWithoutReference", () => {
  it("is the form-post fields alone, no reference anywhere", () => {
    expect(
      handoffCommandWithoutReference({ authRequest: "V2_1", csrf: "c" }, "ref-1"),
    ).toBe(true);
  });

  it.each([
    { ref: "ref-1", authRequest: "V2_1", csrf: "c" },
    { authRequest: "V2_ref-1", csrf: "c" },
    { authRequest: "V2_1" },
    { ref: "ref-1" },
    null,
  ])("refuses a body that names the reference or is no form post %#", (body) => {
    expect(handoffCommandWithoutReference(body, "ref-1")).toBe(false);
  });
});
