/**
 * #2998 — the retry policy of Refine's admin data QueryClient (`app/providers.tsx`).
 *
 * A 401 means the session is gone and a 403 means this action is refused for a
 * live session (ADR-0001 A1: no-access, «never a retry»). Re-sending either
 * cannot succeed: it only delays the auth provider's `onError` — the sign-in
 * redirect for a 401 — by TanStack's back-off, and repeats the refused request
 * against the api. Every other failure (5xx, network) keeps TanStack's default
 * of three retries.
 */

import type { QueryClientConfig } from "@tanstack/react-query";

/** TanStack Query's default query retry count, kept for retryable errors. */
export const ADMIN_QUERY_MAX_RETRIES = 3;

/** HTTP statuses a re-send cannot change: the session or the access decides. */
const NEVER_RETRIED = new Set([401, 403]);

/** The `statusCode` the admin data provider puts on a failed request, if any. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === "number" ? statusCode : undefined;
}

/** TanStack `retry` predicate: whether attempt `failureCount + 1` is made. */
export function adminQueryRetry(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined && NEVER_RETRIED.has(status)) return false;
  return failureCount < ADMIN_QUERY_MAX_RETRIES;
}

/** Refine's `options.reactQuery.clientConfig` for the admin console. */
export const ADMIN_QUERY_CLIENT_CONFIG: QueryClientConfig = {
  defaultOptions: { queries: { retry: adminQueryRetry } },
};
