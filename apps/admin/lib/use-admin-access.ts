"use client";

import { useQuery } from "@tanstack/react-query";
import { adminAccess, type AdminAccess } from "./admin-access";
import { readAdminSession } from "./admin-auth";

/**
 * 044 EARS-20 — the signed-in principal's access projection, from ONE cached
 * `GET /v1/admin/auth/session` read shared by the chrome and any page that must
 * not offer a link the principal cannot open. `undefined` until the read answers,
 * so nothing is drawn on a guess.
 */
export function useAdminAccess(): AdminAccess | undefined {
  const session = useQuery({
    queryKey: ["admin-auth", "session"],
    queryFn: readAdminSession,
  });
  return session.isSuccess ? adminAccess(session.data) : undefined;
}
