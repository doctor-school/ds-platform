"use client";

import { useQuery } from "@tanstack/react-query";
import { adminAccess, type AdminAccess } from "./admin-access";
import { adminQueryClient, adminSessionQuery } from "./admin-session-cache";

/**
 * 044 EARS-20 — the signed-in principal's access projection, from the ONE cached
 * `GET /v1/admin/auth/session` read (`lib/admin-session-cache.ts`) shared by the
 * chrome and the Refine `can` answer. `undefined` until the read answers, so
 * nothing is drawn on a guess.
 */
export function useAdminAccess(): AdminAccess | undefined {
  const session = useQuery(adminSessionQuery, adminQueryClient);
  return session.isSuccess ? adminAccess(session.data) : undefined;
}
