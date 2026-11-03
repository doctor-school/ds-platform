import { describe, expect, it } from "vitest";

import { STOREFRONT_SIGN_OUT_PATH as productPath } from "../../auth-flow/src/sign-out-path.js";
import {
  clearsCookie,
  STOREFRONT_SIGN_OUT_PATH,
} from "./storefront-sign-out.js";

describe("storefront sign-out path (#3588)", () => {
  it("EARS-10: the steps observe the very route the account sign-out posts to", () => {
    // The account «Выйти» posts the storefront's own route since #3534; the
    // browser never sends the API's /v1/auth/logout, so a step waiting for that
    // path hangs to the test timeout (#3588).
    expect(STOREFRONT_SIGN_OUT_PATH).toBe(productPath);
    expect(STOREFRONT_SIGN_OUT_PATH).not.toBe("/v1/auth/logout");
  });
});

describe("cleared session cookie on the sign-out response (#3588)", () => {
  const SESSION = "__Host-ds_session";
  const cleared = `${SESSION}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  const guest =
    "__Host-ds_guest=v1.signed; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax";

  it("EARS-10: finds the expired session cookie ahead of the guest marker in one joined header", () => {
    // `headerValue("set-cookie")` joins the relayed API cookie and the guest
    // marker with "\n"; the session entry is judged on its own attributes.
    expect(clearsCookie([`${cleared}\n${guest}`], SESSION)).toBe(true);
    expect(clearsCookie([cleared, guest], SESSION)).toBe(true);
    expect(clearsCookie([guest, cleared], SESSION)).toBe(true);
  });

  it("EARS-10: refuses when only another cookie is expired or the session one lives on", () => {
    expect(clearsCookie([guest], SESSION)).toBe(false);
    expect(
      clearsCookie(
        [`${SESSION}=abc; Path=/; Max-Age=600`, "__Host-ds_guest=; Max-Age=0"],
        SESSION,
      ),
    ).toBe(false);
    expect(clearsCookie([`x${SESSION}=; Max-Age=0`], SESSION)).toBe(false);
    expect(clearsCookie([`${SESSION}=; Path=/; Max-Age=00`], SESSION)).toBe(
      false,
    );
    expect(clearsCookie([], SESSION)).toBe(false);
  });
});
