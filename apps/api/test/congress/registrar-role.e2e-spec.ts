import { describe, expect, it } from "vitest";
import {
  ZitadelIdpClient,
  type FetchLike,
} from "../../src/auth/idp/zitadel.idp.js";
import { AuthzGuard } from "../../src/authz/authz.guard.js";
import {
  AUTHZ_KEY,
  ROLES,
  type AuthzMeta,
} from "../../src/authz/authz.types.js";
import type { ExecutionContext } from "@nestjs/common";

/**
 * 044 EARS-17 — V-11. The registrar role must be SOURCED from the Zitadel
 * project-roles claim (ADR-0001 §1, §8), not from the `users.role` mirror. This
 * suite walks the whole seam a real registrar principal walks: the id_token
 * claim is parsed by the real adapter, the parsed role is a member of the `ROLES`
 * vocabulary, and the runtime guard admits it on a handler that requires it.
 * Everything below the token endpoint is the production code path — only the
 * network is doubled.
 */

const ROLES_CLAIM = "urn:zitadel:iam:org:project:roles";

/** Build a base64url JWT body (no signature verification — the IdP signs). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

/** Scripts the three hops of the OIDC dance: authorize → link session → token. */
function scriptedFetch(idToken: string): FetchLike {
  return (url) => {
    if (url.includes("/oauth/v2/authorize")) {
      return Promise.resolve({
        ok: false,
        status: 302,
        headers: { location: "/ui/login/login?authRequest=AR-1" },
        json: () => Promise.resolve({}),
      });
    }
    if (url.includes("/v2/oidc/auth_requests/")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            callbackUrl: "http://app/callback?code=THE_CODE&state=xyz",
          }),
      });
    }
    if (url.includes("/oauth/v2/token")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: "ACCESS",
            refresh_token: "REFRESH",
            expires_in: 900,
            id_token: idToken,
          }),
      });
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });
  };
}

const BASE_CONFIG = {
  baseUrl: "http://idp.test:9080",
  serviceToken: "svc-token",
  clientId: "ds-platform-dev",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/auth/callback",
  scopes: ["openid", "profile", ROLES_CLAIM],
};

/** Fake ExecutionContext whose handler carries `meta` and whose request carries `user`. */
function ctx(meta: AuthzMeta, user: unknown): ExecutionContext {
  const handler = (): void => {};
  Reflect.defineMetadata(AUTHZ_KEY, meta, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("044 congress sign-up — the event-registrar coarse role", () => {
  it("044 EARS-17: an id_token carrying only event-registrar yields that role and the guard admits it", async () => {
    const client = new ZitadelIdpClient({
      ...BASE_CONFIG,
      fetchImpl: scriptedFetch(
        jwt({
          sub: "zid-registrar-1",
          amr: ["pwd"],
          [ROLES_CLAIM]: { "event-registrar": { org1: "doctor.school" } },
        }),
      ),
    });

    const tokens = await client.exchangeSessionForTokens({
      zitadelSessionId: "sess-registrar",
      sub: "zid-registrar-1",
      sessionToken: "session-token-registrar",
    });

    // Parsed verbatim from the claim — no mirror row exists at this point.
    expect(tokens.claims.roles).toEqual(["event-registrar"]);
    // And the parsed key is a member of the API role vocabulary, so a route may
    // name it in `@Authz({ roles: [...] })` (EARS-18 builds on exactly this).
    expect(ROLES).toContain("event-registrar");

    const meta: AuthzMeta = {
      access: "authenticated",
      roles: ["event-registrar"],
      check: "fast-path",
      audit: "low-stakes",
      tests: ["EARS-17"],
    };
    expect(
      new AuthzGuard().canActivate(ctx(meta, { roles: tokens.claims.roles })),
    ).toBe(true);
  });
});
