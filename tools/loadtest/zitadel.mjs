#!/usr/bin/env node
// DS Platform — synthetic-user lifecycle for the load-test harness (#873 phase 1).
//
// Provisions + reaps tagged synthetic accounts DIRECTLY against Zitadel's v2
// resource API with the org-owner service token — never through the BFF register
// endpoint (which is bot-protected AND would dispatch a real verification email,
// recon fact 2/3). Two design choices keep synthetic traffic delivery-silent and
// self-contained:
//
//   • email `{ isVerified: true }` on create — the account is born verified, so
//     Zitadel sends NO code and NO mail (the suppression seam for synthetic users
//     that #1068 tracks for the register-via-BFF path; here it is sidestepped
//     entirely). The BFF login endpoint (NOT bot-protected, recon fact 2) then
//     authenticates these accounts for the auth/room scenarios.
//   • a reserved synthetic domain (default `loadtest.invalid`, RFC-6761 — can
//     never resolve or receive mail) so a stray real send is physically
//     undeliverable; override via `LOADTEST_SYNTHETIC_DOMAIN`.
//
// Cleanup is the exact v2 search+DELETE precedent from
// apps/api/test/auth/zitadel-create-user.e2e-spec.ts:60-92 (POST /v2/users
// emailQuery → DELETE /v2/users/{id}).

import { randomBytes } from "node:crypto";
import { optEnv, reqEnv } from "./lib.mjs";

/** Issuer + service token + optional org override, all env-driven. */
export function idpConfig() {
  return {
    issuer: reqEnv("LOADTEST_IDP_ISSUER").replace(/\/+$/, ""),
    token: reqEnv("LOADTEST_IDP_SERVICE_TOKEN"),
    orgId: optEnv("LOADTEST_IDP_ORG_ID", ""),
    domain: optEnv("LOADTEST_SYNTHETIC_DOMAIN", "loadtest.invalid"),
    password: optEnv("LOADTEST_AUTH_PASSWORD", "LoadTest!" + "Passw0rd"),
  };
}

function headers(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** A fresh tagged synthetic email under the reserved domain. */
export function syntheticEmail(domain, tag = "lt") {
  const rand = randomBytes(4).toString("hex");
  return `${tag}-873-${Date.now()}-${rand}@${domain}`;
}

/**
 * Resolve the org id: the configured override, else the service account's own
 * org (`GET /management/v1/orgs/me` → { org: { id } }) — the same resolution the
 * api uses (zitadel.idp.ts resolveOrgId).
 */
export async function resolveOrgId({ issuer, token, orgId }) {
  if (orgId) return orgId;
  const res = await fetch(`${issuer}/management/v1/orgs/me`, {
    method: "GET",
    headers: headers(token),
  });
  if (!res.ok) {
    throw new Error(
      `orgs/me → HTTP ${res.status}; set LOADTEST_IDP_ORG_ID to skip the lookup`,
    );
  }
  const data = await res.json();
  const id = data?.org?.id;
  if (!id) throw new Error("orgs/me returned no org.id");
  return id;
}

/**
 * Create ONE pre-verified synthetic human. Returns { sub, email }. A 409
 * (duplicate) resolves to { alreadyExisted: true }.
 */
export async function createSyntheticUser({ issuer, token, orgId, email, password }) {
  const givenName = email.split("@")[0] || "loadtest";
  const body = {
    organizationId: orgId,
    username: email,
    human: {
      profile: { givenName, familyName: "loadtest", displayName: email },
      password: { password },
      // isVerified: born-verified ⇒ Zitadel sends no code, no mail (the
      // synthetic-user suppression seam; #1068).
      email: { email, isVerified: true },
    },
  };
  const res = await fetch(`${issuer}/v2/users/new`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (res.status === 409) return { alreadyExisted: true, email };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createUser ${email} → HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  const data = await res.json();
  return { sub: data?.id ?? "", email };
}

/** Find a user id by exact email (v2 search). Returns the id or null. */
export async function findUserIdByEmail({ issuer, token }, email) {
  const res = await fetch(`${issuer}/v2/users`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ queries: [{ emailQuery: { emailAddress: email } }] }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.result?.[0]?.userId ?? null;
}

/** Delete one synthetic user by email (search+DELETE). Returns true if deleted. */
export async function deleteByEmail(cfg, email) {
  const id = await findUserIdByEmail(cfg, email);
  if (!id) return false;
  const res = await fetch(`${cfg.issuer}/v2/users/${id}`, {
    method: "DELETE",
    headers: headers(cfg.token),
  });
  return res.ok;
}
