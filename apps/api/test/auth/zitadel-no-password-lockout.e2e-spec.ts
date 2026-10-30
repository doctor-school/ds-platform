import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * 003 EARS-15 (#3539) against a **running** Zitadel: wrong passwords neither
 * lock the person nor end their sessions. The instance policy under test is
 * the one IdP provisioning converges (`infra/dev-stand/idp/provision.sh` step
 * 8.octies, `maxPasswordAttempts = 0`); this spec reads it and never writes it,
 * because the dev stand's IdP is shared by parallel sessions.
 *
 * The attempts go straight to the IdP adapter, not through the BFF routes, so
 * the EARS-13 windows (proved in `abuse-limits.e2e-spec.ts`) do not stop them:
 * what is measured is Zitadel's own verdict after more failures than the old
 * lockout threshold (10).
 *
 * Gated on the live-OIDC env like `zitadel-token-exchange.e2e-spec.ts`; it
 * SKIPS in the shared CI `api-e2e` job. It deletes its own user on teardown.
 */
const LIVE_OIDC =
  !!process.env.IDP_ISSUER &&
  !!process.env.IDP_CLIENT_ID &&
  !!process.env.IDP_SERVICE_TOKEN &&
  !!process.env.IDP_REDIRECT_URI;

const issuer = (process.env.IDP_ISSUER ?? "").replace(/\/$/, "");
const serviceHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
  "content-type": "application/json",
});

/** More failures than the retired Zitadel lockout threshold of 10. */
const WRONG_ATTEMPTS = 12;

describe.skipIf(!LIVE_OIDC)(
  "Zitadel password lockout is off (003 EARS-15, integration)",
  () => {
    let client: ZitadelIdpClient;
    let sub: string | undefined;
    const password = `Int-${Date.now()}-aA1!`;
    const email = `int-3539-nolock-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@ds.test`;

    beforeAll(() => {
      client = new ZitadelIdpClient({
        baseUrl: issuer,
        serviceToken: process.env.IDP_SERVICE_TOKEN!,
        clientId: process.env.IDP_CLIENT_ID!,
        clientSecret: process.env.IDP_CLIENT_SECRET,
        redirectUri: process.env.IDP_REDIRECT_URI!,
        ...(process.env.IDP_PROJECT_ID
          ? { projectId: process.env.IDP_PROJECT_ID }
          : {}),
      });
    });

    afterAll(async () => {
      if (sub)
        await fetch(`${issuer}/v2/users/${sub}`, {
          method: "DELETE",
          headers: serviceHeaders(),
        });
    });

    it("EARS-15: the provisioned instance lockout policy carries no password threshold", async () => {
      const res = await fetch(`${issuer}/admin/v1/policies/lockout`, {
        headers: serviceHeaders(),
      });
      expect(res.ok).toBe(true);
      const { policy } = (await res.json()) as {
        policy: { maxPasswordAttempts?: string };
      };
      expect(Number(policy.maxPasswordAttempts ?? "0")).toBe(0);
    });

    it("EARS-15: 12 wrong passwords leave the person's live session signed in and the correct password still signs in", async () => {
      await client.createUser({ email, password });
      const login = await client.passwordLogin(email, password);
      expect(login.outcome).toBe("authenticated");
      if (login.outcome !== "authenticated") return;
      sub = login.session.sub;
      const liveSessionId = login.session.zitadelSessionId;

      for (let i = 0; i < WRONG_ATTEMPTS; i++) {
        const wrong = await client.passwordLogin(email, `wrong-${i}-password`);
        expect(wrong.outcome).toBe("rejected");
      }

      // The person is not locked …
      const user = await fetch(`${issuer}/v2/users/${sub}`, {
        headers: serviceHeaders(),
      });
      expect(user.ok).toBe(true);
      const { user: state } = (await user.json()) as {
        user: { state: string };
      };
      expect(state.state).toBe("USER_STATE_ACTIVE");

      // … their session from before the guessing is still live …
      const session = await fetch(`${issuer}/v2/sessions/${liveSessionId}`, {
        headers: serviceHeaders(),
      });
      expect(session.ok).toBe(true);

      // … and the correct password signs in.
      const again = await client.passwordLogin(email, password);
      expect(again.outcome).toBe("authenticated");
      // 15 sequential round trips to a live IdP: past vitest's 5 s default.
    }, 60_000);
  },
);
