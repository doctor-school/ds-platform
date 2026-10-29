import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZitadelIdpClient } from "../../src/auth/idp/zitadel.idp.js";

/**
 * 003 EARS-65 (lockout clause), ADR-0015 §4 req. 11 — what a lock does to a
 * person's sessions, proved against a **running** Zitadel, not the fake.
 *
 * The automatic lockout of EARS-15 is native Zitadel: a tripped policy
 * appends `user.locked` (v4.17.3 `internal/command/user_human_password.go`).
 * The admin lock (`POST /v2/users/{id}/lock`) appends the same event, and
 * everything downstream keys on the event, not on what wrote it: the session
 * projection deletes every Zitadel session of the user
 * (`internal/query/projection/session.go` `reduceUserStateNotActive`), and a
 * refresh for a user who is not active is refused — live, a 400
 * `invalid_request` `Errors.User.NotActive` (`internal/command/oidc_session.go`). This spec writes the event through the
 * admin lock because the shared dev-stand provisions no lockout policy, and
 * setting one would change every parallel session's sign-in.
 *
 * That refusal is not `invalid_grant`, so the storefront adapter reads it as a
 * plain `failed` refresh, not reuse (`storefront-oidc.idp.ts`): each linked
 * storefront session ends alone at its own next refresh, with no theft
 * verdict (unit-tested in `storefront-oidc.idp.spec.ts` and
 * `session.service.spec.ts`). No API code revokes on lock.
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

/** Poll `probe` until it holds — the session projection is eventually consistent. */
async function eventually(probe: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

describe.skipIf(!LIVE_OIDC)(
  "Zitadel lock ends the person's sessions (003 EARS-65, integration)",
  () => {
    let client: ZitadelIdpClient;
    let sub: string | undefined;
    const password = `Int-${Date.now()}-aA1!`;
    const email = `int-3174-lock-${Date.now()}-${Math.random()
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

    it("003 EARS-65: a lock deletes every Zitadel session of the person and the IdP refuses their refresh as not active", async () => {
      await client.createUser({ email, password });
      const login = await client.passwordLogin(email, password);
      expect(login.outcome).toBe("authenticated");
      if (login.outcome !== "authenticated") return;
      sub = login.session.sub;
      const zitadelSessionId = login.session.zitadelSessionId;
      const tokens = await client.exchangeSessionForTokens(login.session);

      const sessionLive = async () =>
        (
          await fetch(`${issuer}/v2/sessions/${zitadelSessionId}`, {
            headers: serviceHeaders(),
          })
        ).ok;
      expect(await sessionLive()).toBe(true);

      // The same refresh call succeeds while the person is active, so the
      // refusal below is the lock, not the client authentication.
      const refreshGrant = (refreshToken: string) =>
        fetch(`${issuer}/oauth/v2/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: process.env.IDP_CLIENT_ID!,
            ...(process.env.IDP_CLIENT_SECRET
              ? { client_secret: process.env.IDP_CLIENT_SECRET }
              : {}),
          }).toString(),
        });
      const before = await refreshGrant(tokens.refreshToken);
      expect(before.status).toBe(200);
      const rotated = (await before.json()) as { refresh_token: string };

      const locked = await fetch(`${issuer}/v2/users/${sub}/lock`, {
        method: "POST",
        headers: serviceHeaders(),
        body: "{}",
      });
      expect(locked.ok).toBe(true);

      // The session projection drops every session of the locked user.
      expect(await eventually(async () => !(await sessionLive()))).toBe(true);

      // The refresh grant is refused for the not-active user. It is not
      // `invalid_grant`, so no theft cascade runs: every session ends on its
      // own next refresh.
      const refresh = await refreshGrant(rotated.refresh_token);
      expect(refresh.status).toBe(400);
      expect(await refresh.json()).toMatchObject({
        error: "invalid_request",
        error_description: "Errors.User.NotActive",
      });
    });
  },
);
