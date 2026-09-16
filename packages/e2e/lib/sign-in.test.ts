import { describe, expect, it } from "vitest";

import { preHydrationSubmitError } from "./sign-in.js";

/**
 * The self-accusation half of the golden sign-in (regression-contour tech spec
 * §6.1, Issue #2067). A login card clicked before its client bundle executed
 * submits NATIVELY — the browser re-loads the login route with the credentials
 * in the query string and `/v1/auth/login` is never called. Without this check
 * the walk only reports «timed out waiting for the URL to change», which points
 * the reader at the API instead of at the walk's own missing hydration wait.
 */
describe("preHydrationSubmitError", () => {
  it("names the native submit when the URL gained an `identifier` query", () => {
    const message = preHydrationSubmitError(
      "https://doctor.pr-2205.stage.doctor.school/login?identifier=a%40b.ru&password=x",
      "/login",
    );
    expect(message).toContain("Pre-hydration native form submit on /login");
    expect(message).toContain("/v1/auth/login");
    expect(message).toContain("walk-tooling defect");
  });

  it("stays silent on the login route itself, before any submit", () => {
    expect(
      preHydrationSubmitError("https://doctor.example.test/login", "/login"),
    ).toBeNull();
  });

  it("stays silent on a real post-login landing", () => {
    expect(
      preHydrationSubmitError("https://doctor.example.test/account", "/login"),
    ).toBeNull();
  });

  it("stays silent on an unrelated query such as `returnTo`", () => {
    expect(
      preHydrationSubmitError(
        "https://doctor.example.test/login?returnTo=%2Faccount",
        "/login",
      ),
    ).toBeNull();
  });
});
