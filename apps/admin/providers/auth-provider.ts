"use client";

import type { AuthProvider } from "@refinedev/core";

/**
 * Refine auth provider over the shipped 003 BFF (007 EARS-8; ADR-0004 §5 custom
 * Zitadel auth strategy). 007 introduces NO auth primitive — the admin principal
 * is a `platform_admin` session issued by the 003/IdP layer (spec Constraints).
 * Every call rides the relative `/v1/auth/*` path with `credentials: "include"`,
 * so the `__Host-ds_session` cookie is set/sent same-origin through the admin
 * proxy (`next.config.ts`).
 *
 * The admin gate is the `platform_admin` ROLE: `check`/`onError` resolve the
 * session claims from `GET /v1/auth/session` and admit only a caller whose
 * `roles[]` carries `platform_admin` — a `doctor_guest` or unauthenticated caller
 * is bounced to `/login` (the client mirror of the server-side EARS-8 refusal;
 * the api remains the authority — the Refine `accessControlProvider` + the api
 * `AuthzGuard` refuse an admin write regardless of what the UI renders).
 */
const AUTH_BASE = "/v1/auth";
const ADMIN_ROLE = "platform_admin";

interface SessionClaims {
  sub: string;
  roles: string[];
  mfa: boolean;
  email?: string;
}

async function readSession(): Promise<SessionClaims | null> {
  const res = await fetch(`${AUTH_BASE}/session`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return (await res.json()) as SessionClaims;
}

function isAdmin(claims: SessionClaims | null): claims is SessionClaims {
  return !!claims && Array.isArray(claims.roles) && claims.roles.includes(ADMIN_ROLE);
}

export const authProvider: AuthProvider = {
  login: async ({ email, password }: { email?: string; password?: string }) => {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: email, password }),
    });
    if (!res.ok) {
      return {
        success: false,
        error: { name: "LoginError", message: "login.errorGeneric" },
      };
    }
    // A session exists now — admit only a platform_admin (EARS-8).
    const claims = await readSession();
    if (!isAdmin(claims)) {
      await fetch(`${AUTH_BASE}/logout`, {
        method: "POST",
        credentials: "include",
      });
      return {
        success: false,
        error: { name: "ForbiddenError", message: "login.errorForbidden" },
      };
    }
    return { success: true, redirectTo: "/events" };
  },

  logout: async () => {
    await fetch(`${AUTH_BASE}/logout`, {
      method: "POST",
      credentials: "include",
    });
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    const claims = await readSession();
    if (isAdmin(claims)) return { authenticated: true };
    return {
      authenticated: false,
      redirectTo: "/login",
      logout: true,
    };
  },

  onError: async (error) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 401 || status === 403) {
      return { logout: true, redirectTo: "/login", error };
    }
    return {};
  },

  getPermissions: async () => {
    const claims = await readSession();
    return claims?.roles ?? [];
  },

  getIdentity: async () => {
    const claims = await readSession();
    if (!claims) return null;
    return { id: claims.sub, name: claims.email ?? claims.sub };
  },
};
