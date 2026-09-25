"use client";

import { QueryClient } from "@tanstack/react-query";
import type { AdminSessionResponse } from "@ds/schemas";
import { readAdminSession } from "./admin-auth";

/**
 * 044 EARS-20 — ONE cached `GET /v1/admin/auth/session` read for the whole admin
 * app: the chrome (`useAdminAccess`) and the Refine `can` answer
 * (`accessControlProvider`) both read it here, so the nav and the action gate can
 * never disagree about who is signed in.
 *
 * The cache is its own QueryClient, outside Refine's: the Refine `can` runs
 * outside React and cannot reach a context-provided client, so both readers name
 * this one instance (`useQuery(adminSessionQuery, adminQueryClient)`). It holds
 * nothing but the session read, and it is cleared on every sign-in and
 * sign-out (`providers/auth-provider.ts`): the next principal in the same tab
 * never inherits the previous principal's roles or bindings.
 */
export const adminQueryClient = new QueryClient();

export const ADMIN_SESSION_QUERY_KEY = ["admin-auth", "session"] as const;

/**
 * The principal changes only at sign-in and sign-out, and both clear this entry,
 * so the read never goes stale in between: the chrome and every `can` answer are
 * served by one request per signed-in principal, not one each.
 */
export const adminSessionQuery = {
  queryKey: ADMIN_SESSION_QUERY_KEY,
  queryFn: readAdminSession,
  staleTime: Infinity,
};

/** The cached session read — fetched once, then served from the shared cache. */
export function fetchAdminSession(): Promise<AdminSessionResponse | null> {
  return adminQueryClient.fetchQuery(adminSessionQuery);
}

/** Drop the cached principal — a sign-in or sign-out changes who it is. */
export function clearAdminSession(): void {
  adminQueryClient.removeQueries({ queryKey: ADMIN_SESSION_QUERY_KEY });
}
