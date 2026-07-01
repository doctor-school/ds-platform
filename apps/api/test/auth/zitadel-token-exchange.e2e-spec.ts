import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * EARS-8 real-adapter integration spec (design §3, §11): the live
 * authorize-with-session → code → token-endpoint exchange against a running
 * Zitadel.
 *
 * Gated on the OIDC-application env (`IDP_ISSUER` + `IDP_CLIENT_ID` +
 * `IDP_SERVICE_TOKEN`), mirroring the F1/F2 real-adapter pattern — it SKIPS in
 * the shared CI `api-e2e` job (which sets only `DATABASE_URL`, never `IDP_ISSUER`
 * — `IDP_ISSUER` is not in turbo `passThroughEnv`) and runs only against a
 * dev-stand whose `ds-platform-dev` OIDC app has been provisioned
 * (`infra/dev-stand/idp/bootstrap.md`). The exchange wire shape and claim
 * parsing are pinned deterministically by `src/auth/idp/zitadel.idp.spec.ts`;
 * this proves the same path against a real instance once the app exists.
 *
 * The full set of required env: IDP_ISSUER, IDP_SERVICE_TOKEN, IDP_CLIENT_ID,
 * IDP_CLIENT_SECRET (confidential client), IDP_REDIRECT_URI.
 */
const LIVE_OIDC =
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI;

describe.skipIf(!LIVE_OIDC)("Zitadel OIDC token exchange (integration)", () => {
  let client: ZitadelIdpClient;
  const password = `Int-${Date.now()}-aA1!`;
  const email = `int-ears8-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@ds.test`;

  beforeAll(() => {
    client = new ZitadelIdpClient({
      baseUrl: process.env.IDP_ISSUER!,
      serviceToken: process.env.IDP_SERVICE_TOKEN!,
      clientId: process.env.IDP_CLIENT_ID!,
      clientSecret: process.env.IDP_CLIENT_SECRET,
      redirectUri: process.env.IDP_REDIRECT_URI!,
      ...(process.env.IDP_SCOPES
        ? { scopes: process.env.IDP_SCOPES.split(/\s+/).filter(Boolean) }
        : {}),
      ...(process.env.IDP_PROJECT_ID
        ? { projectId: process.env.IDP_PROJECT_ID }
        : {}),
    });
  });

  afterAll(async () => {
    // Best-effort cleanup; the reconciliation sweep tolerates leftover users.
  });

  it("EARS-8: password login → session→token exchange yields tokens + parsed claims", async () => {
    const created = await client.createUser({ email, password });
    expect(created.alreadyExisted).toBe(false);

    const login = await client.passwordLogin(email, password);
    expect(login.outcome).toBe("authenticated");
    if (login.outcome !== "authenticated") return;

    const tokens = await client.exchangeSessionForTokens(login.session);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.expiresInSeconds).toBeGreaterThan(0);
    expect(tokens.claims.sub).toBe(login.session.sub);
    expect(Array.isArray(tokens.claims.roles)).toBe(true);
    expect(typeof tokens.claims.mfa).toBe("boolean");
  });

  // #157: the live proof that the project-role grant is what makes the token's
  // `urn:zitadel:iam:org:project:roles` claim carry `doctor_guest`. Gated
  // additionally on IDP_PROJECT_ID (the project owning the role, from
  // provision.sh) — without a grant the claim is empty and the guard 403s. This
  // is the regression guard for the gated live tier (the faithful fake guards the
  // default api-e2e matrix): create → grantProjectRole → exchange → assert the
  // claim. SKIPS when IDP_PROJECT_ID is unset.
  it.skipIf(!process.env.IDP_PROJECT_ID)(
    "#157: after grantProjectRole, the exchanged token's claims carry doctor_guest",
    async () => {
      const grantEmail = `int-157-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      const created = await client.createUser({ email: grantEmail, password });
      expect(created.alreadyExisted).toBe(false);

      // Grant the project role — idempotent; this is the authz authority the
      // token then asserts.
      await client.grantProjectRole(created.sub, "doctor_guest");

      const login = await client.passwordLogin(grantEmail, password);
      expect(login.outcome).toBe("authenticated");
      if (login.outcome !== "authenticated") return;

      const tokens = await client.exchangeSessionForTokens(login.session);
      // The grant is the reason the claim carries the role.
      expect(tokens.claims.roles).toContain("doctor_guest");
    },
  );

  it("EARS-9: refresh-token rotation yields a fresh, distinct refresh token", async () => {
    const login = await client.passwordLogin(email, password);
    if (login.outcome !== "authenticated") {
      throw new Error("precondition: password login must succeed");
    }
    const tokens = await client.exchangeSessionForTokens(login.session);
    const rotated = await client.refreshTokens(tokens.refreshToken);
    expect(rotated.reuseDetected).toBe(false);
    if (rotated.reuseDetected) return;
    expect(rotated.tokens.refreshToken).not.toBe(tokens.refreshToken);
  });
});
