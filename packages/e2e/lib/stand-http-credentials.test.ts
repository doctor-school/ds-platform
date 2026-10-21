import { describe, expect, it } from "vitest";

import { standHttpCredentials } from "./stand-http-credentials";

/**
 * #3168 — a staging slot sits behind ONE basic-auth pair, so a storefront
 * live-tier config pointed at a slot must answer the challenge on every request.
 */
describe("standHttpCredentials", () => {
  it("turns the E2E_HTTP_USER / E2E_HTTP_PASS pair into Playwright httpCredentials", () => {
    expect(
      standHttpCredentials({ E2E_HTTP_USER: "stage", E2E_HTTP_PASS: "pw" }),
    ).toEqual({ username: "stage", password: "pw" });
  });

  it("is undefined on a local dev stand, where neither half is exported", () => {
    expect(standHttpCredentials({})).toBeUndefined();
    expect(standHttpCredentials({ E2E_HTTP_USER: "stage" })).toBeUndefined();
  });
});
