import { describe, expect, it } from "vitest";

import {
  standBasicAuthHeaders,
  standHttpCredentials,
} from "./stand-http-credentials";

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

/**
 * #3191 — a raw Node `fetch` (a Mailpit read, an api call outside the browser)
 * does not ride Playwright's `httpCredentials`, so it carries the same pair as
 * an `authorization` header; on a local dev stand it carries none.
 */
describe("standBasicAuthHeaders", () => {
  it("encodes the E2E_HTTP_USER / E2E_HTTP_PASS pair as a Basic authorization header", () => {
    expect(
      standBasicAuthHeaders({ E2E_HTTP_USER: "stage", E2E_HTTP_PASS: "pw" }),
    ).toEqual({ authorization: `Basic ${btoa("stage:pw")}` });
  });

  it("is empty on a local dev stand, where neither half is exported", () => {
    expect(standBasicAuthHeaders({})).toEqual({});
    expect(standBasicAuthHeaders({ E2E_HTTP_PASS: "pw" })).toEqual({});
  });
});
