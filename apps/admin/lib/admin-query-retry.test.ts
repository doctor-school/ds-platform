import { describe, expect, it } from "vitest";

import {
  ADMIN_QUERY_CLIENT_CONFIG,
  ADMIN_QUERY_MAX_RETRIES,
  adminQueryRetry,
} from "./admin-query-retry";

/**
 * #2998 — a dropped session must reach the sign-in screen on the first refused
 * data request. TanStack's default (`retry: 3`) re-sent a 401 several times
 * before `onError` redirected; a 403 is no-access, «never a retry» (ADR-0001 A1).
 */
describe("adminQueryRetry — which failed admin data reads are retried", () => {
  it.each([
    ["401 (session gone)", { statusCode: 401 }],
    ["401 STEP_UP_REQUIRED", { statusCode: 401, errorCode: "STEP_UP_REQUIRED" }],
    ["403 (no access)", { statusCode: 403 }],
  ])("#2998: never retries a %s", (_label, error) => {
    expect(adminQueryRetry(0, error)).toBe(false);
  });

  it.each([
    ["a 500", { statusCode: 500 }],
    ["a 503", { statusCode: 503 }],
    ["a network failure", new TypeError("Failed to fetch")],
    ["an unknown value", undefined],
  ])("#2998: keeps the default retries for %s", (_label, error) => {
    for (let n = 0; n < ADMIN_QUERY_MAX_RETRIES; n += 1) {
      expect(adminQueryRetry(n, error)).toBe(true);
    }
    expect(adminQueryRetry(ADMIN_QUERY_MAX_RETRIES, error)).toBe(false);
  });

  it("#2998: the retry budget for other errors is TanStack's default of 3", () => {
    expect(ADMIN_QUERY_MAX_RETRIES).toBe(3);
  });
});

describe("ADMIN_QUERY_CLIENT_CONFIG — what Refine's QueryClient is built with", () => {
  it("#2998: every admin data query uses the retry predicate", () => {
    expect(ADMIN_QUERY_CLIENT_CONFIG.defaultOptions?.queries?.retry).toBe(
      adminQueryRetry,
    );
  });
});
