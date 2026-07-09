/**
 * Admin-session bootstrap for the browser E2E (007 EARS-8 background: "a
 * platform_admin session (feature 003)"). It establishes a REAL 003 session the
 * exact way the shipped auth issues one — register → grant the `platform_admin`
 * project role on the IdP → login — and returns the `__Host-ds_session` cookie
 * value to inject into the browser context. 007 adds no auth primitive; this is
 * the 003 path plus the same Zitadel `CreateAuthorization` grant the api itself
 * uses (`ZitadelIdpClient.grantProjectRole`), replicated here so the E2E does not
 * depend on a hand-seeded admin account. Privileged (reads `IDP_SERVICE_TOKEN`)
 * and therefore dev-stand-gated — never shipped to a browser.
 *
 * Register/login ride the admin origin's same-origin `/v1/*` proxy so the
 * `__Host-` cookie is set for the admin host; the role grant talks to the IdP
 * directly. All endpoints come from env — nothing is hardcoded.
 */
export const SESSION_COOKIE_NAME = "__Host-ds_session";
const ADMIN_ROLE = "platform_admin";

export interface BootstrapResult {
  email: string;
  password: string;
}

/** The fixed test password the bootstrapped accounts use (the final login is done in the browser context). */
export const E2E_PASSWORD = "Aa1!ufficiently-long-pw";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`E2E requires ${name} in the environment`);
  return value;
}

/**
 * Resolve a registered user's Zitadel id (the OIDC `sub`) by email, via the IdP
 * management API — NOT a 003 login, so it does not count against the api's per-IP
 * auth rate limit (EARS-13). The user projection lags the register write (CQRS
 * eventual consistency), so poll until it surfaces.
 */
async function resolveSub(email: string): Promise<string> {
  const issuer = required("IDP_ISSUER").replace(/\/$/, "");
  const headers = {
    authorization: `Bearer ${required("IDP_SERVICE_TOKEN")}`,
    "content-type": "application/json",
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(`${issuer}/management/v1/users/_search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        queries: [{ emailQuery: { emailAddress: email } }],
      }),
    });
    if (!res.ok) continue;
    const id = ((await res.json()) as { result?: { id: string }[] }).result?.[0]
      ?.id;
    if (id) return id;
  }
  throw new Error(`could not resolve Zitadel sub for ${email}`);
}

/**
 * Grant `platform_admin` on the IdP. The 003 register already created a
 * `doctor_guest` project grant for this user, and Zitadel allows only ONE grant
 * per user+project — so we UPDATE the existing grant to add `platform_admin`
 * (preserving `doctor_guest`), falling back to CREATE only when none exists. Uses
 * the management-v1 user-grant API (stable search+update shape); reads the service
 * token + project id from env.
 */
async function grantAdminRole(sub: string): Promise<void> {
  const issuer = required("IDP_ISSUER").replace(/\/$/, "");
  const token = required("IDP_SERVICE_TOKEN");
  const projectId = required("IDP_PROJECT_ID");
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  // Ensure the `platform_admin` project role exists on the IdP before granting it
  // (idempotent — 409 = already present). As of #662 the dev-stand Zitadel
  // provisioning (`infra/dev-stand/idp/provision.sh`) seeds `platform_admin`
  // alongside `doctor_guest`, so this inline ensure is now a DEFENSIVE guard only
  // (it converges an out-of-band or pre-#662 stand) — it is no longer load-bearing.
  const roleRes = await fetch(
    `${issuer}/management/v1/projects/${projectId}/roles`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        roleKey: ADMIN_ROLE,
        displayName: "Platform Admin",
        group: "",
      }),
    },
  );
  if (!roleRes.ok && roleRes.status !== 409) {
    throw new Error(`zitadel ensure platform_admin role failed: HTTP ${roleRes.status}`);
  }

  // Find the user's existing grant on the project (created by 003 register). The
  // user-grant read projection lags the register write (CQRS eventual
  // consistency), so poll until it surfaces before deciding update-vs-create.
  type Grant = { id: string; projectId?: string; roleKeys?: string[] };
  let existing: Grant | undefined;
  for (let attempt = 0; attempt < 12 && !existing; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    const search = await fetch(`${issuer}/management/v1/users/grants/_search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ queries: [{ userIdQuery: { userId: sub } }] }),
    });
    if (!search.ok) {
      throw new Error(`zitadel grant search failed: HTTP ${search.status}`);
    }
    const result = ((await search.json()) as { result?: Grant[] }).result ?? [];
    existing = result.find((g) => g.projectId === projectId) ?? result[0];
  }

  if (existing) {
    const roleKeys = Array.from(
      new Set([...(existing.roleKeys ?? []), ADMIN_ROLE]),
    );
    const upd = await fetch(
      `${issuer}/management/v1/users/${sub}/grants/${existing.id}`,
      { method: "PUT", headers, body: JSON.stringify({ roleKeys }) },
    );
    if (!upd.ok) {
      throw new Error(`zitadel grant update failed: HTTP ${upd.status}`);
    }
    return;
  }

  const create = await fetch(`${issuer}/management/v1/users/${sub}/grants`, {
    method: "POST",
    headers,
    body: JSON.stringify({ projectId, roleKeys: [ADMIN_ROLE] }),
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`zitadel grant create failed: HTTP ${create.status}`);
  }
}

async function register(
  adminOrigin: string,
  email: string,
  password: string,
): Promise<void> {
  const res = await fetch(`${adminOrigin}/v1/auth/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ds-admin-e2e/1.0",
      "accept-language": "ru-RU",
    },
    body: JSON.stringify({
      email,
      password,
      consent: [{ purpose: "tos", version: "2026-01" }],
    }),
  });
  if (!res.ok) throw new Error(`003 register failed: HTTP ${res.status}`);
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
}

/**
 * Provision a `platform_admin` account (register → login-to-resolve-sub → grant
 * the project role on the IdP). The FINAL login that mints the session is done by
 * the step in the BROWSER context so the `__Host-ds_session` cookie lands in the
 * page's own cookie jar; this returns the credentials for that browser login.
 */
export async function bootstrapAdminSession(
  adminOrigin: string,
): Promise<BootstrapResult> {
  const email = uniqueEmail("admin");
  await register(adminOrigin, email, E2E_PASSWORD);
  const sub = await resolveSub(email);
  await grantAdminRole(sub);
  // Let the grant project into the token-issuance read model before the browser
  // login mints the session (the login step still confirms + retries the role).
  await new Promise((r) => setTimeout(r, 2500));
  return { email, password: E2E_PASSWORD };
}

/** Provision a `doctor_guest` (non-admin) account — register only, no role grant. */
export async function bootstrapDoctorSession(
  adminOrigin: string,
): Promise<BootstrapResult> {
  const email = uniqueEmail("doc");
  await register(adminOrigin, email, E2E_PASSWORD);
  return { email, password: E2E_PASSWORD };
}
