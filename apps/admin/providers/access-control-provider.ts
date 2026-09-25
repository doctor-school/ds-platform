"use client";

import type { AccessControlProvider } from "@refinedev/core";
import { adminAccess, canAccessResource } from "@/lib/admin-access";
import { readAdminSession } from "@/lib/admin-auth";

/**
 * Refine access-control provider (ADR-0004 §5 — generic `accessControlProvider`
 * interface). This is a UI convenience — the api `AuthzGuard` and the 044
 * `EventGrantPolicy` are the authority (007 EARS-8, 044 EARS-19/38), so a hidden
 * action is still refused server-side if reached directly.
 *
 * **Role AND binding, not session presence (044 EARS-20).** The 011 admin tier
 * issues a session only to a principal the `role → mfa_required` policy covers
 * and only after a satisfied second factor. Until 044 that set was
 * `platform_admin` alone, so "holds an active admin session" WAS the role check.
 * 044 added `event-registrar`, which holds an admin session too but may reach
 * exactly one event's roster, so the answer now comes from the principal's own
 * `GET /v1/admin/auth/session` read (`roles` + `eventGrants`), projected by
 * `lib/admin-access.ts`: `platform_admin` → everything; a registrar → only the
 * `congress-roster` resource of its bound event; anything unreadable → nothing.
 */
export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, params }) => {
    const access = adminAccess(await readAdminSession());
    return canAccessResource(access, resource, params)
      ? { can: true }
      : { can: false, reason: "login.errorForbidden" };
  },
  options: {
    buttons: { enableAccessControl: true, hideIfUnauthorized: false },
  },
};
