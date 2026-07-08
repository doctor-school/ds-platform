"use client";

import type { AccessControlProvider } from "@refinedev/core";

/**
 * Refine access-control provider (ADR-0004 §5 — generic `accessControlProvider`
 * interface). Wave 1 007 is ONE trusted admin group (LD-3): the `events` resource
 * and all its authoring/transition actions require the `platform_admin` role, no
 * object-level scoping (that arrives with wave-2 manager/owner-of-record lists).
 * The Cerbos-adapter shape (ADR-0004 §5.2) is deferred with wave-2 policy scoping;
 * wave 1's role gate is sufficient (spec §7). This is a UI convenience — the api
 * `AuthzGuard` is the authority (EARS-8), so a hidden action is still refused
 * server-side if reached directly.
 */
const ADMIN_ROLE = "platform_admin";

async function hasAdminRole(): Promise<boolean> {
  const res = await fetch("/v1/auth/session", {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) return false;
  const claims = (await res.json()) as { roles?: string[] };
  return Array.isArray(claims.roles) && claims.roles.includes(ADMIN_ROLE);
}

export const accessControlProvider: AccessControlProvider = {
  can: async () => {
    const can = await hasAdminRole();
    return can
      ? { can: true }
      : { can: false, reason: "login.errorForbidden" };
  },
  options: {
    buttons: { enableAccessControl: true, hideIfUnauthorized: false },
  },
};
