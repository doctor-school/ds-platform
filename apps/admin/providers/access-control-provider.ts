"use client";

import type { AccessControlProvider } from "@refinedev/core";
import { readAdminAuthState } from "@/lib/admin-auth";

/**
 * Refine access-control provider (ADR-0004 §5 — generic `accessControlProvider`
 * interface). Wave 1 007 is ONE trusted admin group (LD-3): the `events` resource
 * and all its authoring/transition actions require the `platform_admin` role, no
 * object-level scoping (that arrives with wave-2 manager/owner-of-record lists).
 * The Cerbos-adapter shape (ADR-0004 §5.2) is deferred with wave-2 policy scoping;
 * wave 1's role gate is sufficient (spec §7). This is a UI convenience — the api
 * `AuthzGuard` is the authority (EARS-8), so a hidden action is still refused
 * server-side if reached directly.
 *
 * **Migrated onto the 011 admin tier (#1192).** It used to read the doctor-portal
 * `GET /v1/auth/session` and inspect its `roles[]`. Since 011 an admin operator
 * has no portal session at all, so that read answered 401 for every legitimate
 * admin and the provider hid the whole authoring surface — a client-side lockout
 * with a perfectly healthy server behind it. The admin tier issues a session
 * ONLY to a principal the `role → mfa_required` policy covers and ONLY after a
 * satisfied second factor, so "holds an active admin session" IS the role check;
 * there is no separate claim left to inspect (`AdminAuthState` carries none, by
 * design — 011 design §9 → Read models).
 */

async function hasAdminSession(): Promise<boolean> {
  return (await readAdminAuthState()) === "active";
}

export const accessControlProvider: AccessControlProvider = {
  can: async () => {
    const can = await hasAdminSession();
    return can
      ? { can: true }
      : { can: false, reason: "login.errorForbidden" };
  },
  options: {
    buttons: { enableAccessControl: true, hideIfUnauthorized: false },
  },
};
