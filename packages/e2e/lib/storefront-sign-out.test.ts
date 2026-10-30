import { describe, expect, it } from "vitest";

import { STOREFRONT_SIGN_OUT_PATH as productPath } from "../../auth-flow/src/sign-out-path.js";
import { STOREFRONT_SIGN_OUT_PATH } from "./storefront-sign-out.js";

describe("storefront sign-out path (#3588)", () => {
  it("EARS-10: the steps observe the very route the account sign-out posts to", () => {
    // The account «Выйти» posts the storefront's own route since #3534; the
    // browser never sends the API's /v1/auth/logout, so a step waiting for that
    // path hangs to the test timeout (#3588).
    expect(STOREFRONT_SIGN_OUT_PATH).toBe(productPath);
    expect(STOREFRONT_SIGN_OUT_PATH).not.toBe("/v1/auth/logout");
  });
});
