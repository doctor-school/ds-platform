import type { Page, Response } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { captureResponse } from "./captured-response.js";

/**
 * Playwright drops a response body once the page navigates away from it
 * («Response body is not available for a response that was navigated away
 * from», #2683). An auth door's body is asserted in a later Then-step, after
 * the app (or an earlier step) navigated, so the capture must read it the
 * moment the response arrives.
 */
function fakePage(response: Response): {
  page: Page;
  predicate: () => ((r: Response) => boolean) | undefined;
} {
  let seen: ((r: Response) => boolean) | undefined;
  const page = {
    waitForResponse: (match: (r: Response) => boolean) => {
      seen = match;
      return Promise.resolve(response);
    },
  } as unknown as Page;
  return { page, predicate: () => seen };
}

function fakeResponse(
  url: string,
  method: string,
  state: { navigated: boolean },
): Response {
  return {
    url: () => url,
    request: () => ({ method: () => method }),
    text: async () => {
      if (state.navigated) {
        throw new Error(
          "Response body is not available for a response that was navigated away from",
        );
      }
      return '{"status":"signed_in"}';
    },
  } as unknown as Response;
}

describe("captureResponse", () => {
  it("keeps the body readable after the page navigated away", async () => {
    const state = { navigated: false };
    const response = fakeResponse(
      "https://academy.example/v1/auth/login",
      "POST",
      state,
    );
    const { page } = fakePage(response);
    const captured = await captureResponse(page, "/v1/auth/login");
    state.navigated = true;
    expect(captured.response).toBe(response);
    expect(captured.body).toBe('{"status":"signed_in"}');
  });

  it("matches only a POST to the exact pathname", async () => {
    const state = { navigated: false };
    const { page, predicate } = fakePage(
      fakeResponse("https://academy.example/v1/auth/login", "POST", state),
    );
    await captureResponse(page, "/v1/auth/login/otp");
    const match = predicate()!;
    expect(
      match(fakeResponse("https://a.example/v1/auth/login/otp", "POST", state)),
    ).toBe(true);
    expect(
      match(fakeResponse("https://a.example/v1/auth/login/otp", "GET", state)),
    ).toBe(false);
    expect(
      match(fakeResponse("https://a.example/v1/auth/login", "POST", state)),
    ).toBe(false);
  });
});
