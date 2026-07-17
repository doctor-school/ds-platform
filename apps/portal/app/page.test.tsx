// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 004 / 008 EARS-7/8/9 — `/` is no longer a second listing surface: it
 * permanent-redirects to the single canonical discovery route `/webinars` (owner
 * verdict #7 follow-up). Two routes rendering the same listing was the defect;
 * the fix is routing. Here we pin the redirect target — `permanentRedirect`
 * (real impl throws `NEXT_REDIRECT`) is mocked so the call is observable.
 */
const permanentRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

import HomePage from "./page";

afterEach(() => vi.clearAllMocks());

describe("004/008 portal front-door — / redirects to the canonical /webinars", () => {
  it("EARS-7/8/9: / permanent-redirects to /webinars (one canonical listing route)", () => {
    HomePage();
    expect(permanentRedirect).toHaveBeenCalledWith("/webinars");
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
  });
});
